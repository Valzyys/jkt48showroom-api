import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { compileFilter,jsonPath } from '../src/runtime/filters.js';
test('migration is valid SQLite and retains separate collection namespaces',()=>{
  const db=new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_documents.sql',import.meta.url),'utf8'));
  const insert=db.prepare('INSERT INTO documents(database_name,collection_name,id,document) VALUES(?,?,?,?)');
  insert.run('dcDB','members','1','{"room_id":1}');insert.run('liveDB','members','1','{"room_id":2}');
  assert.equal(db.prepare('SELECT count(*) AS count FROM documents').get().count,2); db.close();
});
test('SQL filter uses placeholders, casts dates, and preserves boolean comparisons',()=>{
  const result=compileFilter({room_id:{$in:[1,2]},is_dev:false,'live_info.date.end':{$gte:new Date('2026-01-01')}},()=>true);
  assert.equal(result.values.includes('2026-01-01T00:00:00.000Z'),true); assert.ok(result.values.includes(0)); assert.ok(!result.sql.includes('2026-01-01'));
});
test('partial OR optimization never removes possible matches',()=>{
  const result=compileFilter({$or:[{name:/test/i},{room_id:1}]},()=>true);
  assert.equal(result.sql,''); assert.equal(result.complete,false);
});
test('untrusted JSON field paths cannot enter SQL',()=>{ assert.equal(jsonPath("name') OR 1=1 --"),null); assert.equal(compileFilter({"name') OR 1=1 --":1},()=>true).sql,''); });
test('array fields are left to the document query engine',()=>{const result=compileFilter({'users.user_id':1},()=>false);assert.equal(result.sql,'');});

test('large gift catalogs use one bound JSON parameter and preserve numeric membership',()=>{
 const ids=Array.from({length:350},(_,i)=>i+1);const result=compileFilter({gift_id:{$in:ids}},()=>true);assert.equal(result.values.length,1);
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE documents(document TEXT)');db.prepare('INSERT INTO documents VALUES(?)').run('{"gift_id":349}');db.prepare('INSERT INTO documents VALUES(?)').run('{"gift_id":999}');
 assert.equal(db.prepare('SELECT count(*) AS n FROM documents WHERE '+result.sql).get(...result.values).n,1);db.close();
});

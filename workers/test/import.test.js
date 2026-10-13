import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { importStatements,normalize } from '../scripts/import-mongo.js';
test('Mongo Extended JSON importer preserves IDs, dates, nested data and quotes',()=>{
  const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../migrations/0001_documents.sql',import.meta.url),'utf8'));
  const rows=[{_id:{$oid:'000000000000000000000001'},name:"Member's name",info:{birthdate:{$date:{$numberLong:'946684800000'}}},room_id:{$numberInt:'123'}}];
  db.exec(importStatements(JSON.stringify(rows),'dcDB','idolmembers')[0]);
  const row=JSON.parse(db.prepare('SELECT document FROM documents').get().document);assert.equal(row.name,"Member's name");assert.equal(row.room_id,123);assert.equal(row.info.birthdate,'2000-01-01T00:00:00.000Z');db.close();
});
test('Mongo importer refuses missing IDs and ambiguous Decimal/binary types',()=>{
  assert.throws(()=>importStatements('[{"name":"a"}]','dcDB','members'),/needs _id/);
  assert.throws(()=>normalize({$numberDecimal:'0.1'}),/Unsupported/);
  assert.equal(normalize({$numberLong:'9007199254740993'}),'9007199254740993');
});

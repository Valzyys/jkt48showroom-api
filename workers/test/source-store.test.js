import { test } from 'node:test';
import assert from 'node:assert/strict';
import { database } from './helpers.js';
import { createSourceStore } from '../src/runtime/source-store.js';
const model={databaseName:'jkt48DB',collection:{name:'jkt48newnews'}};
test('source batch preserves imported IDs, nested edits and version on refresh',async t=>{
  const DB=database();t.after(()=>DB.sqlite.close());
  await DB.prepare('INSERT INTO documents(database_name,collection_name,id,document) VALUES(?,?,?,?)').bind(model.databaseName,model.collection.name,'imported-id',JSON.stringify({_id:'imported-id',news_id:1,title:'Old',info:{manual:'keep',img:'old'},content_body:'keep content'})).run();
  const store=createSourceStore(DB);store.upsert(model,{news_id:1},{title:'New','info.img':'new'});await store.flush();
  const row=await DB.prepare('SELECT id,document,version FROM documents').first(),doc=JSON.parse(row.document);
  assert.equal(row.id,'imported-id');assert.equal(doc._id,'imported-id');assert.equal(doc.info.manual,'keep');assert.equal(doc.title,'New');assert.equal(doc.content_body,'keep content');assert.equal(row.version,2);
});
test('source batching deduplicates records and merges list/detail data with array replacement',async t=>{
  const DB=database();t.after(()=>DB.sqlite.close());const store=createSourceStore(DB);
  store.upsert(model,{news_id:1},{title:'List','info.img':'photo',members:[1,2]},{content_body:''});
  store.upsert(model,{news_id:1},{title:'Detail','info.birthdate':'2000-01-01',members:[3]});await store.flush();
  const result=await DB.prepare('SELECT document FROM documents').all();assert.equal(result.results.length,1);
  const doc=JSON.parse(result.results[0].document);assert.equal(doc.title,'Detail');assert.equal(doc.info.img,'photo');assert.deepEqual(doc.members,[3]);assert.equal(doc.content_body,'');
});
test('hundreds of source records use bounded set-based writes instead of per-row queries',async t=>{
  const DB=database();t.after(()=>DB.sqlite.close());let writes=0;
  const counted={prepare(sql){writes++;return DB.prepare(sql);}};
  const store=createSourceStore(counted);
  for(let id=1;id<=250;id++)store.upsert(model,{news_id:id},{title:'News '+id});
  await store.flush();assert.equal(writes,3);assert.equal((await DB.prepare('SELECT count(*) AS total FROM documents').first()).total,250);
});

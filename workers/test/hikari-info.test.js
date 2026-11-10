import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {hikariInfo,hikariInfoAdmin} from '../src/hikari-info.js';
function database(){const db=new DatabaseSync(':memory:');return {prepare(sql){const wrap=(args=[])=>({bind(...a){return wrap(a)},async run(){return db.prepare(sql).run(...args)},async first(){return db.prepare(sql).get(...args)},async all(){return {results:db.prepare(sql).all(...args)}}});return wrap()}}}
const req=method=>new Request('https://api.test/control/api/hikari-info',{method});
test('Hikari drafts are private, publication and pinning are explicit, updates and deletion persist',async()=>{
 const DB=database(),value={title:'Hikari 2.5.0',body:'**Halo**',image:'',url:'',published:false,pinned:false};
 await hikariInfoAdmin(req('POST'),{DB},async()=>value);
 assert.equal((await hikariInfo(DB)).items.length,0);
 const draft=(await hikariInfo(DB,true)).items[0];
 await hikariInfoAdmin(req('PUT'),{DB},async()=>({...value,id:draft.id,published:true,pinned:true}));
 const feed=(await hikariInfo(DB)).items;assert.equal(feed.length,1);assert.equal(feed[0].pinned,true);assert.equal(feed[0].body,'**Halo**');
 await hikariInfoAdmin(req('DELETE'),{DB},async()=>({id:draft.id}));assert.equal((await hikariInfo(DB)).items.length,0);
});
test('Hikari information rejects executable links and oversized bodies',async()=>{
 const DB=database(),value={title:'Info',body:'ok',image:'',url:'javascript:alert(1)',published:true,pinned:false};
 await assert.rejects(hikariInfoAdmin(req('POST'),{DB},async()=>value),e=>e.status===400);
 await assert.rejects(hikariInfoAdmin(req('POST'),{DB},async()=>({...value,url:'',body:'x'.repeat(10001)})),e=>e.status===400);
 assert.equal((await hikariInfo(DB,true)).items.length,0);
});

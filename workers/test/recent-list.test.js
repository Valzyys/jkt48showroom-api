import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {readFile} from 'node:fs/promises';
import {recentPage} from '../src/runtime/recent-list.js';
const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB'],compatibilityDate:'2026-07-01'});after(()=>mf.dispose());const db=await mf.getD1Database('DB');
await db.exec((await readFile(new URL('../migrations/0001_documents.sql',import.meta.url),'utf8')).replaceAll('\n',' '));
async function put(database,collection,id,doc){await db.prepare('INSERT INTO documents(database_name,collection_name,id,document)VALUES(?,?,?,?)').bind(database,collection,id,JSON.stringify({_id:id,...doc})).run()}
await put('dcDB','idolmembers','member1',{name:'Member',group:'jkt48',showroom_id:1,collector_room_ids:[99],info:{is_graduate:false,nicknames:['Pip']},slug:'pip'});
await put('dcDB','showrooms','room1',{name:'Pip',room_id:1,member_data:'member1',img:'https://example.com/a.jpg',url:'pip'});
for(let i=0;i<8;i++)await put('liveDB','livelogs','log'+i,{data_id:'sr-'+i,room_id:i===7?99:1,type:i%2?'idn':'showroom',is_dev:false,capture:{status:i===6?'live':'completed'},total_gifts:i,c_gift:i,created_at:'2026-10-28T01:00:00Z',live_info:{duration:i*1000,date:{start:'2026-10-28T00:00:00Z',end:`2026-10-28T01:0${i}:00Z`},viewers:{peak:i*10}},gift_data:{gift_log:'unused'.repeat(40000)}});
await put('liveDB','livelogs','outsider',{data_id:'outside',room_id:500,type:'idn',is_dev:false,live_info:{date:{end:'2026-10-29T00:00:00Z'}}});
test('recent list pages at the database and excludes live sessions and unrelated members',async()=>{
 const r=await recentPage(db,{perpage:2});assert.equal(r.total,7);assert.deepEqual(r.logs.map(x=>x.data_id),['sr-7','sr-5']);assert.equal(r.logs[1].room_info.member_data.info.is_graduate,false);assert.ok(r.logs[1].live_info.date.end instanceof Date);assert.ok(JSON.stringify(r).length<3000);assert.doesNotMatch(JSON.stringify(r),/gift_log|unused/);
 const next=await recentPage(db,{page:2,perpage:2});assert.deepEqual(next.logs.map(x=>x.data_id),['sr-4','sr-3']);
});
test('type, group, member, graduation, date and sorts retain list semantics',async()=>{
 assert.equal((await recentPage(db,{type:'idn'})).total,4);
 assert.equal((await recentPage(db,{group:'other'})).total,0);
 assert.equal((await recentPage(db,{filter:'graduated'})).total,0);
 assert.equal((await recentPage(db,{filter:'active'})).total,7);
 assert.equal((await recentPage(db,{room_id:500})).total,1);
 assert.deepEqual((await recentPage(db,{sort:'gift',order:1,perpage:2})).logs.map(x=>x.total_gifts),[0,1]);
 const date=JSON.stringify({start:Date.parse('2026-10-28T01:03:00Z'),end:Date.parse('2026-10-28T01:04:00Z')});assert.equal((await recentPage(db,{date})).total,2);
 assert.equal(await recentPage(db,{search:'pip'}),null);
});
test('a recent page and all six image states share a single database batch',async()=>{
 await db.prepare('CREATE TABLE collector_leaderboards(data_id TEXT,layout TEXT,theme TEXT,state TEXT,source_version INTEGER,design_version INTEGER,width INTEGER,height INTEGER,updated_at INTEGER)').run();
 await db.prepare("INSERT INTO collector_leaderboards VALUES('sr-7','banner','jkt48connect','ready',1,4,2400,1350,1)").run();
 let batches=0;const wrapped={prepare:(...a)=>db.prepare(...a),batch:args=>{batches++;return db.batch(args)}};
 const r=await recentPage(wrapped,{perpage:2},false,true);assert.equal(batches,1);assert.equal(r.cards.length,12);assert.equal(r.cards.find(c=>c.data_id==='sr-7'&&c.layout==='banner'&&c.theme==='jkt48connect').state,'ready');
});

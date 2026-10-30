const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../store.cjs'),{drain}=require('../delivery-dispatch.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'discord-dispatch-'));const store=new Store(dir);t.after(()=>{store.db.close();fs.rmSync(dir,{recursive:true,force:true})});return store}

test('new live arrival takes the next free slot before an older social backlog',async t=>{
 const store=fixture(t),sent=[];for(let i=0;i<35;i++)store.enqueue('x',String(i),'channel',{});
 let release,started;const gate=new Promise(r=>release=r),first=new Promise(r=>started=r);
 const sending=drain({claim:()=>store.claimDue(['x','live','recent']),concurrency:1,deliver:async job=>{
  sent.push(job.kind);if(sent.length===1){started();await gate}store.update(job.key,{status:'sent'});
 }});
 await first;store.enqueue('recent','ended','channel',{});store.enqueue('live','started','channel',{});release();await sending;
 assert.deepEqual(sent.slice(0,3),['x','live','recent']);assert.equal(sent.length,37);assert.equal(store.counts().find(x=>x.status==='sent').count,37);
});

test('six senders claim each event only once and do not claim disabled sources',async t=>{
 const store=fixture(t),keys=new Set();let active=0,peak=0;
 for(let i=0;i<50;i++)store.enqueue('live',String(i),'channel',{});store.enqueue('news','disabled','channel',{});
 await drain({claim:()=>store.claimDue(['live']),concurrency:100,deliver:async job=>{
  assert(!keys.has(job.key));keys.add(job.key);peak=Math.max(peak,++active);
  assert.equal(store.db.prepare('SELECT status FROM deliveries WHERE key=?').get(job.key).status,'sending');
  await new Promise(r=>setImmediate(r));active--;store.update(job.key,{status:'sent'});
 }});
 assert.equal(keys.size,50);assert.equal(peak,6);assert.equal(store.due().length,1);assert.equal(store.due()[0].kind,'news');assert.equal(store.claimDue([]),null);
});

test('retry deadline and uncertain send remain protected from duplicate dispatch',t=>{
 const store=fixture(t);store.enqueue('live','retry','channel',{});store.update('live:retry:channel',{next_at:Date.now()+60000});
 store.enqueue('live','uncertain','channel',{});store.update('live:uncertain:channel',{status:'uncertain'});
 assert.equal(store.claimDue(['live']),null);
});

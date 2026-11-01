import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCollectorLive,liveRefreshMillis} from '../src/collector/hub-live.js';
const row={name:'Heidi',img:'https://image.test/a.jpg',url_key:'JKT48_Heidi',room_id:572591,type:'showroom',date:{start:'2026-10-20T13:30:00Z'},capture:{status:'live'}};
test('collector starts/updates and ends room without removing unrelated lives',()=>{
 const other={group:'hinatazaka46',type:'showroom',room_id:2};
 let state=applyCollectorLive([other],row);assert.equal(state.length,2);assert.equal(state[1].name,'Heidi');
 state[1].streaming_url_list=[{url:'https://stream.test/a'}];state=applyCollectorLive(state,row);assert.equal(state.length,2);assert.equal(state[1].streaming_url_list.length,1);
 assert.deepEqual(applyCollectorLive(state,{...row,capture:{status:'completed'}}),[other]);
 const newer={...state[1],started_at:'2026-10-20T14:00:00Z'};assert.equal(applyCollectorLive([newer],{...row,capture:{status:'completed'}}).length,1);
});
test('old 300-second settings cannot restore five minute lag',()=>{assert.equal(liveRefreshMillis(300),15000);assert.equal(liveRefreshMillis(undefined),10000);assert.equal(liveRefreshMillis(1),5000)});
import {LiveHub} from '../src/live-hub.js';
test('collector event updates durable hub and broadcasts immediately without source refresh',async()=>{
 const values=new Map([['lives',[]]]);let alarm=null;const sent=[];
 const storage={get:async k=>values.get(k),put:async obj=>{for(const [k,v] of Object.entries(obj))values.set(k,v)},getAlarm:async()=>alarm,setAlarm:async t=>{alarm=t}};
 const ctx={storage,getWebSockets:()=>[{deserializeAttachment:()=>({groups:['jkt48']}),send:data=>sent.push(data)}]};
 const hub=new LiveHub(ctx,{});
 const response=await hub.fetch(new Request('https://live.internal/collector',{method:'POST',body:JSON.stringify({row})}));
 assert.equal(response.status,200);assert.equal(values.get('lives')[0].room_id,572591);assert.equal(sent.length,1);assert.ok(alarm<=Date.now()+10000);
 const firstAlarm=alarm;await hub.fetch(new Request('https://live.internal/collector',{method:'POST',body:JSON.stringify({row:{...row,capture:{status:'completed'}}})}));
 assert.equal(values.get('lives').length,0);assert.equal(sent.length,2);assert.equal(alarm,firstAlarm);
});
test('watch request wakes on committed event and resumes from its revision',async()=>{
 const values=new Map();const storage={get:async k=>values.get(k),put:async obj=>{for(const [k,v] of Object.entries(obj))values.set(k,v)}};
 const hub=new LiveHub({storage},{});
 const pending=hub.watch(0);await new Promise(r=>setTimeout(r,5));await hub.signal();
 assert.deepEqual(await (await pending).json(),{revision:1});assert.equal(hub.waiters.size,0);
 assert.deepEqual(await (await hub.watch(0)).json(),{revision:1});
});

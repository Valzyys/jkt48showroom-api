const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../store.cjs'),{CardDelivery}=require('../card-delivery.cjs');
test('late banners update the existing Discord message without sending or mentioning again',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'card-delivery-'));const store=new Store(dir),edits=[];let sends=0;
 const client={channels:{fetch:async()=>({messages:{edit:async(id,p)=>edits.push({id,p})},send:()=>sends++})}};
 const cards=new CardDelivery({store,client,preferences:()=>({}),settings:()=>({banner_style:'jkt48connect'})});
 const payload={embeds:[{title:'Recent'}]};store.enqueue('recent','sr-test','channel',payload);store.update('recent:sr-test:channel',{status:'sent',message_id:'message1'});
 cards.remember('recent','sr-test',{});await cards.tick();assert.equal(edits.length,0);assert.equal(cards.tasks.size,1);
 cards.observe('recent','sr-test',{leaderboard_designs:{jkt48connect:{banner:{status:'ready',url:'https://api.jkt48connect.app/media/test.png'}}}});await cards.tick();await cards.tick();
 assert.equal(sends,0);assert.equal(edits.length,1);assert.equal(edits[0].id,'message1');assert.deepEqual(edits[0].p.allowedMentions,{parse:[]});assert.equal(cards.tasks.size,0);store.db.close();fs.rmSync(dir,{recursive:true});
});
test('pending deliveries receive ready media before sending and restore safely after restart',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'card-pending-'));const store=new Store(dir);store.enqueue('live','sr-test','channel',{embeds:[{title:'Live'}]});
 const params={store,client:{},preferences:()=>({}),settings:()=>({banner_style:'jkt48connect'})};const first=new CardDelivery(params);first.remember('live','sr-test',{});
 const restored=new CardDelivery(params);assert.equal(restored.tasks.size,1);restored.observe('live','sr-test',{notification_designs:{jkt48connect:{banner:{status:'ready',url:'https://api.jkt48connect.app/media/live.png'}}}});await restored.tick();
 const payload=JSON.parse(store.due()[0].payload);assert.ok(payload.embeds[0].image.url.endsWith('live.png'));assert.equal(store.due()[0].status,'pending');store.db.close();fs.rmSync(dir,{recursive:true});
});

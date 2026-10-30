const {test}=require('node:test'),assert=require('node:assert/strict');
const {mergeCatalogues,eventKeys,allows,allowsKeys}=require('../member-routing.cjs');
const {Store}=require('../store.cjs'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const catalogue=mergeCatalogues([
 [{_id:'member-a',url:'fiony-alveria',name:'Fiony Alveria',nicknames:['Fiony'],room_id:123,idn_username:'jkt48_fiony'},{url:'jessica-chandra',name:'Jessica Chandra',nicknames:['Jessi']}],
 [{id:'fiony-alveria',name:'Fiony Alveria',username:'A_FionyJKT48'}],
 [{member:'fiony-alveria',name:'Fiony Alveria',username:'fionyjkt48'},{member:'jkt48-u16',name:'JKT48 U16',username:'jkt48.u16'}]
]);
test('one canonical member matches full names, slugs, room IDs and social handles across platforms',()=>{
 assert.equal(catalogue.length,3);const cfg={member_ids:['fiony-alveria']};
 for(const [kind,row]of [['live',{name:'Fiony Alveria'}],['live',{room_id:123}],['live',{name:'Fiony',idn:{username:'jkt48_fiony'}}],['recent',{member:{url:'fiony-alveria'}}],['x',{member:{id:'fiony-alveria'}}],['x',{author:{username:'A_FionyJKT48'}}],['instagram',{member:{member:'fiony-alveria'}}],['tiktok',{author:{username:'fionyjkt48'}}]]){
  assert.equal(allowsKeys(cfg,eventKeys(kind,row),catalogue),true,kind+JSON.stringify(row));
 }
 assert.equal(allowsKeys(cfg,eventKeys('instagram',{member:{name:'Jessica Chandra'},text:'Fiony Alveria @fionyjkt48'}),catalogue),false);
});
test('legacy all-member destinations keep receiving events; empty selections never mean everyone',()=>{
 assert.equal(allows({},'live',{name:'Unknown'}),true);assert.equal(allows({member_ids:null},'recent',{}),true);
 assert.equal(allowsKeys({member_ids:[]},['fionyalveria'],catalogue),false);
 assert.equal(allowsKeys({member_ids:['fiony-alveria']},undefined,catalogue),false);
 assert.equal(allows({member_ids:['fiony-alveria']},'news',{}),true);
 assert.equal(allowsKeys({member_ids:['jkt48-u16']},eventKeys('instagram',{member:{member:'jkt48-u16',username:'jkt48.u16'}}),catalogue),true);
});
test('fan-out sends once to each matching channel and does not cross member filters',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'discord-routing-')),store=new Store(folder);
 try{
  const destinations=[{channel_id:'all'},{channel_id:'fiony',member_ids:['fiony-alveria']},{channel_id:'jessi',member_ids:['jessica-chandra']},{channel_id:'none',member_ids:[]}];
  function enqueue(post){for(const dest of destinations)if(allowsKeys(dest,eventKeys('instagram',post),catalogue))store.enqueue('instagram',post.id,dest.channel_id,{_member_keys:eventKeys('instagram',post)})}
  const post={id:'event1',member:{member:'fiony-alveria'}};enqueue(post);enqueue(post);
  assert.deepEqual(store.due().map(j=>j.channel).sort(),['all','fiony']);
  const payload=JSON.parse(store.due().find(j=>j.channel==='fiony').payload);
  assert.equal(allowsKeys({member_ids:['jessica-chandra']},payload._member_keys,catalogue),false,'queued job is blocked when the channel filter changes');
 }finally{store.db.close();fs.rmSync(folder,{recursive:true,force:true})}
});

const {test}=require('node:test'),assert=require('node:assert/strict');
const {authorized,safeRole,commands}=require('../friends.cjs');
const {guildId}=require('../community-plan.cjs');
test('friend management requires exact bot owner and community guild',()=>{
 assert.equal(authorized({guildId,user:{id:'owner'}},'owner'),true);
 assert.equal(authorized({guildId,user:{id:'admin'}},'owner'),false);
 assert.equal(authorized({guildId:'elsewhere',user:{id:'owner'}},'owner'),false);
 assert.equal(authorized({guildId,user:{id:''}},''),false);
 assert.equal(commands[0].default_member_permissions,'0');
});
test('friend role must be editable with no permissions',()=>{
 const role={managed:false,editable:true,permissions:{bitfield:0n}};
 assert.equal(safeRole(role),true);
 for(const bad of [{managed:true},{editable:false},{permissions:{bitfield:8n}}])assert.equal(safeRole({...role,...bad}),false);
 assert.equal(safeRole(null),false);
});

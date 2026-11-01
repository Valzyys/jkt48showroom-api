import test from 'node:test';
import assert from 'node:assert/strict';
import {showroomAvatar} from '../src/runtime/showroom-avatar.js';
import {commentsSnapshot} from '../src/showroom-comments.js';
import {calculateFansPoints} from '../src/library/fansPoints.js';

test('old comment buffers gain avatar images on read without rewriting events or IDs',()=>{
 const item={id:'c1',sequence:1,user:{id:'u1',name:'Viewer',avatar_id:84},comment:'Hi'};
 const view=commentsSnapshot({room_id:1,comments:[item],sequence:1});
 assert.equal(view.comments[0].user.avatar_url,'https://image.showroom-cdn.com/showroom-prod/image/avatar/84.png');
 assert.equal(view.comments[0].user.avatar_id,84);
 assert.equal(item.user.avatar_url,undefined);
 assert.deepEqual(commentsSnapshot({room_id:1,comments:[item],sequence:1},1).comments,[]);
});
test('unknown avatars have explicit fallbacks and arbitrary URLs cannot be reflected',()=>{
 assert.deepEqual(showroomAvatar({avatar_id:null},null),{avatar_id:null,avatar_url:null});
 assert.equal(showroomAvatar({}).avatar_id,1);
 assert.equal(showroomAvatar({avatar_id:-1,avatar_url:'https://evil.test/a.png'}).avatar_id,1);
 assert.equal(showroomAvatar({avatar_url:'https://static.showroom-live.com/image/avatar/74.png?v=2'}).avatar_id,74);
 assert.equal(showroomAvatar({avatar_id:84,avatar_url:'https://image.showroom-cdn.com/showroom-prod/image/avatar/2.png'}).avatar_id,84);
 for(const url of ['https://image.showroom-cdn.com.evil.test/showroom-prod/image/avatar/44.png','https://image.showroom-cdn.com:444/showroom-prod/image/avatar/44.png','https://user:pass@image.showroom-cdn.com/showroom-prod/image/avatar/44.png','javascript:alert(1)'])assert.equal(showroomAvatar({avatar_url:url},null).avatar_url,null);
});
test('recent fan rankings expose avatar images while preserving points and order',()=>{
 const fans=calculateFansPoints([{user_id:1,name:'One',avatar_id:84,comments:3},{user_id:2,name:'Two',avatar_id:90,comments:1}],[],[{user_id:2,total:100}]);
 assert.deepEqual(fans.map(f=>[f.id,f.fans_point]),[[2,110],[1,30]]);
 assert.equal(fans[0].avatar_url,'https://image.showroom-cdn.com/showroom-prod/image/avatar/90.png');
});

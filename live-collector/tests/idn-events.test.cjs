const assert=require('node:assert/strict'),{test}=require('node:test'),{parseFrame}=require('../idn-events.cjs');
const data={user:{username:'user-uuid',name:'Viewer',avatar_url:'https://img.test/user'},gift:{slug:'rose',name:'Rose',gold:20,quantity:2}};
test('reads gifts from legacy IVS chat without depending on DOM events',()=>{const e=parseFrame(JSON.stringify({Type:'MESSAGE',Id:'message1',Attributes:{message:JSON.stringify(data)}}));assert.equal(e.kind,'gift');assert.equal(e.gift.gold,20);assert.equal(e.gift.quantity,2);assert.equal(e.event_id,'message1');assert.equal(e.user.username,'user-uuid')});
test('reads new IRC chat and comments and ignores credentials',()=>{assert.equal(parseFrame(':user PRIVMSG #room :'+JSON.stringify(data)).kind,'gift');assert.equal(parseFrame(JSON.stringify({Type:'MESSAGE',Attributes:{message:JSON.stringify({user:data.user,chat:{message:'Hi'}})}})).kind,'comment');assert.equal(parseFrame('PING :token'),null);assert.equal(parseFrame(JSON.stringify({Type:'ERROR',token:'private'})),null)});
const {parseFrames}=require('../idn-events.cjs');
test('all IRC events in one frame survive with stable provider IDs and numeric quantities',()=>{
 const frame='@id=first;tmi-sent-ts=1792000000000 :user PRIVMSG #room :'+JSON.stringify({...data,gift:{...data.gift,gold:'20',quantity:'3'}})+'\r\n@id=second :user PRIVMSG #room :'+JSON.stringify(data)+'\r\n';const events=parseFrames(frame);assert.equal(events.length,2);assert.equal(events[0].event_id,'first');assert.equal(events[0].event_time,'1792000000000');assert.equal(events[0].gift.gold,20);assert.equal(events[0].gift.quantity,3);assert.equal(events[1].event_id,'second');
});
test('malformed quantities cannot poison gold totals and unknown price stays unknown',()=>{
 assert.equal(parseFrames(JSON.stringify({...data,gift:{slug:'rose',gold:'NaN'}})).length,0);assert.equal(parseFrames(JSON.stringify({...data,gift:{slug:'rose',gold:-1}})).length,0);assert.equal(parseFrames(JSON.stringify({...data,gift:{slug:'rose',quantity:0}})).length,0);assert.equal(parseFrames(JSON.stringify({...data,gift:{slug:'rose'}}))[0].gift.gold,null);
});

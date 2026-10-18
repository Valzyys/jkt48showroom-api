const {test}=require('node:test'),assert=require('node:assert/strict');
const {renderNotification}=require('../live-notification-template.cjs');
const snapshot={name:'Member <script>alert(1)</script>',nickname:'A "quoted" name',title:'Hello <img onerror=alert(1)>',img:'https://jkt48.com/photo.jpg',type:'idn',started_at:'2026-10-18T05:31:00.000Z',is_preview:false};
test('all four live notice formats escape source content and show Jakarta time',()=>{
 for(const theme of ['photobook','jkt48connect'])for(const layout of ['portrait','banner']){const html=renderNotification(snapshot,{theme,layout});assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img onerror'));assert.ok(html.includes('&quot;quoted&quot;'));assert.ok(html.includes('12.31'));assert.ok(html.includes('18 Oktober 2026')||html.includes('18 OKTOBER 2026'));assert.ok(!html.includes('PREVIEW / SESI ARSIP'));assert.ok(!html.includes('Maxine'));}
});
test('archive previews are visibly marked and invalid inputs rejected',()=>{
 assert.ok(renderNotification({...snapshot,is_preview:true},{theme:'jkt48connect'}).includes('PREVIEW LIVE'));
 assert.throws(()=>renderNotification(snapshot,{theme:'bad'}));assert.throws(()=>renderNotification({...snapshot,img:'javascript:alert(1)'}));assert.throws(()=>renderNotification({...snapshot,started_at:'invalid'}));
});

const {notificationPhotoURL}=require('../live-notification-media.cjs');
test('raw JKT48 photo storage paths resolve to the same R2 proxy as public responses',()=>{
 const origin='https://api.jkt48connect.app',path='media/jkt48-member/heidi_suyangga.jpg',expected=origin+'/media/jkt48/'+path;
 for(const source of [path,'/'+path,'/media/jkt48/'+path,'media/jkt48/'+path,expected])assert.equal(notificationPhotoURL(source,origin).href,expected);
 assert.equal(notificationPhotoURL('https://image.showroom-live.com/photo.jpg',origin).href,'https://image.showroom-live.com/photo.jpg');
 for(const source of ['',undefined,'javascript:alert(1)','http://example.test/p.jpg','media/../private.jpg','https://user:pass@example.test/a.jpg'])assert.throws(()=>notificationPhotoURL(source,origin));
});

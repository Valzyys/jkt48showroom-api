const {test}=require('node:test'),assert=require('node:assert/strict'),html=require('../leaderboard-template.cjs');
const fixture={type:'idn',room_info:{nickname:'Test',fullname:'Test Member',img:'https://api.test/photo.jpg'},idn:{title:'Hello'},fans:[],total_gifts:10,leaderboard_data:{supporters:[{name:'<img src=x onerror=evil()>',total:10,avatar_url:'https://cdn.test/avatar'}],supporter_count:1},live_info:{duration:60000,date:{start:'2026-10-13T15:00:00Z',end:'2026-10-13T15:01:00Z'},viewers:{num:100},gift:{list:[]}}};
test('card escapes fan names and works without screenshots or gifts',()=>{const result=html(fixture);assert.ok(result.includes('&lt;img src=x onerror=evil()&gt;'));assert.ok(!result.includes('<img src=x onerror=evil()>'));assert.ok(result.includes('Tidak ada screenshot yang cukup jelas untuk ditampilkan.'));assert.ok(!result.replace(/<[^>]+>/g,'').toLowerCase().includes('jkt48connect'));});
test('Showroom quantities use provider units and screenshot selection never duplicates frames',()=>{const d=structuredClone(fixture);d.type='showroom';d.live_info.screenshot={list:[1000],base_url:'https://api.test/media',format:'jpg'};const result=html(d);assert.ok(result.includes('SR POINTS TERCATAT'));assert.equal((result.match(/class="frame"/g)||[]).length,1);});

const banner=require('../leaderboard-banner.cjs');
test('landscape has an independent 16:9 composition, escapes content, and has no site branding',()=>{
 const result=banner(fixture);assert.match(result,/width:1600px;height:900px/);assert.match(result,/class="identity"/);assert.match(result,/class="spread"/);assert.match(result,/&lt;img src=x onerror=evil\(\)&gt;/);assert.ok(!result.includes('<img src=x onerror=evil()>'));assert.ok(!result.replace(/<[^>]+>/g,'').toLowerCase().includes('jkt48connect'));assert.match(result,/Tidak ada screenshot yang cukup jelas/);
});
test('landscape keeps provider units, gift quantities, and unique real frames',()=>{
 const d=structuredClone(fixture);d.type='showroom';d.live_info.screenshot={list:[1000],base_url:'https://api.test/media',format:'jpg'};d.live_info.gift.list=[{name:'Flower',num:7,user_count:3,img:'https://api.test/gift.png'}];const result=banner(d);assert.match(result,/SR POINTS TERCATAT/);assert.match(result,/7 gift/);assert.match(result,/3 pengirim/);assert.equal((result.match(/class="frame"/g)||[]).length,1);
});

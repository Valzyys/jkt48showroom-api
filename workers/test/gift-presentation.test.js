import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recentGiftIds,presentGiftEvent,giftAvailability} from '../src/library/recent/gift-presentation.js';

test('gift detail includes log-only IDs and keeps images/counts on every event',()=>{
 const data={gift_data:{gift_id_list:['rose'],gift_log:[{gifts:[{gift_id:'rose'},{gift_id:'compass'}]}]}};
 assert.deepEqual(recentGiftIds(data),['rose','compass']);
 const catalog=new Map([['rose',{name:'Rose',point:20,img:'https://api.test/media/gifts/idn/rose'}]]);
 assert.deepEqual(presentGiftEvent({gift_id:'rose',num:4,send_count:2,date:'2026-10-16T15:00:00Z'},catalog),{id:'rose',name:'Rose',img:'https://api.test/media/gifts/idn/rose',image_available:true,point:20,num:4,send_count:2,date:'2026-10-16T15:00:00.000Z'});
 assert.equal(presentGiftEvent({gift_id:'unknown',num:2,date:0},catalog).image_available,false);
});
test('cumulative IDN gold cannot manufacture missing gift types or counts',()=>{
 const data={gift_data:{gift_id_list:[],gift_log:[]}};
 assert.deepEqual(recentGiftIds(data),[]);
 assert.deepEqual(giftAvailability(data,{reported_gold:871,unattributed_gold:871}),{status:'unavailable',reason:'gift_events_not_captured',count_source:'observed_events',unattributed_gold:871});
 data.gift_data.gift_log.push({gifts:[{gift_id:'rose',num:2}]});
 assert.equal(giftAvailability(data,{reported_gold:871,unattributed_gold:851}).status,'partial');
});

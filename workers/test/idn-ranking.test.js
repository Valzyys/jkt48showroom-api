import {test} from 'node:test';import assert from 'node:assert/strict';
import {fetchIdnRanking,idnGoldSummary} from '../src/idn/ranking.js';
test('source snapshots join UUID/username aliases without summing cumulative totals or inventing gifts',()=>{
 const log=[{user_id:'name-alias',total:10,gifts:[{gift_id:'rose',num:2}]},{user_id:'outside',total:2,gifts:[]}],ranking={updated_at:'2026-10-14T12:00:00Z',users:[{user_id:'u1',username:'name-alias',name:'One',gold:30},{user_id:'u2',name:'Two',gold:8}]},original=JSON.stringify(log);
 const v=idnGoldSummary(log,ranking,[{user_id:'outside',name:'Outside'}]);assert.equal(v.total_gold,40);assert.equal(v.observed_gold,12);assert.equal(v.reported_gold,38);assert.equal(v.unattributed_gold,28);assert.equal(v.fans.length,3);assert.equal(v.fans[0].id,'u1');assert.equal(v.fans[0].observed_gold,10);assert.equal(JSON.stringify(log),original);assert.equal(idnGoldSummary(log,ranking).total_gold,40);
});
test('provider per-user totals remain authoritative when observed events contain excess gold',()=>{
 const v=idnGoldSummary([{user_id:'u',total:100,gifts:[]}],{users:[{user_id:'u',name:'Viewer',gold:70}]});assert.equal(v.total_gold,70);assert.equal(v.observed_excess_gold,30);assert.equal(v.fans[0].source,'idn_top_gifter');assert.equal(v.unattributed_gold,0);
 const old=idnGoldSummary([{user_id:'u',total:5,gifts:[]}]);assert.equal(old.total_gold,5);assert.equal(old.reported_gold,null);assert.equal(old.source,'observed_chat');
});
test('ranking uses the web credential, refreshes JWT on 401, and returns only safe public profile facts',async()=>{
 const calls=[],authCalls=[];const result=await fetchIdnRanking({IDN_WEB_CLIENT_KEY:'synthetic-web'},'test-slug',{now:1000,authProvider:async(_env,options)=>{authCalls.push(options);return{accessToken:'private-access',idToken:'private-id'}},fetcher:async(url,options)=>{calls.push({url,options});return calls.length===1?new Response(null,{status:401}):Response.json({status:'success',data:[{uuid:'u1',username:'viewer',name:'Viewer',image_url:'https://image.test/u.jpg',total_gold:'12',private_field:'omit'},{uuid:'bad',total_gold:-3}]})}});
 assert.equal(calls.length,2);assert.equal(authCalls[1].force,true);assert.equal(calls[0].options.headers['x-api-key'],'synthetic-web');assert.equal(new URL(calls[0].url).pathname,'/api/v1/gift/livestream/test-slug/top-gifter');assert.equal(result.users.length,1);assert.equal(result.users[0].gold,12);assert.ok(!JSON.stringify(result).includes('private'));assert.equal(result.updated_at,'1970-01-01T00:00:01.000Z');
});
test('missing and excess gold remain separate when differences cancel across users',()=>{
 const v=idnGoldSummary([{user_id:'a',total:20,gifts:[]}],{users:[{user_id:'a',name:'A',gold:0},{user_id:'b',name:'B',gold:20}]});assert.equal(v.total_gold,20);assert.equal(v.observed_gold,20);assert.equal(v.unattributed_gold,20);assert.equal(v.observed_excess_gold,20);
});

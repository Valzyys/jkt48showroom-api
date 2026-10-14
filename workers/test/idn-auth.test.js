import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getIdnSession,idnAuthStatus,idnCollectorAuth} from '../src/idn/auth.js';
import {giftCounts} from '../src/library/recent/gift-counts.js';
test('refreshes Cognito JWT once for concurrent callers and keeps refresh token private',async()=>{
 const env={IDN_REFRESH_TOKEN:'synthetic-refresh',IDN_COGNITO_CLIENT_ID:'synthetic-client'};let calls=0;
 const fetcher=async(url,request)=>{calls++;assert.equal(new URL(url).hostname,'cognito-idp.ap-southeast-1.amazonaws.com');const body=JSON.parse(request.body);assert.equal(body.AuthFlow,'REFRESH_TOKEN_AUTH');assert.equal(body.AuthParameters.REFRESH_TOKEN,env.IDN_REFRESH_TOKEN);return Response.json({AuthenticationResult:{AccessToken:'test-access',IdToken:'test-id',ExpiresIn:3600}})};
 const [a,b]=await Promise.all([getIdnSession(env,{fetcher}),getIdnSession(env,{fetcher})]);assert.equal(calls,1);assert.deepEqual(a,b);assert.equal(idnAuthStatus(env).ready,true);assert.equal(JSON.stringify(await idnCollectorAuth(env)).includes('synthetic-refresh'),false);assert.equal(calls,1);
 await assert.rejects(getIdnSession(env,{force:true,fetcher:async()=>Response.json({message:'private data',__type:'NotAuthorizedException'},{status:400})}),{message:'idn_refresh_rejected'});
 assert.equal((await idnCollectorAuth({})).ready,false);
});
test('gift counts distinguish send events, quantities and unique senders',()=>{
 const logs=[{user_id:'a',gifts:[{gift_id:'rose',num:10,send_count:1},{gift_id:'rose',num:2,send_count:1},{gift_id:'other',num:99}]},{user_id:'b',gifts:[{gift_id:'rose',num:1,send_count:1}]}];
 assert.deepEqual(giftCounts(logs,'rose'),{num:13,send_count:3,user_count:2});assert.equal(giftCounts([{user_id:'a',gifts:[{gift_id:'legacy',num:10}]}],'legacy').send_count,null);assert.deepEqual(giftCounts(logs,'absent'),{num:0,send_count:0,user_count:0});
});

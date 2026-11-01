import {test} from 'node:test';
import assert from 'node:assert/strict';
import {xBotControl} from '../src/control/x-bot.js';
test('bot controller forwards only fixed routes/actions and private credentials',async t=>{
 const bindings={X_BOT_CONTROL_URL:'https://vps.test/internal/x-bot',X_BOT_CONTROL_TOKEN:'synthetic-only'};
 const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url:String(url),init});return Response.json({service:{active:false}})});
 let request=new Request('https://api.test/control/api/x-bot/snapshot',{headers:{Cookie:'do-not-forward'}});
 const result=await xBotControl(request,new URL(request.url),bindings);assert.equal(result.service.active,false);assert.equal(calls[0].init.redirect,'manual');assert.equal(calls[0].init.headers.Authorization,'Bearer synthetic-only');assert.ok(!calls[0].init.headers.Cookie);
 request=new Request('https://api.test/control/api/x-bot/action',{method:'POST',body:JSON.stringify({action:'on',extra:'ignored'})});await xBotControl(request,new URL(request.url),bindings);assert.deepEqual(JSON.parse(calls[1].init.body),{action:'on'});
 request=new Request('https://api.test/control/api/x-bot/action',{method:'POST',body:JSON.stringify({action:'reboot'})});await assert.rejects(xBotControl(request,new URL(request.url),bindings),error=>error.status===400);
 request=new Request('https://api.test/control/api/x-bot/other');await assert.rejects(xBotControl(request,new URL(request.url),bindings),error=>error.status===404);
});
test('controller rejects redirects and missing configuration',async t=>{
 const request=new Request('https://api.test/control/api/x-bot/snapshot');await assert.rejects(xBotControl(request,new URL(request.url),{}),error=>error.status===503);
 t.mock.method(globalThis,'fetch',async()=>new Response(null,{status:302}));await assert.rejects(xBotControl(request,new URL(request.url),{X_BOT_CONTROL_URL:'https://vps.test',X_BOT_CONTROL_TOKEN:'test'}),error=>error.status===502);
});

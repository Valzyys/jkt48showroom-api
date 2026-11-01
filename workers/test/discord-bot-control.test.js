import {test} from 'node:test';import assert from 'node:assert/strict';import {discordBotControl}from'../src/control/discord-bot.js';
test('Discord control forwards only fixed bots and actions using private token',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url:String(url),init});return Response.json({ok:true})});const bindings={X_BOT_CONTROL_URL:'https://dash.test/internal/x-bot',X_BOT_CONTROL_TOKEN:'synthetic-only'};
 const req=new Request('https://api.test/control/api/discord-bot/notify/action',{method:'POST',body:JSON.stringify({action:'restart',command:'ignored'})});await discordBotControl(req,new URL(req.url),bindings);assert.equal(calls[0].url,'https://dash.test/internal/x-bot/discord/notify/action');assert.deepEqual(JSON.parse(calls[0].init.body),{action:'restart'});assert.equal(calls[0].init.headers.Authorization,'Bearer synthetic-only');
 for(const suffix of ['notify/action','arbitrary/snapshot']){const bad=new Request('https://api.test/control/api/discord-bot/'+suffix);await assert.rejects(discordBotControl(bad,new URL(bad.url),bindings),e=>e.status===404)}
 const invalid=new Request(req.url,{method:'POST',body:'{"action":"reboot"}'});await assert.rejects(discordBotControl(invalid,new URL(invalid.url),bindings),e=>e.status===400);
});
test('owner settings use the same private authenticated transport and fixed bot',async t=>{
 let called;t.mock.method(globalThis,'fetch',async(url,init)=>{called={url:String(url),init};return Response.json({ok:true})});const bindings={X_BOT_CONTROL_URL:'https://dash.test/internal/x-bot',X_BOT_CONTROL_TOKEN:'synthetic'};
 const req=new Request('https://api.test/control/api/discord-bot/notify/settings',{method:'POST',body:'{"sources":{"live":{"enabled":false}}}'});await discordBotControl(req,new URL(req.url),bindings);assert.ok(called.url.endsWith('/discord/notify/settings'));assert.equal(JSON.parse(called.init.body).sources.live.enabled,false);
 const bad=new Request('https://api.test/control/api/discord-bot/cavallery/settings');await assert.rejects(discordBotControl(bad,new URL(bad.url),bindings),e=>e.status===404);
});

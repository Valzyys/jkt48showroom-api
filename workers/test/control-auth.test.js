import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pbkdf2Sync} from 'node:crypto';
import {authenticated,verifyPassword,sessionCookie} from '../src/control/auth.js';

test('control password is exact and session rejects tampering and different accounts',async()=>{
 const password='synthetic-test-password';const salt='synthetic-salt';
 const hash='pbkdf2-sha256$100000$'+salt+'$'+pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex');
 assert.equal(await verifyPassword(password,hash),true);assert.equal(await verifyPassword(password+' ',hash),false);
 const bindings={CONTROL_ADMIN_EMAIL:'admin@example.test',CONTROL_SESSION_SECRET:'synthetic-session-secret'};
 const cookie=await sessionCookie(bindings);
 assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);
 assert.equal(await authenticated(new Request('https://api.test/control/api/session',{headers:{Cookie:cookie}}),bindings),true);
 assert.equal(await authenticated(new Request('https://api.test/control/api/session',{headers:{Cookie:cookie.replace('=', '=tampered')}}),bindings),false);
 assert.equal(await authenticated(new Request('https://api.test/control/api/session',{headers:{Cookie:cookie}}),{...bindings,CONTROL_ADMIN_EMAIL:'different@example.test'}),false);
});

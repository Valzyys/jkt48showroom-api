import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,stat,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareEnvironment,requiredSecrets } from '../scripts/prepare-env.js';
import { deploy,parseArguments } from '../scripts/deploy.js';

async function fixture(t) {
  const root=await mkdtemp(path.join(tmpdir(),'jkt48-setup-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(path.join(root,'wrangler.jsonc'),await readFile(new URL('../wrangler.jsonc',import.meta.url)));
  return root;
}
test('deployment config reuses provisioned resources and matches the connected Worker name',async()=>{
  const config=JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
  assert.equal(config.name,'jkt48showroom-api');
  const db=config.d1_databases.find(item=>item.binding==='DB');
  assert.equal(db.database_name,`${config.name}-db`);
  assert.match(db.database_id,/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  assert.equal(db.migrations_dir,'migrations');
  assert.equal(config.r2_buckets.find(item=>item.binding==='IMAGES_BUCKET').bucket_name,`${config.name}-images-bucket`);
});
test('setup generates independent valid secrets with private permissions and reuses them',async t=>{
  const root=await fixture(t), first=await prepareEnvironment({root,environment:{}}), second=await prepareEnvironment({root,environment:{}});
  assert.deepEqual(first.secrets,second.secrets);assert.equal(first.secrets.SECRET.length,32);assert.equal(new Set(Object.values(first.secrets)).size,4);
  assert.equal((await stat(first.secretsFile)).mode&0o777,0o600);assert.equal((await stat(path.join(root,'.setup'))).mode&0o777,0o700);
});
test('local user environment is preserved and invalid custom secrets are rejected',async t=>{
  const root=await fixture(t);await writeFile(path.join(root,'.dev.vars'),'USER_SETTING=existing\n');
  await prepareEnvironment({root,environment:{}});assert.equal(await readFile(path.join(root,'.dev.vars'),'utf8'),'USER_SETTING=existing\n');
  const other=await fixture(t);await assert.rejects(prepareEnvironment({root:other,environment:{SECRET:'too-short'}}),/Invalid SECRET/);
});
test('dry run performs no account queries, remote creation or migration',async t=>{
  const root=await fixture(t),calls=[];
  await deploy({root,dryRun:true,outdir:'dist',environment:{},runner:async(args)=>{calls.push(args);return {};}});
  assert.equal(calls.length,1);assert.ok(calls[0].includes('--dry-run'));
  const secrets=JSON.parse(await readFile(path.join(root,'.setup/upload-secrets.json'),'utf8'));assert.deepEqual(Object.keys(secrets),requiredSecrets);
});
test('existing Worker secrets are not rotated and migration follows provisioning',async t=>{
  const root=await fixture(t),calls=[];
  await deploy({root,environment:{},runner:async(args,options)=>{calls.push({args,options});return {stdout:JSON.stringify(requiredSecrets.map(name=>({name,type:'secret_text'})))};}});
  assert.deepEqual(JSON.parse(await readFile(path.join(root,'.setup/upload-secrets.json'),'utf8')),{});
  assert.equal(calls[0].args[0],'secret');assert.equal(calls[1].args[0],'deploy');assert.deepEqual(calls[2].args.slice(0,5),['d1','migrations','apply','DB','--remote']);assert.equal(calls[2].options.environment.CI,'true');
});
test('a new Worker gets all core secrets with its first deployment',async t=>{
  const root=await fixture(t),calls=[];
  const result=await deploy({root,environment:{},runner:async args=>{calls.push(args);if(args[0]==='secret')throw Object.assign(new Error('Missing Worker'),{stderr:'Worker "jkt48showroom-api-workers" not found.'});return {};}});
  assert.deepEqual(result.createdSecrets,requiredSecrets);assert.equal(calls.length,3);
});
test('authentication failures stop setup instead of being treated as a missing Worker',async t=>{
  const root=await fixture(t),calls=[];
  await assert.rejects(deploy({root,environment:{},runner:async args=>{calls.push(args);throw Object.assign(new Error('Authentication failed'),{stderr:'Invalid API token'});}}),/Authentication failed/);
  assert.equal(calls.length,1);
});
test('explicit rotation changes keys, and failed deploy does not run migrations',async t=>{
  const root=await fixture(t),first=await prepareEnvironment({root,environment:{}});
  const result=await deploy({root,environment:{},rotate:true,runner:async()=>({})});
  const second=JSON.parse(await readFile(first.secretsFile,'utf8'));assert.notEqual(first.secrets.API_KEY,second.API_KEY);assert.equal(result.createdSecrets.length,4);
  const calls=[];
  await assert.rejects(deploy({root,dryRun:true,runner:async args=>{calls.push(args);throw new Error('Build failed');}}),/Build failed/);assert.equal(calls.length,1);
  assert.throws(()=>parseArguments(['--env','production']),/Unsupported argument/);
});

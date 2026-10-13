import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareEnvironment,projectRoot,writePrivateJSON } from './prepare-env.js';

export async function runWrangler(args,{root=projectRoot,capture=false,environment={}}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[path.join(root,'node_modules/wrangler/bin/wrangler.js'),...args],{
      cwd:root,env:{...process.env,...environment},stdio:capture?['ignore','pipe','pipe']:'inherit',shell:false
    });
    let stdout='',stderr='';
    if(capture){child.stdout.on('data',data=>{stdout+=data;});child.stderr.on('data',data=>{stderr+=data;});}
    child.on('error',reject);
    child.on('close',(code,signal)=>{if(code===0)resolve({stdout,stderr});else reject(Object.assign(new Error(`Wrangler ${args[0]} failed${signal?' ('+signal+')':''}`),{code,stdout,stderr}));});
  });
}
export function parseArguments(args) {
  const options={dryRun:false,rotate:false,outdir:undefined};
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--dry-run')options.dryRun=true;
    else if(args[i]==='--rotate-secrets')options.rotate=true;
    else if(args[i]==='--outdir'&&args[i+1])options.outdir=args[++i];
    else throw new Error(`Unsupported argument: ${args[i]}`);
  }
  if(options.dryRun&&options.rotate)throw new Error('Secret rotation requires a real deployment');
  return options;
}
export async function deploy({root=projectRoot,runner=runWrangler,environment=process.env,dryRun=false,rotate=false,outdir}={}) {
  const config=path.join(root,'wrangler.jsonc');
  const prepared=await prepareEnvironment({root,environment,rotate});
  let existing=[];
  if(!dryRun&&!rotate) {
    try {
      const result=await runner(['secret','list','--format','json','--config',config],{root,capture:true});
      const listed=JSON.parse(result.stdout);
      if(!Array.isArray(listed)||listed.some(item=>typeof item.name!=='string'))throw new Error('Unexpected Wrangler secret list response');
      existing=listed.map(item=>item.name);
    } catch(error) {
      if(!/Worker "[^"\r\n]+"[^\r\n]*not found/i.test((error.stderr||'')+'\n'+(error.stdout||'')))throw error;
    }
  }
  const additions=Object.fromEntries(Object.entries(prepared.secrets).filter(([name])=>!existing.includes(name)));
  const uploadFile=path.join(root,'.setup','upload-secrets.json');
  await writePrivateJSON(uploadFile,additions);
  const args=['deploy','--config',config,'--secrets-file',uploadFile];
  if(dryRun)args.push('--dry-run');
  if(outdir)args.push('--outdir',outdir);
  // Wrangler provisions missing D1/R2 bindings and writes their IDs to config.
  // Durable Object namespaces are created by the configured v1 migration.
  await runner(args,{root});
  if(!dryRun)await runner(['d1','migrations','apply','DB','--remote','--config',config],{root,environment:{CI:'true'}});
  return {dryRun,createdSecrets:Object.keys(additions),preservedSecrets:existing};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  deploy(parseArguments(process.argv.slice(2))).then(result=>console.log(result.dryRun?'Build verified; no Cloudflare resources changed.':'Deployment and D1 migrations completed. Existing secrets were preserved unless rotation was requested.')).catch(error=>{
    console.error(error.message);
    if(error.stderr)console.error(error.stderr);
    process.exitCode=1;
  });
}

import { randomBytes } from 'node:crypto';
import { mkdir,readFile,writeFile,chmod,lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const requiredSecrets=['SECRET','AUTH_SECRET','JWT_SECRET','API_KEY'];
export const projectRoot=path.resolve(import.meta.dirname,'..');
export function validateSecrets(secrets) {
  for(const name of requiredSecrets) {
    const value=secrets[name];
    if(typeof value!=='string'||(name==='SECRET'?!/^[\x20-\x7e]{32}$/.test(value):value.length<32)) throw new Error(`Invalid ${name}: ${name==='SECRET'?'use exactly 32 ASCII characters':'use at least 32 characters'}`);
  }
  return Object.fromEntries(requiredSecrets.map(name=>[name,secrets[name]]));
}
export async function writePrivateJSON(filename,value) {
  try {const info=await lstat(filename);if(!info.isFile()||info.isSymbolicLink())throw new Error('Refusing a non-regular setup file');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  await writeFile(filename,JSON.stringify(value,null,2)+'\n',{mode:0o600});
  await chmod(filename,0o600);
}
export async function prepareEnvironment({root=projectRoot,environment=process.env,rotate=false}={}) {
  const directory=path.join(root,'.setup');
  const secretsFile=path.join(directory,'secrets.json');
  await mkdir(directory,{recursive:true,mode:0o700});
  const directoryInfo=await lstat(directory);
  if(!directoryInfo.isDirectory()||directoryInfo.isSymbolicLink())throw new Error('Refusing a non-directory setup path');
  await chmod(directory,0o700);
  let secrets;
  if(!rotate) {
    try {const info=await lstat(secretsFile);if(!info.isFile()||info.isSymbolicLink())throw new Error('Refusing a non-regular secrets file');secrets=validateSecrets(JSON.parse(await readFile(secretsFile,'utf8')));}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  if(!secrets) {
    secrets=validateSecrets(Object.fromEntries(requiredSecrets.map(name=>[name,environment[name]||randomBytes(name==='SECRET'?16:32).toString('hex')])));
    if(rotate)await writePrivateJSON(secretsFile,secrets);
    else {
      try {await writeFile(secretsFile,JSON.stringify(secrets,null,2)+'\n',{flag:'wx',mode:0o600});}
      catch(error){if(error.code!=='EEXIST')throw error;secrets=validateSecrets(JSON.parse(await readFile(secretsFile,'utf8')));}
    }
  }
  await chmod(secretsFile,0o600);
  const localFile=path.join(root,'.dev.vars');
  try {await writeFile(localFile,requiredSecrets.map(name=>`${name}=${JSON.stringify(secrets[name])}`).join('\n')+'\n',{flag:'wx',mode:0o600});}
  catch(error){if(error.code!=='EEXIST')throw error;}
  return {secrets,secretsFile};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  prepareEnvironment().then(()=>console.log('Local environment prepared. Secret values are not printed.')).catch(error=>{console.error(error.message);process.exitCode=1;});
}

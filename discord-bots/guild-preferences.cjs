const fs=require('node:fs'),path=require('node:path');
const folder=()=>path.join(__dirname,'Discord/channel');
function all(){try{return JSON.parse(fs.readFileSync(path.join(folder(),'guild-preferences.json'),'utf8'))}catch(e){if(e.code==='ENOENT')return{};throw e}}
function get(id){return all()[id]||{}}
function save(id,value){const file=path.join(folder(),'guild-preferences.json'),data=all();data[id]={...data[id],...value};fs.writeFileSync(file+'.tmp',JSON.stringify(data),{mode:0o600});fs.renameSync(file+'.tmp',file)}
function lock(fn){const dir=path.join(folder(),'.settings-lock');try{fs.mkdirSync(dir,{mode:0o700});fs.writeFileSync(path.join(dir,'pid'),String(process.pid))}catch(e){if(e.code!=='EEXIST')throw e;let stale=false;try{const pid=Number(fs.readFileSync(path.join(dir,'pid'),'utf8'));try{process.kill(pid,0)}catch(error){if(error.code==='ESRCH')stale=true}}catch{}if(stale){fs.rmSync(dir,{recursive:true,force:true});return lock(fn)}throw Object.assign(Error('Pengaturan sedang diperbarui. Coba lagi.'),{status:409})}try{return fn()}finally{fs.rmSync(dir,{recursive:true,force:true})}}
module.exports={all,get,save,lock};

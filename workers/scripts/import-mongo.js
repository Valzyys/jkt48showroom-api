import { readFile,mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function normalize(value) {
  if(Array.isArray(value)) return value.map(normalize);
  if(value && typeof value==='object') {
    if(Object.keys(value).length===1) {
      if('$oid' in value) return value.$oid;
      if('$date' in value) { const raw=typeof value.$date==='object'?Number(value.$date.$numberLong):value.$date; const date=new Date(raw); if(Number.isNaN(date.getTime())) throw new Error('Invalid exported date'); return date.toISOString(); }
      for(const type of ['$numberInt','$numberDouble','$numberLong']) if(type in value) { const number=Number(value[type]); if(!Number.isFinite(number)) throw new Error('Unsupported exported number'); return type==='$numberLong'&&!Number.isSafeInteger(number)?value[type]:number; }
      if('$numberDecimal' in value || '$binary' in value || '$regularExpression' in value) throw new Error('Unsupported Extended JSON value; convert explicitly before import');
    }
    return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,normalize(item)]));
  }
  return value;
}
export function importStatements(text,database,collection,upsert=false) {
  if(!['dcDB','jkt48DB','liveDB','userDB'].includes(database)) throw new Error('Choose dcDB, jkt48DB, liveDB or userDB');
  if(!/^[\w-]+$/.test(collection)) throw new Error('Invalid collection name');
  const trimmed=text.trim();
  const documents=trimmed.startsWith('[')?JSON.parse(trimmed):trimmed.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
  const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
  return documents.map(raw=>{
    const document=normalize(raw);
    if(document._id==null) throw new Error('Every exported document needs _id');
    document._id=String(document._id);
    const encoded=JSON.stringify(document);
    if(new TextEncoder().encode(encoded).byteLength>1800000) throw new Error('Document exceeds D1 limit; archive large payloads before import');
    const conflict=upsert?' ON CONFLICT(database_name,collection_name,id) DO UPDATE SET document=excluded.document,version=documents.version+1':'';
    return `INSERT INTO documents(database_name,collection_name,id,document) VALUES(${quote(database)},${quote(collection)},${quote(document._id)},${quote(encoded)})${conflict};`;
  });
}
async function main() {
  const options={};
  const args=process.argv.slice(2);
  for(let i=0;i<args.length;i++) { if(args[i]==='--upsert') options.upsert=true; else options[args[i].replace(/^--/,'')]=args[++i]; }
  if(!options.input||!options.database||!options.collection||!options.output) throw new Error('Usage: node scripts/import-mongo.js --input export.json --database liveDB --collection livelogs --output exports/livelogs [--upsert]');
  const statements=importStatements(await readFile(options.input,'utf8'),options.database,options.collection,options.upsert);
  await mkdir(options.output,{recursive:true});
  for(let i=0;i<statements.length;i+=100) await writeFile(path.join(options.output,String(i/100).padStart(5,'0')+'.sql'),statements.slice(i,i+100).join('\n')+'\n');
  console.log(`Generated ${statements.length} INSERT statements in ${Math.ceil(statements.length/100)} SQL files. No remote data changed.`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(error=>{console.error(error.message);process.exitCode=1;});

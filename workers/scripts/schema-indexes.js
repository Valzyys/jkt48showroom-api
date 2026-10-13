import { registerHooks } from 'node:module';
import { readdir,writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL,fileURLToPath } from 'node:url';
const root=path.resolve(import.meta.dirname,'../src');
registerHooks({resolve(specifier,context,next){
  if(specifier.startsWith('dayjs/')&&!specifier.endsWith('.js')) return next(specifier+'.js',context);
  let destination;
  if(specifier==='mongoose') destination=path.join(root,'runtime/database.js');
  else if(specifier.startsWith('@/')) destination=path.join(root,specifier.slice(2));
  else if(specifier.startsWith('@schema/')) destination=path.join(root,'database/schema',specifier.slice(8));
  else if(specifier.startsWith('@utils/')) destination=path.join(root,'utils',specifier.slice(7));
  else if(specifier.startsWith('.')&&context.parentURL) destination=path.resolve(path.dirname(fileURLToPath(context.parentURL)),specifier);
  if(destination){for(const candidate of [destination,destination+'.js',path.join(destination,'index.js')]) if(existsSync(candidate)&&candidate.endsWith('.js')) return {url:pathToFileURL(candidate).href,shortCircuit:true};}
  return next(specifier,context);
}});
async function visit(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const filename=path.join(directory,entry.name);if(entry.isDirectory())await visit(filename);else if(entry.name.endsWith('.js')&&entry.name!=='index.js') await import(pathToFileURL(filename).href);}}
await visit(path.join(root,'database'));
const {registeredModels}=await import('../src/runtime/database.js');
const {jsonPath}=await import('../src/runtime/filters.js');
const lines=['-- Generated from source schema unique declarations.'];
for(const model of registeredModels()){
  const indexes=model.schema.indexes.filter(index=>index.options.unique).map(index=>Object.keys(index.fields));
  for(const [field,definition]of Object.entries(model.schema.definition)) if(definition?.unique&&!indexes.some(fields=>fields.includes(field))) indexes.push([field]);
  for(const fields of indexes){
    const expressions=fields.map(field=>`json_extract(document,'${jsonPath(field)}')`);
    const name=[model.databaseName,model.collection.name,...fields].join('_').replace(/[^\w]/g,'_');
    lines.push(`CREATE UNIQUE INDEX IF NOT EXISTS source_unique_${name} ON documents(${expressions.join(',')}) WHERE database_name='${model.databaseName}' AND collection_name='${model.collection.name}' AND ${expressions.map(expression=>expression+' IS NOT NULL').join(' AND ')};`);
  }
}
await writeFile(new URL('../migrations/0002_source_unique_indexes.sql',import.meta.url),lines.join('\n')+'\n');
console.log(`Generated ${lines.length-1} source unique indexes.`);

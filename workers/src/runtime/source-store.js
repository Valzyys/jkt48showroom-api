import { createHash } from 'node:crypto';
import lodash from 'lodash';
const {mergeWith,set}=lodash;

export function createSourceStore(DB) {
  const pending=new Map();
  function upsert(model,key,values,defaults={}) {
    const [field,keyValue]=Object.entries(key)[0];
    if(Object.keys(key).length!==1||!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field))throw new Error('Invalid source document key');
    const groupKey=`${model.databaseName}:${model.collection.name}:${field}`;
    if(!pending.has(groupKey))pending.set(groupKey,{model,field,defaults,rows:new Map()});
    const group=pending.get(groupKey),id=createHash('sha256').update(`${groupKey}:${keyValue}`).digest('hex').slice(0,24);
    const patch={};
    for(const [name,value]of Object.entries(values))if(value!==undefined&&name!=='_id')set(patch,name,value);
    const row=group.rows.get(String(keyValue))||{_id:field==='_id'?String(keyValue):id};
    group.rows.set(String(keyValue),mergeWith(row,patch,key,(_old,value)=>Array.isArray(value)?value:undefined));
  }
  async function flush() {
    for(const {model,field,defaults,rows}of pending.values()) {
      const items=[...rows.values()];
      for(let offset=0;offset<items.length;offset+=100) {
        const json=JSON.stringify(items.slice(offset,offset+100));
        // One set-based write per collection/batch; preserve imported IDs and
        // unrelated fields atomically rather than reading and rewriting rows.
        await DB.prepare(`INSERT INTO documents(database_name,collection_name,id,document)
          SELECT ?,?,COALESCE(old.id,json_extract(item.value,'$._id')),
            json_set(json_patch(CASE WHEN old.id IS NULL THEN ? ELSE '{}' END,item.value),'$._id',COALESCE(old.id,json_extract(item.value,'$._id')))
          FROM json_each(?) AS item LEFT JOIN documents AS old
            ON old.database_name=? AND old.collection_name=? AND json_extract(old.document,?)=json_extract(item.value,?)
          WHERE true
          ON CONFLICT(database_name,collection_name,id) DO UPDATE SET
            document=json_patch(documents.document,excluded.document),version=documents.version+1`)
          .bind(model.databaseName,model.collection.name,JSON.stringify({__v:0,...defaults}),json,model.databaseName,model.collection.name,`$.${field}`,`$.${field}`).run();
      }
    }
    pending.clear();
  }
  return {upsert,flush};
}

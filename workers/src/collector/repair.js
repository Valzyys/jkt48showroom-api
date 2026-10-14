const view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
const u32=(b,n)=>view(b).getUint32(n);
const concat=chunks=>{const b=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let i=0;for(const c of chunks){b.set(c,i);i+=c.length}return b};
const text=b=>String.fromCharCode(...b);
const ascii=s=>Uint8Array.from(s,c=>c.charCodeAt(0));
const box=(kind,payload)=>{const b=new Uint8Array(8+payload.length);view(b).setUint32(0,b.length);b.set(ascii(kind),4);b.set(payload,8);return b};
function* boxes(data){for(let i=0;i<data.length;){if(i+8>data.length)throw Error('Truncated box');const size=u32(data,i);if(size<8||i+size>data.length)throw Error('Unsupported box');yield [text(data.subarray(i+4,i+8)),data.subarray(i+8,i+size)];i+=size}}
function descriptor(data,offset=0){const tag=data[offset];let start=offset+1,length=0,done=false;for(let i=0;i<4;i++){const b=data[start++];length=(length<<7)|(b&127);if(!(b&128)){done=true;break}}const end=start+length;if(!done||end>data.length)throw Error('Invalid descriptor');return [tag,data.subarray(start,end),end]}
const desc=(tag,payload)=>concat([Uint8Array.of(tag,128|((payload.length>>21)&127),128|((payload.length>>14)&127),128|((payload.length>>7)&127),payload.length&127),payload]);
const rates=[96000,88200,64000,48000,44100,32000,24000,22050,16000,12000,11025,8000,7350];
export function repairMoov(data){
 const children=payload=>concat([...boxes(payload)].map(([kind,value])=>transform(kind,value)));
 function transform(kind,payload){
  if(['moov','trak','mdia','minf','stbl'].includes(kind))payload=children(payload);
  else if(kind==='stsd')payload=concat([payload.subarray(0,8),children(payload.subarray(8))]);
  else if(kind==='mp4a'){
   if(view(payload).getUint16(8)!==0)throw Error('Unsupported sample entry');const channels=view(payload).getUint16(16),rate=u32(payload,24)>>>16;
   payload=concat([payload.subarray(0,28),...([...boxes(payload.subarray(28))].map(([child,value])=>{
    if(child==='esds'){
     const [tag,es,end]=descriptor(value,4);if(tag!==3||es[2]!==0)throw Error('Unsupported ES descriptor');const [decoderTag,decoder,next]=descriptor(es,3);if(decoderTag!==4||decoder[0]!==64)throw Error('Unsupported audio codec');
     if(decoder.length===13){const index=rates.indexOf(rate);if(index<0||channels<1||channels>7)throw Error('Unsupported AAC format');const config=(2<<11)|(index<<7)|(channels<<3);value=concat([value.subarray(0,4),desc(3,concat([es.subarray(0,3),desc(4,concat([decoder,desc(5,Uint8Array.of(config>>8,config&255))])),es.subarray(next)])),value.subarray(end)])}
    }return box(child,value);
   }))]);
  }return box(kind,payload);
 }return children(data);
}
export function repairMfra(data,delta){
 if(!delta)return data;
 return concat([...boxes(data)].map(([kind,payload])=>{
  if(kind==='mfra')payload=repairMfra(payload,delta);
  else if(kind==='tfra'){
   payload=payload.slice();const d=view(payload),width=payload[0]===1?8:4,lengths=u32(payload,8),count=u32(payload,12),skip=((lengths>>4)&3)+1+((lengths>>2)&3)+1+(lengths&3)+1;let position=16;
   for(let i=0;i<count;i++){position+=width;if(width===8)d.setBigUint64(position,d.getBigUint64(position)+BigInt(delta));else d.setUint32(position,d.getUint32(position)+delta);position+=width+skip}
  }return box(kind,payload);
 }));
}
async function updateRecording(env,data_id,run,bytes){
 const row=await env.DB.prepare("SELECT id,document FROM documents WHERE database_name='liveDB' AND collection_name='livelogs' AND json_extract(document,'$.data_id')=?").bind(data_id).first();
 if(!row)return;const doc=JSON.parse(row.document),index=doc.recordings?.findIndex(r=>r.run===run);if(index===undefined||index<0)return;
 await env.DB.prepare("UPDATE documents SET document=json_set(document,?,?),version=version+1 WHERE database_name='liveDB' AND collection_name='livelogs' AND id=?").bind('$.recordings['+index+'].bytes',bytes,row.id).run();
}
export async function repairVideo(env,data_id,run){
 const key='live-screenshots/'+data_id+'/video-'+run+'.mp4',source=await env.IMAGES_BUCKET.get(key);if(!source)return {missing:true};
 // A completed object exists at this key. Old, interrupted repair uploads can be safely aborted.
 const old=await env.DB.prepare('SELECT * FROM collector_video_uploads WHERE data_id=? AND run=?').bind(data_id,run).all();
 for(const row of old.results){try{await env.IMAGES_BUCKET.resumeMultipartUpload(row.object_key,row.upload_id).abort()}catch{}await env.DB.prepare('DELETE FROM collector_video_uploads WHERE id=?').bind(row.id).run()}
 const reader=source.body.getReader();let current=new Uint8Array(),position=0,done=false;
 async function read(n){const chunks=[];let length=0;while(length<n){if(position===current.length){const item=await reader.read();if(item.done){done=true;break}current=item.value;position=0}const take=Math.min(n-length,current.length-position);chunks.push(current.subarray(position,position+take));position+=take;length+=take}return concat(chunks)}
 const partSize=5*1024*1024;let buffer=new Uint8Array(partSize),used=0,upload,uploadId,delta=0,bytes=0;const parts=[];
 async function emit(data){let offset=0;while(offset<data.length){const count=Math.min(partSize-used,data.length-offset);buffer.set(data.subarray(offset,offset+count),used);used+=count;offset+=count;if(used===partSize){parts.push(await upload.uploadPart(parts.length+1,buffer));bytes+=used;buffer=new Uint8Array(partSize);used=0}}}
 try{
  while(!done){const header=await read(8);if(!header.length)break;if(header.length!==8)throw Error('Truncated box');const size=u32(header,0),kind=text(header.subarray(4,8));if(size<8)throw Error('Unsupported box');
   if(['moov','mfra'].includes(kind)){
    if(size>1048576)throw Error('Oversized metadata');const raw=concat([header,await read(size-8)]);if(raw.length!==size)throw Error('Truncated metadata');
    if(kind==='moov'){const fixed=repairMoov(raw);delta=fixed.length-raw.length;if(!delta){await reader.cancel();await updateRecording(env,data_id,run,source.size);return {repaired:false,bytes:source.size}}upload=await env.IMAGES_BUCKET.createMultipartUpload(key,{httpMetadata:source.httpMetadata,customMetadata:{...source.customMetadata,aac_config_version:'2'}});uploadId=crypto.randomUUID();await env.DB.prepare('INSERT INTO collector_video_uploads(id,data_id,run,object_key,upload_id,updated_at) VALUES(?,?,?,?,?,?)').bind(uploadId,data_id,run,key,upload.uploadId,Date.now()).run();await emit(fixed)}
    else await emit(repairMfra(raw,delta));
   }else{
    if(!upload&&kind!=='ftyp')throw Error('Unexpected MP4 ordering');
    if(upload)await emit(header);else{buffer.set(header,used);used+=header.length}
    let remaining=size-8;while(remaining){const chunk=await read(Math.min(65536,remaining));if(!chunk.length)throw Error('Truncated media');if(upload)await emit(chunk);else{buffer.set(chunk,used);used+=chunk.length}remaining-=chunk.length}
   }
  }
  if(!upload||!delta)throw Error('Missing metadata');if(used){parts.push(await upload.uploadPart(parts.length+1,buffer.subarray(0,used)));bytes+=used}
  if(bytes!==source.size+delta)throw Error('Invalid repaired size');await upload.complete(parts);await updateRecording(env,data_id,run,bytes);await env.DB.prepare('DELETE FROM collector_video_uploads WHERE id=?').bind(uploadId).run();return {repaired:true,bytes,delta};
 }catch(error){if(upload)await upload.abort().catch(()=>{});if(uploadId)await env.DB.prepare('DELETE FROM collector_video_uploads WHERE id=?').bind(uploadId).run();throw error}finally{reader.releaseLock()}
}

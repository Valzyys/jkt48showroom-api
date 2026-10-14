// Read the existing fragment index to make duration discoverable without scanning media.
const cache=new Map();
const dv=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
function boxes(b,start=0,end=b.length){const result=[];for(let p=start;p+8<=end;){const n=dv(b).getUint32(p),kind=String.fromCharCode(...b.subarray(p+4,p+8));if(n<8||p+n>end)break;result.push({kind,p,start:p+8,end:p+n});p+=n}return result}
const children=(b,x)=>boxes(b,x.start,x.end);
const find=(b,x,k)=>children(b,x).find(c=>c.kind===k);
const read=async(bucket,key,offset,length)=>{const r=await bucket.get(key,{range:{offset,length}});return new Uint8Array(await r.arrayBuffer())};
const integer=(b,p,n)=>n===8?Number(dv(b).getBigUint64(p)):dv(b).getUint32(p);
function lastFragment(b,track){
 const moof=boxes(b).find(x=>x.kind==='moof');if(!moof)return null;
 for(const traf of children(b,moof).filter(x=>x.kind==='traf')){
  const h=find(b,traf,'tfhd'),t=find(b,traf,'tfdt');if(!h||!t||dv(b).getUint32(h.start+4)!==track)continue;
  const flags=dv(b).getUint32(h.start)&0xffffff;let p=h.start+8;
  if(flags&1)p+=8;if(flags&2)p+=4;const defaultDuration=flags&8?dv(b).getUint32(p):0;
  const base=integer(b,t.start+4,b[t.start]===1?8:4);let duration=0;
  for(const r of children(b,traf).filter(x=>x.kind==='trun')){
   const f=dv(b).getUint32(r.start)&0xffffff,count=dv(b).getUint32(r.start+4);let q=r.start+8;if(f&1)q+=4;if(f&4)q+=4;
   const width=((f&256)?4:0)+((f&512)?4:0)+((f&1024)?4:0)+((f&2048)?4:0);
   if(q+width*count>r.end)return null;
   for(let i=0;i<count;i++){duration+=(f&256)?dv(b).getUint32(q):defaultDuration;q+=width}
  }return base+duration;
 }return null;
}
export async function durationHeader(bucket,key,metadata){
 const token=key+':'+metadata.etag;if(cache.has(token))return cache.get(token);
 const promise=(async()=>{
  if(metadata.size<1024)return null;
  const tail=await read(bucket,key,metadata.size-Math.min(metadata.size,262144),Math.min(metadata.size,262144));
  if(tail.length<16||String.fromCharCode(...tail.subarray(tail.length-12,tail.length-8))!=='mfro')return null;
  const size=dv(tail).getUint32(tail.length-4);if(size>tail.length||size<16)return null;
  const mfra=tail.subarray(tail.length-size),root=boxes(mfra)[0],tracks=new Map();
  for(const x of children(mfra,root).filter(x=>x.kind==='tfra')){
   const width=mfra[x.start]===1?8:4,id=dv(mfra).getUint32(x.start+4),lens=dv(mfra).getUint32(x.start+8),count=dv(mfra).getUint32(x.start+12),skip=((lens>>4)&3)+1+((lens>>2)&3)+1+(lens&3)+1,step=width*2+skip;
   if(!count)continue;const p=x.start+16+(count-1)*step;if(p+step>x.end)return null;
   const entries=[];for(let at=x.start+16;at+step<=x.end&&entries.length<count;at+=step)entries.push({time:integer(mfra,at,width),offset:integer(mfra,at+width,width)});tracks.set(id,{offset:integer(mfra,p+width,width),entries});
  }
  const fragments=new Map();for(const [id,t] of tracks){if(t.offset>=metadata.size)return null;if(!fragments.has(t.offset))fragments.set(t.offset,await read(bucket,key,t.offset,Math.min(65536,metadata.size-t.offset)));t.duration=lastFragment(fragments.get(t.offset),id);if(t.duration===null)return null}
  const head=await read(bucket,key,0,Math.min(262144,metadata.size)),moov=boxes(head).find(x=>x.kind==='moov');if(!moov)return null;
  const original=head.slice(moov.p,moov.end);let fixed=original.slice();const top=boxes(fixed)[0],mvhd=find(fixed,top,'mvhd');if(!mvhd)return null;
  const durationFields=x=>{const v=fixed[x.start],p=x.start+(v===1?20:12);return {scale:dv(fixed).getUint32(p),p:p+4,width:v===1?8:4}};
  const put=(p,width,n)=>{if(width===8)dv(fixed).setBigUint64(p,BigInt(Math.round(n)));else{if(n>0xffffffff)throw Error('Duration overflow');dv(fixed).setUint32(p,Math.round(n))}};
  const movie=durationFields(mvhd);let seconds=0;
  for(const trak of children(fixed,top).filter(x=>x.kind==='trak')){
   const tkhd=find(fixed,trak,'tkhd'),mdia=find(fixed,trak,'mdia');if(!tkhd||!mdia)continue;const mdhd=find(fixed,mdia,'mdhd');if(!mdhd)continue;
   const version=fixed[tkhd.start],id=dv(fixed).getUint32(tkhd.start+(version===1?20:12)),t=tracks.get(id);if(!t)continue;
   const media=durationFields(mdhd);t.scale=media.scale;const handler=find(fixed,mdia,'hdlr');t.video=handler&&String.fromCharCode(...fixed.subarray(handler.start+8,handler.start+12))==='vide';const s=t.duration/media.scale;seconds=Math.max(seconds,s);put(media.p,media.width,t.duration);put(tkhd.start+(version===1?28:20),version===1?8:4,s*movie.scale);
  }put(movie.p,movie.width,seconds*movie.scale);
  const udta=find(fixed,top,'udta'),mvex=find(fixed,top,'mvex');
  if(udta&&mvex&&udta.end-udta.p>=28){
   const mehd=new Uint8Array(20);dv(mehd).setUint32(0,20);mehd.set([109,101,104,100],4);mehd[8]=1;dv(mehd).setBigUint64(12,BigInt(Math.round(seconds*movie.scale)));
   const parts=[fixed.subarray(0,8)];
   for(const child of children(fixed,top)){
    if(child.kind==='mvex'){const expanded=new Uint8Array(child.end-child.p+20);expanded.set(fixed.subarray(child.p,child.end));dv(expanded).setUint32(0,expanded.length);expanded.set(mehd,expanded.length-20);parts.push(expanded)}
    else if(child.kind==='udta'){const free=new Uint8Array(child.end-child.p-20);dv(free).setUint32(0,free.length);free.set([102,114,101,101],4);parts.push(free)}
    else parts.push(fixed.subarray(child.p,child.end));
   }
   const merged=new Uint8Array(fixed.length);let at=0;for(const part of parts){merged.set(part,at);at+=part.length}if(at!==fixed.length)throw Error('Metadata size changed');fixed=merged;
  }
  const indexed=[...tracks.values()].find(t=>t.video)||[...tracks.values()][0];const entries=indexed.entries.filter((e,i,a)=>!i||e.offset!==a[i-1].offset);const segments=entries.map((entry,i)=>({offset:entry.offset,length:(entries[i+1]?.offset??metadata.size-size)-entry.offset,duration:(entries[i+1]?entries[i+1].time/indexed.scale:seconds)-entry.time/indexed.scale}));return {offset:moov.p,bytes:fixed,duration_ms:Math.round(seconds*1000),init_length:entries[0]?.offset,segments};
 })().catch(()=>null);cache.set(token,promise);if(cache.size>100)cache.delete(cache.keys().next().value);return promise;
}
export function patchDurationStream(body,offset,patch){
 if(!patch)return body;let position=offset;
 return body.pipeThrough(new TransformStream({transform(chunk,controller){const start=Math.max(position,patch.offset),end=Math.min(position+chunk.length,patch.offset+patch.bytes.length);if(end>start){chunk=chunk.slice();chunk.set(patch.bytes.subarray(start-patch.offset,end-patch.offset),start-position)}position+=chunk.length;controller.enqueue(chunk)}}));
}

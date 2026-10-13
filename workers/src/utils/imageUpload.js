import { createHash } from 'node:crypto';
import { env, binding } from '@/runtime/env';
import { ofetch } from '@/runtime/http';
function configured() { return env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET; }
export async function uploadImage(image,options={}) {
  if(!configured()) throw Object.assign(new Error('Configure Cloudinary to transform images'),{status:503});
  const timestamp=Math.floor(Date.now()/1000);
  const params={folder:'uploads',...options,timestamp};
  const text=Object.keys(params).filter(key=>params[key]!=null).sort().map(key=>key+'='+params[key]).join('&');
  const signature=createHash('sha1').update(text+env.CLOUDINARY_API_SECRET).digest('hex');
  const form=new FormData();
  for(const [key,value]of Object.entries(params)) if(value!=null) form.set(key,String(value));
  form.set('file',image);
  form.set('api_key',env.CLOUDINARY_API_KEY);
  form.set('signature',signature);
  return ofetch(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/upload`,{method:'POST',body:form,retry:0});
}
export async function uploadImageBuffer(image,mimeType='image/jpeg') {
  const bytes=image instanceof ArrayBuffer?new Uint8Array(image):image;
  if(bytes.byteLength>10*1024*1024) throw Object.assign(new Error('Image too large'),{status:413});
  const data=await uploadImage(new Blob([bytes],{type:mimeType}),{format:'webp'});
  if(!env.IMAGE_PUBLIC_URL) throw Object.assign(new Error('Configure IMAGE_PUBLIC_URL for R2'),{status:503});
  const response=await ofetch.raw(data.secure_url,{responseType:'arrayBuffer'});
  const key='uploads/'+data.public_id.split('/').pop()+'.webp';
  await binding('IMAGES_BUCKET').put(key,response._data,{httpMetadata:{contentType:'image/webp'}});
  const url=String(env.IMAGE_PUBLIC_URL).replace(/\/$/,'')+'/'+key;
  return {...data,url,secure_url:url,format:'webp'};
}
export async function blobToUint8Array(blob) { return new Uint8Array(await blob.arrayBuffer()); }

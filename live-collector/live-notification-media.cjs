// Internal collector jobs may contain the original JKT48 storage path; public
// API responses rewrite that path, but the renderer must also accept raw jobs.
function notificationPhotoURL(source,origin){
 if(typeof source!=='string'||!source.trim())throw Error('Missing member photo');
 let value=source.trim();
 if(/^\/?media\//.test(value)&&!/^\/?media\/jkt48\//.test(value)){
  const path=value.replace(/^\//,'');
  if(!/^media\/[A-Za-z0-9_./-]+\.(?:jpe?g|png|webp)$/i.test(path)||path.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Invalid member photo path');
  value='/media/jkt48/'+path;
 }
 const url=new URL(value,origin+'/');
 if(url.protocol!=='https:'||url.username||url.password)throw Error('Invalid image');
 return url;
}
module.exports={notificationPhotoURL};

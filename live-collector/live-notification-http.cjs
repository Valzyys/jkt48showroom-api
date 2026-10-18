// Try the current DNS IPv4 answers individually. Some VPS routes time out for
// one Cloudflare address while another address for the same hostname works.
// HTTPS still verifies the original hostname; no fixed IP or TLS bypass is used.
const https=require('node:https'),dns=require('node:dns/promises');
const preferred=new Map();
async function request(url,options={}){
 const debug=message=>{if(process.env.NOTIFY_HTTP_DEBUG==='true')console.log('notification-network '+message)};
 const target=new URL(url);if(target.protocol!=='https:')throw Error('HTTPS required');
 const addresses=(await dns.lookup(target.hostname,{all:true})).filter(a=>a.family===4);
 const last=preferred.get(target.hostname);addresses.sort((a,b)=>Number(b.address===last)-Number(a.address===last));
 let failure;
 for(const address of addresses){debug(target.hostname+' address='+address.address);
  try{return await new Promise((resolve,reject)=>{
   const signal=options.signal,body=options.body,headers={...options.headers};if(body)headers['Content-Length']=String(Buffer.byteLength(body));
   const req=https.request(target,{method:options.method||'GET',headers,agent:false,lookup:(_host,lookupOptions,callback)=>lookupOptions.all?callback(null,[address]):callback(null,address.address,4)},res=>{
    debug('status='+res.statusCode);const chunks=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>8388608)res.destroy(Error('Response too large'));else chunks.push(chunk)});res.on('error',reject);res.on('end',()=>{debug('received='+size);preferred.set(target.hostname,address.address);resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:Object.fromEntries(Object.entries(res.headers).filter(([,v])=>v!==undefined).map(([k,v])=>[k,Array.isArray(v)?v.join(', '):String(v)]))}))});
   });
   const connectTimer=setTimeout(()=>req.destroy(Object.assign(Error('Connection timed out'),{code:'ETIMEDOUT'})),4000);
   req.on('socket',socket=>socket.once('secureConnect',()=>{debug('tls-ready');clearTimeout(connectTimer)}));req.on('close',()=>clearTimeout(connectTimer));
   req.setTimeout(6000,()=>req.destroy(Object.assign(Error('Connection timed out'),{code:'ETIMEDOUT'})));
   const abort=()=>req.destroy(Error('Request aborted'));if(signal?.aborted){abort();reject(Error('Request aborted'));return}signal?.addEventListener('abort',abort,{once:true});req.on('close',()=>signal?.removeEventListener('abort',abort));req.on('error',reject);if(body)req.write(body);req.end();
  })}catch(error){debug('failed='+String(error.code||error.name));failure=error;if(options.signal?.aborted)throw error}
 }
 throw failure||Error('No IPv4 route');
}
module.exports={request};

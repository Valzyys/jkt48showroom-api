const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const script=fs.readFileSync(__dirname+'/../valzy-studio/scripts/shared/license-bridge.js','utf8');
test('bridge translates only owned customer licenses and preserves unrelated requests',async()=>{
 const calls=[],listeners=[];const store={};const context={URL,Request,Response,Headers,JSON,chrome:{storage:{local:{get:async()=>store,set:async value=>Object.assign(store,value)},onChanged:{addListener:l=>listeners.push(l)}}},fetch:async(input,options)=>{calls.push({input,options});if(String(input).includes('/license/v1/validate'))return Response.json({ok:true,upstream_license:'EKLAS-REAL'});return Response.json({ok:true})}};vm.createContext(context);vm.runInContext(script,context);
 await context.fetch('https://api.jkt48connect.app/license/v1/validate',{method:'POST',body:JSON.stringify({key:'VALZY-ALIAS'})});
 await context.fetch('https://io.eklas.dev/api/v1/lovable/chat',{method:'POST',headers:{'Content-Type':'application/json','X-License-Key':'VALZY-ALIAS'},body:JSON.stringify({licenseKey:'VALZY-ALIAS',message:'unchanged prompt',projectId:'same-project',files:[1]})});
 const forwarded=calls.at(-1);assert.equal(forwarded.options.headers.get('X-License-Key'),'EKLAS-REAL');assert.deepEqual(JSON.parse(forwarded.options.body),{licenseKey:'EKLAS-REAL',message:'unchanged prompt',projectId:'same-project',files:[1]});
 const binary=new Uint8Array([1,2,3]);await context.fetch('https://io.eklas.dev/api/v1/media/upload',{method:'POST',headers:{'Content-Type':'image/png','X-License-Key':'VALZY-ALIAS'},body:binary});assert.equal(calls.at(-1).options.body,binary);
 const unchanged={method:'POST',body:'same'};await context.fetch('https://api.lovable.dev/anything',unchanged);assert.equal(calls.at(-1).options,unchanged);
 listeners[0]({valzy_license_credentials:{newValue:{'VALZY-OTHER':'EKLAS-SECOND'}}},'local');await context.fetch('https://io.eklas.dev/api/v1/extension/v5',{headers:{'X-License-Key':'VALZY-OTHER'}});assert.equal(calls.at(-1).options.headers.get('X-License-Key'),'EKLAS-SECOND');
});
test('original feature code is preserved byte for byte',()=>{
 const source='/home/sewanode/.cache/lovable-license/source/';if(!fs.existsSync(source))return;
 for(const file of ['scripts/content/content.js','scripts/content/page-ws.js','scripts/panel/panel.js','scripts/shared/fingerprint.js','scripts/shared/translations.js'])assert.deepEqual(fs.readFileSync(__dirname+'/../valzy-studio/'+file),fs.readFileSync(source+file),file);
 const original=fs.readFileSync(source+'scripts/background.js','utf8');assert.equal(fs.readFileSync(__dirname+'/../valzy-studio/scripts/background.js','utf8'),'importScripts("shared/license-bridge.js");\n'+original);
});

let cached=null,inflight=null,lastError=null;
const endpoint='https://cognito-idp.ap-southeast-1.amazonaws.com/';
const error=code=>Object.assign(new Error(code),{code});
export function idnAuthStatus(env){return {configured:Boolean(env.IDN_REFRESH_TOKEN),clientConfigured:Boolean(env.IDN_COGNITO_CLIENT_ID),ready:Boolean(cached&&cached.refresh===env.IDN_REFRESH_TOKEN&&cached.client===env.IDN_COGNITO_CLIENT_ID&&cached.expiresAt>Date.now()),expiresAt:cached?.expiresAt||null,error:lastError};}
export async function getIdnSession(env,{force=false,fetcher=fetch,now=Date.now()}={}){
 const refresh=String(env.IDN_REFRESH_TOKEN||'').trim(),client=String(env.IDN_COGNITO_CLIENT_ID||'').trim();
 if(!refresh)throw error('idn_refresh_missing');if(!client)throw error('idn_client_missing');
 if(!force&&cached&&cached.refresh===refresh&&cached.client===client&&cached.expiresAt>now)return {accessToken:cached.accessToken,idToken:cached.idToken,expiresAt:cached.expiresAt};
 if(inflight&&inflight.refresh===refresh&&inflight.client===client)return inflight.promise;
 const promise=(async()=>{
  let response;try{response=await fetcher(endpoint,{method:'POST',headers:{'Content-Type':'application/x-amz-json-1.1','X-Amz-Target':'AWSCognitoIdentityProviderService.InitiateAuth'},body:JSON.stringify({AuthFlow:'REFRESH_TOKEN_AUTH',ClientId:client,AuthParameters:{REFRESH_TOKEN:refresh}}),signal:AbortSignal.timeout(15000)})}catch{throw error('idn_auth_network_error')}
  let data;try{data=await response.json()}catch{throw error('idn_auth_invalid_response')}
  if(!response.ok){const mismatch=String(data?.__type||'').includes('NotAuthorizedException')&&String(data?.message||'').toLowerCase().includes('different client');throw error(mismatch?'idn_client_mismatch':response.status===400?'idn_refresh_rejected':'idn_auth_upstream_error')}
  const result=data.AuthenticationResult;if(typeof result?.IdToken!=='string'||typeof result?.AccessToken!=='string')throw error('idn_auth_invalid_response');
  const seconds=Number(result.ExpiresIn||3600);if(!Number.isFinite(seconds)||seconds<=60)throw error('idn_auth_invalid_expiry');
  cached={refresh,client,accessToken:result.AccessToken,idToken:result.IdToken,expiresAt:now+seconds*1000-60000};lastError=null;return {accessToken:cached.accessToken,idToken:cached.idToken,expiresAt:cached.expiresAt};
 })();inflight={refresh,client,promise};
 try{return await promise}catch(e){lastError=e.code||'idn_auth_error';throw error(lastError)}finally{if(inflight?.promise===promise)inflight=null}
}
export async function idnCollectorAuth(env){
 if(!env.IDN_REFRESH_TOKEN)return {...idnAuthStatus(env),ready:false};
 try{return {...idnAuthStatus(env),...await getIdnSession(env),configured:true,ready:true}}catch(e){return {...idnAuthStatus(env),ready:false,error:e.code}}
}

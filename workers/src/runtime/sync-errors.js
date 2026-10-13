import { JKT48SourceError } from './jkt48-source.js';
export function syncIssue(error,phase) {
  if(error instanceof JKT48SourceError)return {code:error.code,message:error.message,upstreamStatus:error.upstreamStatus,phase};
  if(phase==='database'||phase==='persist'||phase==='cache')return {code:'JKT48_SYNC_STORAGE_ERROR',message:'JKT48 synchronization could not access D1. Check database migrations, binding and account limits.',phase};
  return {code:'JKT48_SYNC_ERROR',message:'JKT48 synchronization failed. Check the jkt48-sync-failed event in Worker logs.',phase};
}
export function unavailable(state) {
  return new JKT48SourceError(state.issue?.message||'JKT48 data is unavailable; synchronization failed. Check Worker logs.',{
    status:503,code:state.issue?.code||'JKT48_SYNC_ERROR',upstreamStatus:state.issue?.upstreamStatus,
    retryAfter:Math.max(1,Math.ceil((300000-(Date.now()-(state.attemptedAt||Date.now())))/1000))
  });
}
export function publicSyncError(error,path) {
  if(!(error instanceof JKT48SourceError))return null;
  return {status:error.status,message:error.message,code:error.code,...(error.upstreamStatus?{upstream_status:error.upstreamStatus}:{}),...(path?{path}:{})};
}

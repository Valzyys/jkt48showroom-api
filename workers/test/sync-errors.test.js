import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JKT48SourceError } from '../src/runtime/jkt48-source.js';
import { publicSyncError,syncIssue,unavailable } from '../src/runtime/sync-errors.js';
test('HTTP 403 sync failures preserve safe upstream status through the 503 boundary',()=>{
  const issue=syncIssue(new JKT48SourceError('JKT48 upstream returned HTTP 403',{code:'JKT48_UPSTREAM_HTTP_ERROR',upstreamStatus:403}),'source');
  const error=unavailable({issue,attemptedAt:Date.now()});
  assert.deepEqual(publicSyncError(error,'/api/news'),{status:503,message:'JKT48 upstream returned HTTP 403',code:'JKT48_UPSTREAM_HTTP_ERROR',upstream_status:403,path:'/api/news'});
  assert.ok(error.retryAfter<=300&&error.retryAfter>0);
});
test('D1 diagnostics distinguish storage failures without exposing SQL or secret values',()=>{
  const issue=syncIssue(new Error('SQL includes private-token-value'),'persist');
  assert.equal(issue.code,'JKT48_SYNC_STORAGE_ERROR');assert.ok(!issue.message.includes('private-token-value'));
  assert.equal(publicSyncError(new Error('private-token-value')),null);
});
test('old persisted failure records get a safe diagnostic instead of exposing raw old messages',()=>{
  const response=publicSyncError(unavailable({error:'private-cookie-value',attemptedAt:Date.now()}));
  assert.equal(response.status,503);assert.equal(response.code,'JKT48_SYNC_ERROR');assert.ok(!response.message.includes('private-cookie-value'));
});

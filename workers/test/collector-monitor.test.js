import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectorMonitor} from '../src/control/monitor.js';
const now=1000000;
const session={data_id:'sr-1-2',name:'Test',type:'showroom',completed:false,last_screenshot:now-10000,screenshots_allowed:true,stream_available:true,last_archive:now-10000,archive_error:false,video:{status:'recording',last_part:now-10000,bytes:5242880,parts:1,errors:0}};
const collector={lastSeen:now,active:1,pending:0,showroom_ok:true,idn_ok:true,telemetry:{pid:100,uptime_seconds:60,archive_errors:0,last_archive:now-10000,sessions:[session]}};
test('monitor identifies upload progress and waits for completed sessions before recent',()=>{
 const m=collectorMonitor(collector,{}, {},now);
 assert.equal(m.sessions[0].record.status,'ok');assert.equal(m.sessions[0].screenshot.status,'ok');assert.equal(m.completedCount,0);assert.match(m.recent.message,/Menunggu live selesai/);
 assert.equal(collectorMonitor(collector,{}, {completedCount:2,lastCompleted:now-1000},now).completedCount,2);
});
test('monitor distinguishes stale VPS, stalled media, disabled recording and pending archives',()=>{
 const stale=collectorMonitor({...collector,lastSeen:1},{},{},now);assert.equal(stale.online,false);assert.equal(stale.sessions[0].record.status,'stale');
 const stalled=collectorMonitor({...collector,telemetry:{...collector.telemetry,sessions:[{...session,last_screenshot:1,video:{...session.video,last_part:1}}]}},{},{},now);assert.equal(stalled.sessions[0].screenshot.status,'warning');assert.equal(stalled.sessions[0].record.status,'warning');
 assert.equal(collectorMonitor(collector,{COLLECTOR_RECORD_VIDEO:'false'},{},now).sessions[0].record.status,'disabled');
 assert.equal(collectorMonitor({...collector,pending:1},{},{},now).recent.status,'warning');
 assert.equal(collectorMonitor(null,{},{},now).online,false);
 const buffering=collectorMonitor({...collector,telemetry:{...collector.telemetry,sessions:[{...session,video:{...session.video,last_part:0,bytes:0,parts:0}}]}},{},{},now);assert.equal(buffering.sessions[0].record.status,'waiting');
});

test('recent successful archives distinguish a transient retry from a persistent failure',()=>{
 const view=last_archive=>collectorMonitor({...collector,telemetry:{...collector.telemetry,archive_errors:7,sessions:[{...session,archive_error:true,last_archive}]}},{},{},now);
 const retry=view(now-30000);assert.equal(retry.sessions[0].archive.status,'warning');assert.equal(retry.recent.status,'warning');assert.equal(retry.archiveErrors,7);
 const failed=view(now-90000);assert.equal(failed.sessions[0].archive.status,'error');assert.equal(failed.recent.status,'error');
 assert.equal(view(0).sessions[0].archive.status,'error');
 const firstRetry=collectorMonitor({...collector,telemetry:{...collector.telemetry,sessions:[{...session,last_archive:0,archive_error:true,archive_error_since:now-10000}]}},{},{},now);assert.equal(firstRetry.sessions[0].archive.status,'warning');
 const recovered=collectorMonitor({...collector,telemetry:{...collector.telemetry,archive_errors:7}},{},{},now);assert.equal(recovered.sessions[0].archive.status,'ok');assert.equal(recovered.recent.status,'ok');assert.equal(recovered.archiveErrors,7);
});

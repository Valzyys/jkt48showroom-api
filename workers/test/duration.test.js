import {test} from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {durationHeader,patchDurationStream} from '../src/collector/duration.js';
test('serves a finite MP4 duration from fragment index without changing media bytes',async()=>{
 const p=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=128x72:rate=25','-t','2','-c:v','libx264','-threads','1','-preset','ultrafast','-movflags','frag_keyframe+empty_moov+default_base_moof','-f','mp4','pipe:1'],{maxBuffer:2000000});assert.equal(p.status,0);const bytes=p.stdout;
 const bucket={get:async(key,{range})=>new Blob([bytes.subarray(range.offset,range.offset+range.length)])};const patch=await durationHeader(bucket,'fixture',{size:bytes.length,etag:'fixture'});assert.ok(patch);assert.equal(patch.duration_ms,2000);
 const out=Buffer.from(await new Response(patchDurationStream(new Blob([bytes]).stream(),0,patch)).arrayBuffer());assert.equal(out.length,bytes.length);assert.deepEqual(out.subarray(patch.offset+patch.bytes.length),bytes.subarray(patch.offset+patch.bytes.length));
 const probe=spawnSync('ffprobe',['-v','quiet','-show_entries','format=duration','-of','json','pipe:0'],{input:out});assert.equal(Number(JSON.parse(probe.stdout).format.duration),2);
 const slice=Buffer.from(await new Response(patchDurationStream(new Blob([bytes.subarray(30,2000)]).stream(),30,patch)).arrayBuffer());assert.deepEqual(slice,out.subarray(30,2000));
});

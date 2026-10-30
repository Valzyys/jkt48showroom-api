"""Bounded live verification. Does not install or modify any production service."""
import argparse,asyncio,json,random,re,subprocess,time
from pathlib import Path
from curl_cffi.requests import AsyncSession
from curl_cffi.const import CurlOpt
from parser import parse_embed,SourceError,media_url
from store import Store

TARGETS=['freyajkt48','fionyjkt48','jkt48.fritzy','christyjkt48','graciejkt48','marsha.jkt48']

def inspect_image(file):
 try:
  p=subprocess.run(['/usr/bin/ffprobe','-v','error','-show_entries','stream=width,height,codec_name','-of','json',str(file)],capture_output=True,text=True,timeout=8)
  s=json.loads(p.stdout).get('streams',[{}])[0];return {'decoded':p.returncode==0 and s.get('width',0)>32 and s.get('height',0)>32,**s}
 except Exception as e:return {'decoded':False,'error':type(e).__name__}

async def bounded(s,url,max_size,headers=None):
 if not media_url(url):raise SourceError('unsafe_media_url')
 async with s.stream('GET',url,timeout=20,headers=headers or {'Referer':'https://www.tiktok.com/'},allow_redirects=False)as r:
  if r.status_code not in (200,206):raise SourceError('media_http_'+str(r.status_code))
  total=0;chunks=[]
  async for part in r.aiter_content():
   total+=len(part)
   if total>max_size:raise SourceError('media_sample_too_large')
   chunks.append(part)
  return b''.join(chunks),r.headers.get('content-type'),r.headers.get('content-range')

async def sample_media(s,post,out,name):
 result={};m=post['media']
 if m['thumbnail']:
  try:
   b,mime,_=await bounded(s,m['thumbnail'],2*1024*1024);file=out/(name+'-cover.sample');file.write_bytes(b);result['thumbnail']={'http_success':True,'bytes':len(b),'mime':mime,**inspect_image(file)}
  except Exception as e:result['thumbnail']={'error':str(e)if isinstance(e,SourceError)else type(e).__name__}
 if m['play_url']:
  try:
   b,mime,cr=await bounded(s,m['play_url'],64*1024,{'Range':'bytes=0-4095','Referer':'https://www.tiktok.com/'});result['video']={'http_success':True,'bytes':len(b),'mime':mime,'mp4_header':b'ftyp'in b[:64],'content_range':cr}
  except Exception as e:result['video']={'error':str(e)if isinstance(e,SourceError)else type(e).__name__}
  try:
   p=await asyncio.create_subprocess_exec('/usr/bin/ffprobe','-v','error','-user_agent','Mozilla/5.0','-headers','Referer: https://www.tiktok.com/\r\n','-rw_timeout','10000000','-read_intervals','0%+1','-count_frames','-show_entries','stream=codec_name,codec_type,width,height,nb_read_frames:format=duration','-of','json',m['play_url'],stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL)
   try:stdout,_=await asyncio.wait_for(p.communicate(),18)
   except asyncio.TimeoutError:p.kill();await p.wait();raise SourceError('video_probe_timeout')
   data=json.loads(stdout or b'{}');result['video_probe']={'exit':p.returncode,**data}
  except Exception as e:result['video_probe']={'error':str(e)if isinstance(e,SourceError)else type(e).__name__}
 return result

async def main(args):
 out=Path(args.output);out.mkdir(parents=True,exist_ok=True);store=Store(out/'probe.sqlite');directory=json.loads(Path(args.directory).read_text());allowed={m['username']:m for m in directory if m.get('username')}
 targets=[u for u in TARGETS if u in allowed];stats={u:{'attempts':0,'successes':0,'failures':[],'snapshots':[]}for u in targets};deadline=time.monotonic()+args.seconds;rounds=0
 try:
  async with AsyncSession(impersonate='chrome',max_clients=1,curl_options={CurlOpt.IPRESOLVE:1})as session:
   while time.monotonic()<deadline and any(v['successes']<args.successes and v['attempts']<4 for v in stats.values()):
    rounds+=1
    for username in targets:
     st=stats[username]
     if st['successes']>=args.successes or st['attempts']>=4 or time.monotonic()>=deadline:continue
     started=time.monotonic();st['attempts']+=1;pause=20+random.uniform(0,5)
     try:
      r=await session.get('https://www.tiktok.com/embed/@'+username,timeout=25,allow_redirects=False)
      if r.status_code!=200:
       if r.status_code in (403,429,503):pause=max(60,min(180,30*2**len(st['failures'])))
       raise SourceError('http_'+str(r.status_code))
      result=parse_embed(r.text,username);Path(out/(username+'-latest.html')).write_text(r.text);receipt=store.save(result)
      st['successes']+=1;ids=[p['id']for p in result['posts']];st['snapshots'].append({'ids':ids,'elapsed_ms':round((time.monotonic()-started)*1000),'new':receipt['new_posts']});event={'username':username,'ok':True,'posts':len(ids),'baseline':receipt['baseline'],'new_posts':len(receipt['new_posts']),'attempt':st['attempts']}
      if st['successes']==1 and result['posts']:
       st['media']=await sample_media(session,result['posts'][0],out,username);event['media']=st['media'];sample={**result['posts'][0],'member':{'id':allowed[username]['member'],'name':allowed[username]['name']}};sample['media']={k:v for k,v in sample['media'].items()if k not in ('thumbnail','play_url')};Path(out/(username+'-sample.json')).write_text(json.dumps(sample,ensure_ascii=False,indent=2))
     except Exception as e:
      error=str(e)if isinstance(e,SourceError)else type(e).__name__;store.failure(username,error);st['failures'].append(error);event={'username':username,'ok':False,'error':error,'attempt':st['attempts']}
     report={'scope':'isolated-live-probe','display_api_used':False,'login_used':False,'targets':stats,'database':store.counts(),'complete':all(v['successes']>=args.successes for v in stats.values()),'updated_at':time.time()};Path(out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(event,ensure_ascii=False),flush=True)
     await asyncio.sleep(min(pause,max(0,deadline-time.monotonic())))
   print(json.dumps({'complete':all(v['successes']>=args.successes for v in stats.values()),'successful_profiles':sum(v['successes']>=args.successes for v in stats.values()),'total_profiles':len(targets),'database':store.counts()}),flush=True)
 finally:store.close()

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--directory',required=True);p.add_argument('--output',required=True);p.add_argument('--seconds',type=int,default=600);p.add_argument('--successes',type=int,default=2);asyncio.run(main(p.parse_args()))

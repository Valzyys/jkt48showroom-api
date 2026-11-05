"""Private loopback HLS adapter. Ticket/source URLs stay in memory; no video files."""
import asyncio, datetime as dt, hashlib, hmac, os, re, secrets, time
from urllib.parse import urljoin, urlparse
from zoneinfo import ZoneInfo
import httpx

class SourceError(Exception): pass

class OshigoSource:
    def __init__(self):
        self.base=os.environ['STREAM_PROXY_BASE'].rstrip('/')
        self.origin=os.environ['STREAM_PROXY_ORIGIN']
        self.key=os.environ['STREAM_PROXY_CLIENT_KEY']; self.secret=os.environ['STREAM_PROXY_CLIENT_SECRET']
        self.c=httpx.AsyncClient(timeout=25,follow_redirects=False)
        self.lock=asyncio.Lock();self.selected=None;self.height=None;self.cached_media=None
        self.refresh_at=0;self.assets={};self.cap=secrets.token_urlsafe(32)
        self.headers={'Origin':self.origin,'Referer':self.origin+'/', 'User-Agent':'JKT48Connect-YouTubeRelay/1.1','Accept-Encoding':'identity'}
        self.title_rows=[];self.title_until=0;self.offset=0
    async def start(self):
        self.server=await asyncio.start_server(self.handle,'127.0.0.1',0,limit=16384)
        port=self.server.sockets[0].getsockname()[1]
        self.local=f'http://127.0.0.1:{port}/{self.cap}'
    async def close(self):
        self.server.close();await self.server.wait_closed();await self.c.aclose()
    def validate(self,url):
        p=urlparse(url);b=urlparse(self.base)
        if p.scheme!='https' or p.netloc!=b.netloc or p.username or p.password:
            raise SourceError('proxy_child_host_denied')
    async def fetch_text(self,url,params=None,headers=None):
        self.validate(url)
        async with self.c.stream('GET',url,params=params,headers=headers or self.headers) as r:
            if r.status_code!=200:return r.status_code,''
            chunks=[];size=0
            async for b in r.aiter_bytes():
                size+=len(b)
                if size>1024*1024:raise SourceError('manifest_too_large')
                chunks.append(b)
            return 200,b''.join(chunks).decode('utf-8-sig')
    async def resolve(self):
        async with self.lock:
            if time.monotonic()<self.refresh_at:return self.selected is not None
            ts=str(int((time.time()+self.offset)*1000));nonce=secrets.token_hex(16)
            sig=hmac.new(self.secret.encode(),f'{ts}.{nonce}.GET./auth/ticket'.encode(),hashlib.sha256).hexdigest()
            r=await self.c.get(self.base+'/auth/ticket',headers={**self.headers,'X-Client-Key':self.key,
                'X-Ts':ts,'X-Nonce':nonce,'X-Signature':sig})
            from email.utils import parsedate_to_datetime
            if r.headers.get('date'):
                with __import__('contextlib').suppress(Exception):
                    self.offset=parsedate_to_datetime(r.headers['date']).timestamp()-time.time()
            if r.status_code!=200:raise SourceError('proxy_ticket_http_'+str(r.status_code))
            ticket=r.json()['ticket']
            code,text=await self.fetch_text(self.base+'/stream/live',params={'t':ticket})
            if code==404:
                self.selected=None;self.cached_media=None;self.refresh_at=time.monotonic()+20
                return False
            if code!=200:raise SourceError('proxy_master_http_'+str(code))
            if not text.lstrip().startswith('#EXTM3U'):raise SourceError('invalid_proxy_playlist')
            lines=text.splitlines();variants=[]
            for i,line in enumerate(lines):
                if line.startswith('#EXT-X-STREAM-INF:'):
                    m=re.search(r'RESOLUTION=(\d+)x(\d+)',line)
                    uri=next((v.strip() for v in lines[i+1:] if v.strip() and not v.startswith('#')),None)
                    if uri and (not m or int(m[2])<=1080):
                        variants.append((int(m[2]) if m else 0,urljoin(self.base+'/',uri)))
            if variants:
                self.height,self.selected=max(variants,key=lambda v:v[0]);self.validate(self.selected)
                self.cached_media=None;self.refresh_at=time.monotonic()+35
            else:
                # A media playlist requires a fresh one-time ticket on its next reload.
                self.selected=self.base+'/stream/live';self.height=None
                self.cached_media=text;self.refresh_at=time.monotonic()+3
            return True
    async def media(self):
        if not await self.resolve():return None
        if self.cached_media is not None:return self.cached_media
        code,text=await self.fetch_text(self.selected)
        if code==403:
            self.refresh_at=0
            if not await self.resolve():return None
            code,text=await self.fetch_text(self.selected)
        if code==404:return None
        if code!=200:raise SourceError('proxy_media_http_'+str(code))
        if not text.lstrip().startswith('#EXTM3U'):raise SourceError('invalid_proxy_media')
        return text
    async def source(self):
        text=await self.media()
        if text is None:return None
        return self.local+'/live.m3u8',self.height,'#EXT-X-ENDLIST' in text
    async def moving(self):
        a=await self.media()
        if not a or '#EXT-X-ENDLIST' in a:return False
        seq=lambda t:re.search(r'#EXT-X-MEDIA-SEQUENCE:(\d+)',t)
        await asyncio.sleep(8);b=await self.media()
        if not b or '#EXT-X-ENDLIST' in b:return False
        sa,sb=seq(a),seq(b)
        return int(sb[1])>int(sa[1]) if sa and sb else a!=b
    def rewritten(self,text,base):
        now=time.monotonic()
        self.assets={k:v for k,v in self.assets.items() if v[1]>now}
        def asset(value):
            url=urljoin(base,value);self.validate(url)
            key=hashlib.sha256(url.encode()).hexdigest()
            self.assets[key]=(url,now+180)
            return self.local+'/a/'+key
        result=[]
        for line in text.splitlines():
            if line and not line.startswith('#'):line=asset(line.strip())
            else:line=re.sub(r'URI="([^"]+)"',lambda m:'URI="'+asset(m[1])+'"',line)
            result.append(line)
        return ('\n'.join(result)+'\n').encode()
    async def handle(self,reader,writer):
        sent=False
        async def response(code,body=b'',ctype='text/plain'):
            nonlocal sent
            writer.write(f'HTTP/1.1 {code} Response\r\nContent-Type: {ctype}\r\nContent-Length: {len(body)}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n'.encode()+body)
            sent=True;await writer.drain()
        try:
            raw=await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'),10)
            head=raw.decode('latin1').split('\r\n');parts=head[0].split()
            if len(parts)!=3 or parts[0]!='GET':await response(405);return
            path=parts[1]
            if path==f'/{self.cap}/live.m3u8':
                text=await self.media()
                if text is None:await response(404);return
                await response(200,self.rewritten(text,self.selected),'application/vnd.apple.mpegurl');return
            prefix=f'/{self.cap}/a/'
            if not path.startswith(prefix):await response(404);return
            item=self.assets.get(path[len(prefix):])
            if not item or item[1]<time.monotonic():await response(404);return
            url=item[0];self.validate(url);headers=dict(self.headers)
            for line in head[1:]:
                if line.lower().startswith('range:'):
                    value=line.split(':',1)[1].strip()
                    if re.fullmatch(r'bytes=\d*-\d*',value):headers['Range']=value
            async with self.c.stream('GET',url,headers=headers) as r:
                if r.status_code not in (200,206):await response(r.status_code);return
                if 'mpegurl' in r.headers.get('content-type','').lower():
                    chunks=[];size=0
                    async for b in r.aiter_bytes():
                        size+=len(b)
                        if size>1024*1024:raise SourceError('child_manifest_too_large')
                        chunks.append(b)
                    text=b''.join(chunks).decode('utf-8-sig')
                    await response(200,self.rewritten(text,url),'application/vnd.apple.mpegurl');return
                writer.write(f"HTTP/1.1 {r.status_code} Response\r\nContent-Type: {r.headers.get('content-type','application/octet-stream')}\r\nConnection: close\r\n".encode())
                for k in ('content-range','accept-ranges'):
                    if k in r.headers:writer.write((k+': '+r.headers[k]+'\r\n').encode())
                length=r.headers.get('content-length','')
                chunked=not length.isdigit()
                if chunked:writer.write(b'Transfer-Encoding: chunked\r\n')
                else:writer.write(('Content-Length: '+length+'\r\n').encode())
                writer.write(b'\r\n');sent=True
                # Match upstream entity bytes to Content-Length; otherwise emit
                # valid HTTP chunks so FFmpeg can distinguish EOF from failure.
                async for b in r.aiter_raw(chunk_size=65536):
                    if not b:continue
                    writer.write((('%x\r\n'%len(b)).encode()+b+b'\r\n') if chunked else b)
                    await writer.drain()
                if chunked:
                    writer.write(b'0\r\n\r\n');await writer.drain()
        except Exception:
            if not sent:
                with __import__('contextlib').suppress(Exception):await response(502)
        finally:
            writer.close()
            with __import__('contextlib').suppress(Exception):await writer.wait_closed()
    async def title(self):
        now=dt.datetime.fromtimestamp(time.time()+self.offset,dt.timezone.utc)
        try:
            if time.monotonic()>self.title_until:
                rows=[]
                for page in (1,2):
                    r=await self.c.get(os.environ['THEATER_API_URL'],
                        params={'page':page,'perpage':50,'type':'show'},
                        headers={'X-API-Key':os.environ['THEATER_API_KEY']})
                    if r.status_code!=200:raise SourceError('theater_api_unavailable')
                    data=r.json();rows.extend(data.get('theater',[]))
                    if len(rows)>=data.get('total_count',0):break
                self.title_rows=rows;self.title_until=time.monotonic()+300
            candidates=[]
            for row in self.title_rows:
                try:
                    start=dt.datetime.fromisoformat(row['start_date'].replace('Z','+00:00'))
                    end=dt.datetime.fromisoformat(row['end_date'].replace('Z','+00:00'))
                    if start-dt.timedelta(minutes=45)<=now<=end+dt.timedelta(hours=2):
                        candidates.append((abs((now-start).total_seconds()),row,start))
                except (ValueError,KeyError,TypeError):continue
            if candidates:
                _,row,start=min(candidates,key=lambda v:v[0]);local=start.astimezone(ZoneInfo('Asia/Jakarta'))
                return (f"{row['title']} — {local:%d/%m/%Y} • {local:%H.%M} WIB")[:100],row['id']
        except Exception:pass
        local=now.astimezone(ZoneInfo('Asia/Jakarta'))
        return f'JKT48 Theater LIVE — {local:%d/%m/%Y}',None

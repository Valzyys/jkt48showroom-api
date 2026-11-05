import os
os.environ.setdefault('SCRAPER_TOKEN', 'test-only-' + 'x' * 40)
import json
import time
import unittest
import httpx
from fastapi import HTTPException
from starlette.requests import Request
from audio_server import AudioRelay, audio_url


class AudioTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.relay = AudioRelay('test-token-' + 'x' * 40)

    async def asyncTearDown(self):
        await self.relay.close()

    async def test_signature_is_bound_to_track_and_format(self):
        expiry = int(time.time()) + 600
        signed = self.relay.ticket('abcdefghijk', 'm4a', expiry)
        self.relay.verify('abcdefghijk', 'm4a', signed)
        for video, ext in [('abcdefghijl', 'm4a'), ('abcdefghijk', 'webm')]:
            with self.assertRaises(HTTPException) as caught:
                self.relay.verify(video, ext, signed)
            self.assertEqual(caught.exception.status_code, 403)
        with self.assertRaises(HTTPException) as caught:
            self.relay.verify('abcdefghijk', 'm4a', self.relay.ticket('abcdefghijk', 'm4a', int(time.time()) - 1))
        self.assertEqual(caught.exception.status_code, 410)

    async def test_public_details_never_expose_google_url_or_headers(self):
        data = {'id':'abcdefghijk','title':'Track','artist':'Artist','album':None,'version_title':'Artist - Track','duration':200,'ext':'m4a','codec':'mp4a.40.2','bytes':12345,'source_url':'https://secret.googlevideo.com/videoplayback?private=value','headers':{'User-Agent':'private-agent'}}
        public = self.relay.present(data)
        self.assertFalse(public['audio']['has_video'])
        self.assertTrue(public['audio']['seekable'])
        self.assertNotIn('googlevideo', json.dumps(public))
        self.assertNotIn('private-agent', json.dumps(public))

    async def test_seek_proxies_single_range_and_releases_connection(self):
        await self.relay.http.aclose()
        def source(request):
            self.assertEqual(request.headers['range'], 'bytes=8-11')
            return httpx.Response(206, content=b'test', headers={'Content-Type':'audio/mp4','Content-Range':'bytes 8-11/100','Content-Length':'4'})
        self.relay.http = httpx.AsyncClient(transport=httpx.MockTransport(source))
        async def resolve(video):
            return {'ext':'m4a','source_url':'https://example.googlevideo.com/videoplayback','headers':{},'bytes':100}
        self.relay.resolve = resolve
        request = Request({'type':'http','method':'GET','path':'/','headers':[(b'range',b'bytes=8-11')]})
        ticket = self.relay.ticket('abcdefghijk','m4a',int(time.time())+600)
        response = await self.relay.stream(request,'abcdefghijk',ticket,'m4a')
        self.assertEqual(response.status_code,206)
        self.assertEqual(response.headers['Content-Range'],'bytes 8-11/100')
        self.assertEqual(b''.join([part async for part in response.body_iterator]),b'test')
        self.assertEqual(self.relay.streams,0)

    async def test_cannot_proxy_arbitrary_host(self):
        self.assertTrue(audio_url('https://r1.googlevideo.com/videoplayback?x=1'))
        for url in ['http://r1.googlevideo.com/videoplayback','https://googlevideo.com.evil.test/videoplayback','https://127.0.0.1/videoplayback','https://u:p@r1.googlevideo.com/videoplayback','https://r1.googlevideo.com:8443/videoplayback']:
            self.assertFalse(audio_url(url))

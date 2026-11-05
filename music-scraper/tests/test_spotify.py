import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace as NS
from spotify_lyrics import read_cookie, select_track, present
from app import PublicMusic

class ProviderTests(unittest.TestCase):
    def test_private_cookie_and_domain_filter(self):
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder)/'cookie'
            p.write_text('# Netscape HTTP Cookie File\n.evil.test\tTRUE\t/\tTRUE\t4102444800\tsp_dc\twrong\n.spotify.com\tTRUE\t/\tTRUE\t4102444800\tsp_dc\tfixture\n')
            p.chmod(0o600)
            self.assertEqual(read_cookie(p),'fixture')
            p.chmod(0o644)
            with self.assertRaises(ValueError): read_cookie(p)
    def test_song_matching_and_sync_validation(self):
        t=NS(id='fixture',name='Track',artists=[NS(name='Artist')],duration_ms=200000)
        self.assertIsNone(select_track([t],'Track','Other',200))
        self.assertIsNone(select_track([t],'Track','Artist',250))
        self.assertIs(select_track([t],'Track','Artist',200), t)
        l=NS(sync_type='UNSYNCED',lines=[NS(start_ms=1000,text='a'),NS(start_ms=2000,text='b')],provider='test',language='en')
        self.assertIsNone(present(t,l,200))
        l.sync_type='LINE_SYNCED'
        self.assertEqual(present(t,l,200)['lines'][0]['time'],1)

class FallbackTests(unittest.IsolatedAsyncioTestCase):
    async def test_fallback_retains_unsynced_on_failure_and_short_caches(self):
        class Provider:
            calls=0
            async def lookup(self,*args):
                self.calls+=1
                return None,'authentication_failed'
        p=Provider();m=PublicMusic(p)
        async def fixture(*args):
            return {'id':1,'trackName':'Track','artistName':'Artist','duration':200,'plainLyrics':'test'}
        m.lyrics_request=fixture
        r=await m.lyrics('abcdefghijk','Track','Artist')
        self.assertEqual(r['status'],'unsynced')
        self.assertEqual(r['plain_lyrics'],'test')
        await m.lyrics('abcdefghijk','Track','Artist')
        self.assertEqual(p.calls,1)
    async def test_synced_lrclib_does_not_call_spotify(self):
        class Provider:
            async def lookup(self,*args): raise AssertionError('unneeded request')
        m=PublicMusic(Provider())
        async def fixture(*args):
            return {'id':1,'trackName':'Track','artistName':'Artist','duration':200,'syncedLyrics':'[00:01]a\n[00:02]b'}
        m.lyrics_request=fixture
        self.assertEqual((await m.lyrics('abcdefghijk','Track','Artist'))['source'],'lrclib')

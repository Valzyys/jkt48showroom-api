import asyncio
import json
import unittest

from app import PublicMusic, guess_track, parse_lrc, youtube_results


class ParserTests(unittest.TestCase):
    def test_multiple_lrc_timestamps_and_fractional_seconds(self):
        # Synthetic text; no copyrighted lyrics are included in fixtures.
        self.assertEqual(parse_lrc('[ar:Example]\n[00:01.25][00:03.50]test\n[00:02.00]next'), [
            {'time': 1.25, 'text': 'test'}, {'time': 2.0, 'text': 'next'}, {'time': 3.5, 'text': 'test'},
        ])

    def test_youtube_search_excludes_live_and_invalid_identifiers(self):
        videos = [
            {'videoRenderer': {'videoId': 'abcdefghijk', 'title': {'runs': [{'text': 'Artist - Track'}]}, 'lengthText': {'simpleText': '4:42'}}},
            {'videoRenderer': {'videoId': 'onairabcdef', 'title': {'simpleText': 'Live'}}},
            {'videoRenderer': {'videoId': '../bad', 'lengthText': {'simpleText': '1:00'}}},
        ]
        rows = youtube_results('var ytInitialData = ' + json.dumps({'contents': videos}) + '; trailing();')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['duration'], 282)
        self.assertEqual(rows[0]['source'], 'youtube')

    def test_clean_metadata_for_lyrics_lookup(self):
        self.assertEqual(guess_track('JKT48 - RIVER (Official Music Video)', 'JKT48'), ('RIVER', 'JKT48'))
        self.assertEqual(guess_track('Artist - Track | Color Coded Lyrics (ENG)', 'Channel'), ('Track', 'Artist'))


class AsyncTests(unittest.IsolatedAsyncioTestCase):
    async def test_title_search_prefers_song_identity_over_incidental_lyric_match(self):
        music = PublicMusic()
        calls = []
        async def fixture(host, path, params):
            calls.append((host, path, params))
            if host == 'genius.com':
                return json.dumps({'response': {'sections': [
                    {'type':'lyric','hits':[{'type':'song','result':{'title':'Incidental match','primary_artist':{'name':'Other'}}}]},
                    {'type':'top_hit','hits':[
                        {'type':'album','result':{'name':'Album'}},
                        {'type':'song','result':{'title':'Track','primary_artist':{'name':'Artist'}}},
                    ]},
                ]}})
            return 'var ytInitialData = ' + json.dumps({'videoRenderer':{'videoId':'abcdefghijk','title':{'simpleText':'Artist - Track'},'lengthText':{'simpleText':'4:00'}}})
        music.fetch = fixture
        result = await music.search('Artist track long title')
        self.assertEqual(calls[0][1], '/api/search/multi')
        self.assertEqual(result['identified_song']['track'], 'Track')
        self.assertEqual(music.videos['abcdefghijk']['lyrics_hint']['artist'], 'Artist')

    async def test_duplicate_requests_share_upstream_call(self):
        music = PublicMusic()
        started = asyncio.Event()
        release = asyncio.Event()
        calls = 0
        async def loader():
            nonlocal calls
            calls += 1
            started.set()
            await release.wait()
            return {'ok': True}
        a = asyncio.create_task(music.cached('key', loader))
        await started.wait()
        b = asyncio.create_task(music.cached('key', loader))
        await asyncio.sleep(0)
        release.set()
        self.assertEqual(await a, await b)
        await music.cached('key', loader)
        self.assertEqual(calls, 1)

    async def test_failed_upstream_does_not_poison_future_requests(self):
        music = PublicMusic()
        async def fail():
            raise RuntimeError('offline')
        with self.assertRaises(RuntimeError):
            await music.cached('key', fail)
        self.assertFalse(music.inflight)
        async def success():
            return 'recovered'
        self.assertEqual(await music.cached('key', success), 'recovered')

    async def test_different_audio_version_requires_alignment_warning(self):
        music = PublicMusic()
        music.videos['abcdefghijk'] = {'title':'Artist - Track', 'channel':'Artist', 'duration':300}
        async def fixture(*args):
            return {'id':1, 'duration':280, 'trackName':'Track', 'artistName':'Artist', 'syncedLyrics':'[00:01]test\n[00:02]next'}
        music.lyrics_request = fixture
        result = await music.lyrics('abcdefghijk')
        self.assertEqual(result['status'], 'synced')
        self.assertEqual(result['alignment'], 'needs_check')
        self.assertEqual(result['duration_difference_seconds'], 20)


if __name__ == '__main__':
    unittest.main()

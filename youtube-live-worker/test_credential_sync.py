import json
import tempfile
import unittest
from pathlib import Path
import httpx
from credential_sync import load_credentials, sync_credentials

class CredentialSyncTest(unittest.IsolatedAsyncioTestCase):
    async def test_saves_private_credentials_and_acknowledges_once(self):
        with tempfile.TemporaryDirectory() as directory:
            calls = []
            def handle(request):
                self.assertEqual(request.headers['Authorization'], 'Bearer private-worker')
                calls.append(request.method)
                if request.method == 'POST':
                    self.assertEqual(json.loads(request.content), {'version': 'v1'})
                    return httpx.Response(200, json={'ok': True})
                if request.url.params.get('version') == 'v1':
                    return httpx.Response(200, json={'connected': True, 'unchanged': True, 'version': 'v1'})
                return httpx.Response(200, json={'connected': True, 'version': 'v1', 'credentials': {'client_id': 'client', 'client_secret': 'secret', 'refresh_token': 'refresh'}})
            async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
                self.assertEqual(await sync_credentials(client, directory, 'private-worker'), 'oauth_credentials_updated')
                self.assertIsNone(await sync_credentials(client, directory, 'private-worker'))
            self.assertEqual(load_credentials(directory)['version'], 'v1')
            self.assertEqual((Path(directory) / 'oauth-token.json').stat().st_mode & 0o777, 0o600)
            self.assertEqual(calls, ['GET', 'POST', 'GET'])

    async def test_failed_or_invalid_response_never_replaces_local_token(self):
        for response in [httpx.Response(401, json={}), httpx.Response(200, json={'connected': True, 'version': 'v1', 'credentials': {}})]:
            with tempfile.TemporaryDirectory() as directory:
                async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: response)) as client:
                    self.assertIsNotNone(await sync_credentials(client, directory, 'private-worker'))
                self.assertFalse((Path(directory) / 'oauth-token.json').exists())

    def test_rejects_readable_or_symlinked_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'oauth-token.json'
            path.write_text('{}')
            path.chmod(0o644)
            self.assertIsNone(load_credentials(directory))
            path.unlink()
            path.symlink_to('/etc/passwd')
            self.assertIsNone(load_credentials(directory))

if __name__ == '__main__':
    unittest.main()

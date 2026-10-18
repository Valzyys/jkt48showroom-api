import json
import unittest
from contextlib import asynccontextmanager

import httpx
from app import create_app
from curl_cffi.requests.exceptions import Timeout as CurlTimeout

TOKEN = "synthetic-test-token-" * 3


class FakeResponse:
    def __init__(self, status=200, body=None):
        self.status_code = status
        self.body = body if body is not None else json.dumps({"status": True, "data": [{"news_id": 1}]}).encode()
        self.closed = False

    async def aiter_content(self):
        yield self.body

    async def aclose(self):
        self.closed = True


class FakeSession:
    def __init__(self, response=None, error=None):
        self.response = response or FakeResponse()
        self.error = error
        self.calls = []
        self.closed = False

    async def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        if self.error:
            raise self.error
        return self.response

    async def close(self):
        self.closed = True


class ScraperTests(unittest.IsolatedAsyncioTestCase):
    @asynccontextmanager
    async def client(self, session, **options):
        app=create_app(token=TOKEN, session_factory=lambda: session, **options)
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='https://scraper.test') as client:
                yield client

    def headers(self):
        return {"Authorization": "Bearer " + TOKEN}

    async def test_image_scraping_requires_auth_and_accepts_only_raster_images(self):
        session = FakeSession(FakeResponse(body=b"\xff\xd8\xfftest-image"))
        async with self.client(session) as client:
            self.assertEqual((await client.get("/images/media/member.jpg")).status_code, 401)
            image = await client.get("/images/media/member.jpg", headers=self.headers())
            self.assertEqual(image.status_code, 200)
            self.assertEqual(image.headers["Content-Type"], "image/jpeg")
            self.assertEqual(session.calls[0][0], "https://jkt48.com/api/v1/storages/media/member.jpg")
            for path in ["/images/media/member.svg", "/images/media/member.jpg?url=https://evil.test"]:
                self.assertEqual((await client.get(path, headers=self.headers())).status_code, 400)
        self.assertTrue(session.response.closed)
        async with self.client(FakeSession(FakeResponse(body=b"<html>challenge</html>"))) as client:
            self.assertEqual((await client.get("/images/media/member.jpg", headers=self.headers())).status_code, 502)

    async def test_authentication_is_required_even_for_cached_responses(self):
        session = FakeSession()
        async with self.client(session) as client:
            self.assertEqual((await client.get("/health")).status_code, 200)
            self.assertEqual((await client.get("/api/v1/news")).status_code, 401)
            self.assertEqual((await client.get("/api/v1/news", headers=self.headers())).status_code, 200)
            self.assertEqual((await client.get("/api/v1/news")).status_code, 401)
            self.assertEqual(len(session.calls), 1)
        self.assertTrue(session.closed)

    async def test_public_query_and_json_contract_are_preserved(self):
        session = FakeSession()
        async with self.client(session) as client:
            response = (await client.get("/api/v1/news?lang=id&page=2", headers={**self.headers(), "Cookie": "private-client-cookie"}))
            self.assertEqual(response.json()["data"][0]["news_id"], 1)
            self.assertEqual(response.headers["Cache-Control"], "no-store")
            (await client.get("/api/v1/news?page=2&lang=id", headers=self.headers()))
        self.assertEqual(len(session.calls), 1)
        url, args = session.calls[0]
        self.assertEqual(url, "https://jkt48.com/api/v1/news")
        self.assertEqual(args["params"], {"lang": "id", "page": "2"})
        self.assertFalse(args["allow_redirects"])
        self.assertNotIn("headers", args)
        self.assertTrue(session.response.closed)

    async def test_arbitrary_targets_queries_and_drafts_are_rejected(self):
        session = FakeSession()
        async with self.client(session) as client:
            for path, status in [("https://evil.test", 404), ("news?url=https://evil.test", 400), ("news?page=1&page=2", 400), ("news?page=-1", 400), ("news/slug?preview=true", 400), ("schedules?month=13", 400)]:
                self.assertEqual((await client.get("/api/v1/" + path, headers=self.headers())).status_code, status)
        self.assertEqual(session.calls, [])

    async def test_all_worker_resource_types_are_supported(self):
        session = FakeSession()
        async with self.client(session, cache_seconds=0) as client:
            for path in ["members", "members/7", "news/a-slug?preview=false", "schedules?year=2026&month=10", "theater-shows/OSH1-7", "events/E7", "exclusives/EX7"]:
                self.assertEqual((await client.get("/api/v1/" + path, headers=self.headers())).status_code, 200)
        self.assertEqual(len(session.calls), 7)

    async def test_upstream_403_is_not_cached_or_disguised_as_success(self):
        session = FakeSession(FakeResponse(403, b"private upstream body"))
        async with self.client(session) as client:
            for _ in range(2):
                response = (await client.get("/api/v1/news", headers=self.headers()))
                self.assertEqual(response.status_code, 403)
                self.assertNotIn("private upstream body", response.text)
        self.assertEqual(len(session.calls), 4)

    async def test_rejected_connection_retries_once_with_a_new_session(self):
        stale = FakeSession(FakeResponse(403))
        fresh = FakeSession()
        sessions = iter([stale, fresh])
        app = create_app(token=TOKEN, session_factory=lambda: next(sessions))
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='https://scraper.test') as client:
                response = await client.get('/api/v1/news', headers=self.headers())
                self.assertEqual(response.status_code, 200)
        self.assertEqual(len(stale.calls), 1)
        self.assertEqual(len(fresh.calls), 1)
        self.assertTrue(fresh.closed)
        self.assertTrue(stale.response.closed)

    async def test_redirect_challenge_and_large_body_are_rejected(self):
        for fake in [FakeResponse(302), FakeResponse(body=b"<html>challenge</html>"), FakeResponse(body=b"x" * (2 * 1024 * 1024 + 1)), FakeResponse(body=b'{"status":false,"data":[]}')]:
            async with self.client(FakeSession(fake)) as client:
                self.assertEqual((await client.get("/api/v1/news", headers=self.headers())).status_code, 502)
            self.assertTrue(fake.closed)

    async def test_rate_limit_stops_additional_upstream_requests(self):
        session = FakeSession()
        async with self.client(session, cache_seconds=0, requests_per_minute=1) as client:
            self.assertEqual((await client.get("/api/v1/news", headers=self.headers())).status_code, 200)
            response = (await client.get("/api/v1/members", headers=self.headers()))
            self.assertEqual(response.status_code, 429)
            self.assertEqual(response.headers["Retry-After"], "60")
        self.assertEqual(len(session.calls), 1)

    async def test_connection_errors_do_not_leak_tokens_and_timeouts_return_504(self):
        for error, status in [(RuntimeError(TOKEN), 502), (TimeoutError(), 504), (CurlTimeout("native timeout"), 504)]:
            async with self.client(FakeSession(error=error)) as client:
                response = (await client.get("/api/v1/news", headers=self.headers()))
                self.assertEqual(response.status_code, status)
                self.assertNotIn(TOKEN, response.text)

    async def test_invalid_startup_tokens_are_rejected(self):
        for token in ["short", "x" * 257, " " * 64]:
            with self.assertRaises(RuntimeError):
                create_app(token=token)


if __name__ == "__main__":
    unittest.main()

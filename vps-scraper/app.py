import asyncio
from collections import OrderedDict, deque
from contextlib import asynccontextmanager
import json
import os
import re
import secrets
import time

from curl_cffi.requests import AsyncSession
from curl_cffi.requests.exceptions import Timeout as CurlTimeout
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

UPSTREAM = "https://jkt48.com/api/v1/"
MAX_BYTES = 2 * 1024 * 1024
DETAIL = re.compile(r"(news|members|theater-shows|events|exclusives)/[A-Za-z0-9_-]{1,200}\Z")


class ScrapeError(Exception):
    def __init__(self, status, message):
        self.status = status
        self.message = message


def validate_query(resource, params):
    group = resource.split("/")[0]
    allowed = {"lang"}
    if resource == "news":
        allowed.add("page")
    elif resource == "schedules":
        allowed.update(("month", "year"))
    elif group == "news":
        allowed.add("preview")
    result = {"lang": "id"}
    seen = set()
    for name, value in params:
        if name in seen or name not in allowed:
            raise ScrapeError(400, "Unsupported or duplicate query parameter")
        seen.add(name)
        if name == "lang" and value not in ("id", "jp", "en"):
            raise ScrapeError(400, "Invalid language")
        if name == "preview" and value != "false":
            raise ScrapeError(400, "Only published news is supported")
        if name in ("page", "month", "year"):
            maximum = {"page": 10000, "month": 12, "year": 2100}[name]
            minimum = 2011 if name == "year" else 1
            if not value.isascii() or not value.isdigit() or not minimum <= int(value) <= maximum:
                raise ScrapeError(400, "Invalid pagination or calendar parameter")
        result[name] = value
    return result


def create_app(token=None, session_factory=None, cache_seconds=60, requests_per_minute=120):
    token = token or os.environ.get("SCRAPER_TOKEN", "")
    if not 32 <= len(token) <= 256 or not token.isascii() or any(char.isspace() for char in token):
        raise RuntimeError("SCRAPER_TOKEN must contain 32-256 non-whitespace ASCII characters")
    session_factory = session_factory or (lambda: AsyncSession(
        impersonate="chrome", max_clients=4,
        verify=os.environ.get("SSL_CERT_FILE") or os.environ.get("REQUESTS_CA_BUNDLE") or True,
    ))

    @asynccontextmanager
    async def lifespan(app):
        app.state.session = session_factory()
        app.state.cache = OrderedDict()
        app.state.inflight = {}
        app.state.starts = deque()
        app.state.semaphore = asyncio.Semaphore(4)
        yield
        for task in app.state.inflight.values():
            task.cancel()
        await asyncio.gather(*app.state.inflight.values(), return_exceptions=True)
        await app.state.session.close()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def response_headers(request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.get("/health")
    async def health():
        return {"ok": True, "service": "jkt48-scraper"}

    @app.get("/images/{path:path}")
    async def image(path: str, request: Request):
        supplied = request.headers.get("Authorization", "").encode()
        if not secrets.compare_digest(supplied, ("Bearer " + token).encode()):
            return JSONResponse({"status": False, "message": "Unauthorized"}, status_code=401)
        if (request.query_params or not re.fullmatch(r"media/[A-Za-z0-9_./-]+\.(?:jpe?g|png|webp|gif|avif)", path, re.IGNORECASE)
                or any(part in ("", ".", "..") for part in path.split("/"))):
            return JSONResponse({"status": False, "message": "Invalid image path"}, status_code=400)
        now = time.monotonic()
        while app.state.starts and app.state.starts[0] <= now - 60:
            app.state.starts.popleft()
        if len(app.state.starts) >= requests_per_minute:
            return JSONResponse({"status": False, "message": "Scraper rate limit exceeded"}, status_code=429, headers={"Retry-After": "60"})
        app.state.starts.append(now)
        response = None
        async def receive():
            nonlocal response
            response = await app.state.session.get("https://jkt48.com/api/v1/storages/" + path,
                timeout=20, allow_redirects=False, stream=True)
            if response.status_code != 200:
                raise ScrapeError(response.status_code if 400 <= response.status_code <= 599 else 502, "Image source unavailable")
            body = bytearray()
            async for chunk in response.aiter_content():
                body.extend(chunk)
                if len(body) > 8 * 1024 * 1024:
                    raise ScrapeError(413, "Image exceeds 8 MB")
            data = bytes(body)
            if data.startswith(b"\xff\xd8\xff"): mime = "image/jpeg"
            elif data.startswith(b"\x89PNG\r\n\x1a\n"): mime = "image/png"
            elif data.startswith((b"GIF87a", b"GIF89a")): mime = "image/gif"
            elif data[:4] == b"RIFF" and data[8:12] == b"WEBP": mime = "image/webp"
            elif data[4:8] == b"ftyp" and (b"avif" in data[8:32] or b"avis" in data[8:32]): mime = "image/avif"
            else: raise ScrapeError(502, "Source did not return a supported image")
            return Response(data, media_type=mime)
        try:
            async with app.state.semaphore:
                return await asyncio.wait_for(receive(), timeout=25)
        except ScrapeError as error:
            return JSONResponse({"status": False, "message": error.message}, status_code=error.status)
        except (TimeoutError, asyncio.TimeoutError, CurlTimeout):
            return JSONResponse({"status": False, "message": "Image source timed out"}, status_code=504)
        except Exception:
            return JSONResponse({"status": False, "message": "Image source request failed"}, status_code=502)
        finally:
            if response is not None:
                await response.aclose()

    async def fetch_upstream(resource, params):
        async def receive():
            response = None
            try:
                response = await app.state.session.get(
                    UPSTREAM + resource, params=params, timeout=20,
                    allow_redirects=False, stream=True,
                )
                if response.status_code != 200:
                    status = response.status_code
                    if not 400 <= status <= 599:
                        status = 502
                    raise ScrapeError(status, "JKT48 upstream request was rejected or redirected")
                body = bytearray()
                async for chunk in response.aiter_content():
                    body.extend(chunk)
                    if len(body) > MAX_BYTES:
                        raise ScrapeError(502, "JKT48 response exceeds size limit")
                try:
                    payload = json.loads(body)
                except (ValueError, UnicodeDecodeError):
                    raise ScrapeError(502, "JKT48 upstream returned invalid JSON") from None
                if not isinstance(payload, dict) or payload.get("status") is not True or payload.get("data") is None:
                    raise ScrapeError(502, "JKT48 upstream returned an unsuccessful payload")
                return payload
            finally:
                if response is not None:
                    await response.aclose()

        async with app.state.semaphore:
            try:
                return await asyncio.wait_for(receive(), timeout=25)
            except ScrapeError:
                raise
            except (TimeoutError, asyncio.TimeoutError, CurlTimeout):
                raise ScrapeError(504, "JKT48 upstream timed out") from None
            except Exception:
                raise ScrapeError(502, "JKT48 upstream connection failed") from None

    @app.get("/api/v1/{resource:path}")
    async def scrape(resource: str, request: Request):
        supplied = request.headers.get("Authorization", "").encode()
        if not secrets.compare_digest(supplied, ("Bearer " + token).encode()):
            return JSONResponse({"status": False, "message": "Unauthorized"}, status_code=401)
        if resource not in ("news", "members", "schedules") and not DETAIL.fullmatch(resource):
            return JSONResponse({"status": False, "message": "Unsupported resource"}, status_code=404)
        try:
            params = validate_query(resource, request.query_params.multi_items())
            key = (resource, tuple(sorted(params.items())))
            now = time.monotonic()
            cached = app.state.cache.get(key)
            if cached and cached[0] > now:
                app.state.cache.move_to_end(key)
                return cached[1]
            task = app.state.inflight.get(key)
            if task is None:
                starts = app.state.starts
                while starts and starts[0] <= now - 60:
                    starts.popleft()
                if len(starts) >= requests_per_minute:
                    return JSONResponse({"status": False, "message": "Scraper rate limit exceeded"}, status_code=429, headers={"Retry-After": "60"})
                starts.append(now)
                task = asyncio.create_task(fetch_upstream(resource, params))
                app.state.inflight[key] = task
            try:
                payload = await asyncio.shield(task)
                app.state.cache[key] = (time.monotonic() + cache_seconds, payload)
                app.state.cache.move_to_end(key)
                while len(app.state.cache) > 32:
                    app.state.cache.popitem(last=False)
                return payload
            finally:
                if task.done():
                    app.state.inflight.pop(key, None)
        except ScrapeError as error:
            return JSONResponse({"status": False, "message": error.message}, status_code=error.status)

    return app

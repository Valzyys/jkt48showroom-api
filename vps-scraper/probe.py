import asyncio
from datetime import datetime
import os
from zoneinfo import ZoneInfo

from curl_cffi.requests import AsyncSession


async def main():
    today = datetime.now(ZoneInfo("Asia/Jakarta"))
    passed = True
    ca = os.environ.get("SSL_CERT_FILE") or os.environ.get("REQUESTS_CA_BUNDLE") or True
    async with AsyncSession(impersonate="chrome", verify=ca) as session:
        for resource, params in [("news", {"page": 1}), ("members", {}), ("schedules", {"year": today.year, "month": today.month})]:
            try:
                response = await session.get("https://jkt48.com/api/v1/" + resource, params={"lang": "id", **params}, allow_redirects=False, timeout=25)
                payload = response.json() if response.status_code == 200 else None
                valid = isinstance(payload, dict) and payload.get("status") is True and isinstance(payload.get("data"), list)
                print(f"{resource}: HTTP {response.status_code}, valid_json={valid}, records={len(payload['data']) if valid else 0}")
                passed = passed and valid
            except Exception as error:
                print(f"{resource}: request failed ({type(error).__name__})")
                passed = False
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

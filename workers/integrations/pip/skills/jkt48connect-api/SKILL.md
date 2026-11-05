---
name: jkt48connect-api
description: Integrate JKT48Connect public data endpoints or its Pip AI gateway, including live/recent images and Codex/Claude protocol setup. Use for JKT48Connect integration work, not unrelated coding.
---

Use `https://api.jkt48connect.app` as the current API origin. Read the relevant published guide or route catalogue before choosing a field or endpoint; formats have changed from older JKT48Connect deployments.

- Public data and Pip inference accept the same developer `jkc_…` key or server `API_KEY`. Public data uses `X-API-Key`; Pip accepts `Authorization: Bearer …` or `X-API-Key`. Developer requests share the monthly quota. Keep the key on the server or in the user's CLI environment, never public client bundles.
- Fetch `/docs/routes.json` for data route definitions and `/docs/guide.md` for detailed response semantics. Select the relevant portion; don't inject the whole catalogue into every prompt.
- For generated media, use the returned URL for the selected style and orientation and inspect its current status. Do not synthesize paths or regenerate the image in an integration bot. A pending URL does not prove its bytes are available. Retry with bounded backoff without duplicate notifications; respect upstream rate limits.
- Distinguish source event timestamps, API observation timestamps, image readiness, and notification send times. Measure their differences before attributing a delay to polling or rendering.
- Preserve source platform identifiers and date/time zones. Do not conflate IDN gold with Showroom points. Gift histories can be partial: never present an observed subtotal as the complete original transaction history.
- Pip `/v1/chat/completions` is Chat Completions format; Codex uses `/v1/responses`; Claude Code needs `/v1/messages`. All use the same Mistral backend, with profile aliases `pip`, `pip-code`, and `pip-docs`, not OpenAI/Anthropic model weights. Use full replayed history and tool outputs; `previous_response_id` is unavailable.
- Client tools execute on the client. The gateway doesn't receive VPS shell permissions. Verify a real tool-call/result roundtrip before declaring a coding client compatible. Unsupported vision/audio/files and provider-specific tools must fail clearly rather than silently dropping input.

Current gateway guide: https://api.jkt48connect.app/docs/guide/pip-ai-api

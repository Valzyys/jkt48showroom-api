# Pip AI gateway

Base URL OpenAI: `https://api.jkt48connect.app/v1`.
Base URL Claude Messages: `https://api.jkt48connect.app`.

Use the same developer `jkc_…` key as the data API, or the server `API_KEY`.
Developer calls share the data API monthly quota. Keep the key in a private environment file; no real credential is included in this package.

## Codex

Run the provided `pip-codex` launcher to apply the settings only to that invocation, preserving all other provider settings. It reads `API_KEY` or the private `~/.config/jkt48connect-ai/gateway.env` file and keeps normal permissions unchanged. Alternatively, export `API_KEY` in the shell that launches Codex. Merge `codex.config.toml` into the existing config, preserving other providers, projects and permissions. Restart the client after changing provider. The Pip profile disables Apps connectors to keep the tool catalogue below the upstream limit of 128; shell/file tools remain available. If you add MCP servers, keep their combined tool count within that limit. The launcher applies this only to that invocation. If merging the standalone example into a global config, remember that its `[features]` section applies globally. The configuration uses HTTP Responses with replayed conversation input, not previous_response_id or WebSockets.

## Claude Code

Export `API_KEY`, then source the provided `claude.env.example` in that shell. Start `claude --model pip-code`. This is a third-party Mistral adapter, not an Anthropic model or officially supported non-Claude setup. Keep normal client permission prompts enabled. `/v1/messages/count_tokens` returns 501 because the console upstream cannot provide exact token counting.

## Skills

Copy `skills/jkt48connect-api` into `~/.codex/skills/` for Codex, or `~/.claude/skills/` for Claude Code. Do not overwrite an existing customized skill without reviewing the changes. Restart the client to reload it.

## Profiles and limits

`pip`: general assistant; `pip-code`: coding agent instructions; `pip-docs`: public JKT48Connect documentation retrieval. These aliases currently share Mistral Medium, not separately trained models. System instructions, local skill files and grounded documentation are preparation/context, not fine-tuning weights. No automatic training on submitted code or conversations is performed by this gateway.

Text, function tools, streaming, non-streaming, and full replayed tool history are supported. Codex custom text tools are wrapped as native Mistral function arguments and translated back. Images/audio/files, server-managed response history, server tools/web-search, embeddings, model training endpoints and exact token counting are not implemented. Unsupported inputs return explicit errors. The gateway stores usage counters and masked request metadata for developer keys, not prompts or code. Requests still go to Mistral: upstream retention/account terms apply; don't send project secrets.

Default per-key inference budget: 20 inference requests/minute and 500/day (UTC). One agent turn may make multiple requests. Request body: 1 MiB; output: at most 16384 tokens; upstream deadline: 300 seconds. Expired console authentication must be refreshed by the owner. Client configuration does not increase the upstream model's reasoning or context capabilities.

Transient network/5xx errors are retried at most three total upstream attempts before any text or tool output. Long provider Retry-After values are preserved. Once output begins, a failure is surfaced without replaying tools. Claude should compact at 100k with a declared 120k context window; the gateway never silently truncates history.

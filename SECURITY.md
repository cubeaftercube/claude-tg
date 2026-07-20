# Security

## Network Connections

| Destination | What's sent | Source file |
|---|---|---|
| `api.telegram.org` | Messages, photos, documents via long polling + bot token in URL path | `worker.ts`, `manager.ts`, `cli.ts` |
| Anthropic API | Prompts + project files (via Claude Agent SDK) | `claude.ts` |
| `ngrok.com` | Local port tunnel (only when user runs `/preview`) | `tunnel.ts` |

No telemetry, no analytics, no tracking. All outbound URLs are hardcoded — no dynamic endpoint construction from user input.

## What Data Is Sent Where

- **Telegram**: Your messages, photos, documents. Bot token authenticates requests.
- **Anthropic**: Whatever Claude needs to answer your prompt (handled by the Claude Agent SDK, same as CLI `claude` usage).
- **ngrok**: Only the TCP tunnel to your local port. User-initiated only.

## Local File Storage

Everything lives in `~/.claude-tg/` (directory mode `0700`):

| File | Contents | Permissions |
|---|---|---|
| `config.json` | Bot token, owner ID, ngrok token, Anthropic API key | `0600` |
| `bots.json` | Worker bot configs (token, username, working dir) | `0600` |
| `daemon.pid` | Process ID of running daemon | default |
| `state-{botId}.json` | Chat session IDs, token counts, model selection | `0600` |
| `app.log` | Daemon logs (rotated at 5 MB, keeps 3 rotations) | default |

Temporary files (downloaded photos/documents) go to `os.tmpdir()/claude-tg-{botId}/` and are cleaned up after each query.

## How to Verify

- All source code is in `src/`. The `dist/` folder is unobfuscated compiled JS.
- Run `lsof -i -P | grep node` while the daemon runs to confirm network connections match the table above.
- `grep -r "fetch(" src/` to see every outbound HTTP call.
- `grep -r "process.env" src/` to see every environment variable read.

## Audit Findings

Overall: **no critical vulnerabilities found**.

- **No hardcoded secrets**
- **No command injection** — `spawn()` uses array args, no user input reaches shell
- **No path traversal** — session IDs validated as strict UUID regex, all paths use `path.join()`
- **Input validated** — bot tokens, UUIDs, ports, file sizes all checked before use
- **Authorization** — every bot command checks `TELEGRAM_OWNER_ID` before processing

Minor items (low risk):
- Temp files written without explicit `0600` mode (inherit from OS tmpdir)
- launchd plist is world-readable on macOS (but contains no secrets — only PATH and HOME)
- Error messages in logs could theoretically contain API response details (logs are in user's home dir only)

## Reporting Vulnerabilities

Report: GitHub Issues — please include steps to reproduce.

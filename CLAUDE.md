# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Claude-TG is a free, open-source Telegram bridge for Claude Code — run one lightweight daemon on your dev machine and use Claude Code from your phone via Telegram. A **manager bot** adds/removes project bots; each project gets its own **worker bot** that gives full Claude Code access on mobile. No license, no payments, no restrictions.

## Commands

```bash
npm install                # install dependencies
npm run build              # compile TypeScript to dist/
npm test                   # run all tests (Node.js built-in test runner)
npm start                  # run daemon directly via tsx (dev)
npm run dev                # watch mode with auto-restart
npx tsx src/cli.ts setup   # run CLI commands during development
npx tsx src/cli.ts start

# Tests (single file)
node --import tsx --test tests/formatter.test.ts
node --import tsx --test tests/store.test.ts
```

CI runs on Node 18, 20, 22 — type check (`tsc --noEmit`), tests, and build.

## Architecture

```
CLI (src/cli.ts)
  └─ spawns → Daemon (src/daemon.ts)
                 ├─ Manager Bot (src/manager.ts) — owner DMs this to add/remove workers
                 └─ Worker Bot(s) (src/worker.ts) — one per project directory
                       └─ ClaudeBridge (src/claude.ts) — wraps @anthropic-ai/claude-agent-sdk
```

**Key flow**: User sends a message to a worker bot on Telegram → `worker.ts` receives it via grammY long polling → calls `ClaudeBridge.sendMessage()` → which calls `query()` from `@anthropic-ai/claude-agent-sdk` → streams text chunks back to Telegram via `sendMessageDraft` (smooth streaming in DMs) or `editMessageText` (fallback for groups). Tool approvals, plan approvals, and AskUserQuestion prompts are relayed as Telegram inline keyboard buttons.

### Source files

| File | Role |
|---|---|
| `src/cli.ts` | CLI entry point (`claude-tg` command). Setup wizard, start/stop/status/logs, launchd/systemd service install |
| `src/daemon.ts` | Main process. Starts manager bot, restores saved workers from `bots.json`, periodic health checks (5min), scheduled task execution |
| `src/manager.ts` | Manager bot (single bot, owner-only). `/add` (interactive or inline token+path), `/remove`, `/bots`, `/feedback`, `/schedules` |
| `src/worker.ts` | Worker bot (one per project). Handles text messages, photos, documents, inline keyboard callbacks for tool/plan approvals, model selection, retry, session resume. Supports message queuing (max 20), group chat, YOLO mode |
| `src/claude.ts` | `ClaudeBridge` class wrapping the Claude Agent SDK. Manages per-chat sessions, model selection, tool approval flow (auto-approves Read/Glob/Grep/WebSearch/WebFetch/Task* tools), plan approval via ExitPlanMode interception, token counting, session history, CLI resume support. Strips `CLAUDECODE` env var from subprocess and respects `~/.claude/settings.json` env vars |
| `src/config.ts` | Loads config from env vars and `~/.claude-tg/config.json` |
| `src/store.ts` | CRUD for worker bot configs in `~/.claude-tg/bots.json` |
| `src/formatter.ts` | Converts Claude's markdown (bold, italic, code blocks, headings, blockquotes, links) to Telegram HTML. `splitMessage()` splits long messages at newline/word boundaries while tracking and re-opening HTML tags across splits. `formatToolCall()` renders tool approval cards |
| `src/tunnel.ts` | ngrok tunnel manager via `@ngrok/ngrok`. Auto-closes after 30min inactivity. `resetTimer()` called on any bot activity |
| `src/log.ts` | Colorized terminal logging with JSON fallback for non-TTY. Logs user messages, Claude responses, tool calls, approvals, errors |
| `src/scheduler.ts` | `ScheduleManager` using `node-cron`. Parses natural language like "daily 9am run tests" via Claude (Haiku, 1-turn) into cron expressions. Persists to `~/.claude-tg/schedules.json` |

## Key patterns

- **All files in `~/.claude-tg/`** use mode `0700` dirs / `0600` files
- **Node.js built-in test runner** (`node:test` + `node:assert/strict`) — no Jest/Mocha
- **TypeScript strict mode**, ESM (`"type": "module"`), `NodeNext` module resolution
- **CLI spawns daemon as detached child process**, communicates via PID file (`~/.claude-tg/daemon.pid`)
- **GrammY bot framework** for Telegram, long polling (not webhooks)
- **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) for the `query()` call — uses the same auth as the `claude` CLI
- **No ORM, no database** — everything is JSON files in `~/.claude-tg/`
- **409 Conflict retry** on Telegram polling start (3 attempts, 15s/30s/45s backoff) to handle previous instance's long-poll still being alive
- **`sendMessageDraft`** for smooth animated streaming in DMs; falls back to `editMessageText` for group chats
- Tests set `HOME` to a temp directory to isolate `~/.claude-tg/` state

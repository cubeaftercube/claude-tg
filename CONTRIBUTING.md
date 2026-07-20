# Contributing to Claude-TG

Thanks for your interest in contributing!

## Dev Setup

```bash
git clone https://github.com/CubeAfterCube/claude-tg.git
cd claude-tg
npm install
npm run build
npm test
```

## Running Locally

```bash
# Run daemon directly (no build step, uses tsx)
npm start

# Watch mode (auto-restart on file changes)
npm run dev

# Run CLI commands during development
npx tsx src/cli.ts setup
npx tsx src/cli.ts start
```

## Project Structure

| Path | Description |
|---|---|
| `src/daemon.ts` | Main process вЂ” starts manager bot, restores workers, health checks |
| `src/manager.ts` | Manager bot вЂ” `/add`, `/remove`, `/bots` commands |
| `src/worker.ts` | Worker bot вЂ” handles user messages, photos, documents, tool approvals |
| `src/claude.ts` | Claude bridge вЂ” wraps the Claude Agent SDK `query()` call |
| `src/config.ts` | Config loader вЂ” reads env vars and `~/.claude-tg/config.json` |
| `src/store.ts` | Bot persistence вЂ” saves/loads worker bot configs to `bots.json` |
| `src/formatter.ts` | Markdown-to-Telegram HTML converter and message splitter |
| `src/tunnel.ts` | ngrok tunnel manager for live preview |
| `src/log.ts` | Structured logging helpers |
| `tests/` | Test suite (Node.js built-in test runner) |

## Code Style

- TypeScript, strict mode
- No linter configured yet вЂ” match surrounding code style
- Prefer explicit types for function signatures, infer for locals
- Use `node:` prefix for built-in imports (`node:fs`, `node:path`, etc.)

## Making Changes

1. Create a branch from `main`
2. Make your changes
3. Run `npm run build` вЂ” must compile cleanly
4. Run `npm test` вЂ” all tests must pass
5. Open a PR using the pull request template

## Tests

```bash
npm test                    # run all tests
node --import tsx --test tests/formatter.test.ts  # run a single test file
```

Tests use Node.js built-in `node:test` runner with `node:assert`. No external test framework needed.

# Claude-TG

Use [Claude Code](https://github.com/anthropics/claude-code) from your phone via Telegram.

Run one lightweight process on your dev machine. It connects to Telegram via long polling вЂ” no server, no public URL, no ngrok. You get a **manager bot** to add/remove project bots, and a **worker bot** per project that gives you full Claude Code access on mobile.

## Install

```bash
npm install -g claude-tg
```

## Setup

**1. Create a manager bot** вЂ” go to [@BotFather](https://t.me/botfather) в†’ `/newbot` в†’ copy the token.

**2. Get your Telegram user ID** вЂ” message [@userinfobot](https://t.me/userinfobot) в†’ copy the number.

**3. Configure and start:**

```bash
claude-tg setup
claude-tg start
```

## Usage

DM your manager bot to manage project bots:

| Command | Description |
|---|---|
| `/add TOKEN /path/to/repo` | Attach a new worker bot to a project |
| `/bots` | List active bots |
| `/remove @botname` | Stop and remove a bot |
| `/feedback` | Send feedback or report an issue |
| `/cancel` | Cancel current operation |

Then DM each worker bot directly to use Claude Code:

| Command | Description |
|---|---|
| Send any message | Talk to Claude Code |
| Send a photo/document | Include as context |
| `/model` | Switch model (Opus / Sonnet / Haiku) |
| `/cost` | Show token usage for the session |
| `/session` | Get session ID to continue in CLI |
| `/resume` | Resume a CLI session in Telegram |
| `/preview` | Start dev server and open live preview |
| `/preview <port>` | Open tunnel to a running server |
| `/close` | Close active preview tunnel |
| `/new` | Start a fresh session |
| `/cancel` | Abort current operation |
| `/feedback` | Send feedback or report an issue |

### Live Preview

Preview your dev server on your phone with a public URL вЂ” powered by [ngrok](https://ngrok.com).

| Command | Description |
|---|---|
| `/preview` | Claude starts the dev server and opens an ngrok tunnel |
| `/preview <port>` | Open a tunnel to an already-running server |
| `/close` | Close an active preview tunnel |

When you run `/preview` without a port, Claude will automatically start the dev server, set up ngrok, and share the public URL. You can also pass a port directly (e.g. `/preview 3000`) to tunnel an existing server instantly.

You'll be prompted for a free ngrok auth token on first use, or you can set it up during `claude-tg setup`.

### Session Continuity

Switch seamlessly between CLI and Telegram:

```bash
# Start in CLI, continue on Telegram
claude                        # work on your laptop
# then in Telegram: /resume   # pick it up on your phone

# Start on Telegram, continue in CLI
# in Telegram: /session       # get the session ID
claude --resume <session-id>  # continue in your terminal
```

Conversation history is shown when resuming, so you can pick up where you left off.

## CLI

```bash
claude-tg setup              # configure token and user ID
claude-tg start              # start daemon in background
claude-tg stop               # stop daemon
claude-tg status             # check if running
claude-tg logs               # tail logs (Ctrl+C to exit)
claude-tg install-service    # install as macOS launchd service
claude-tg uninstall-service  # remove the launchd service
```

## Updating

```bash
npm install -g claude-tg@latest
claude-tg stop && claude-tg start
```

## Architecture

```
в”Њв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”ђ      в”Њв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”ђ      в”Њв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”ђ
в”‚  Telegram    в”‚в—„в”Ђв”Ђв”Ђв”Ђв–єв”‚  Manager Bot в”‚      в”‚  Anthropic API   в”‚
в”‚  (your phone)в”‚      в”‚  (add/remove)в”‚      в”‚  (Claude)        в”‚
в””в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”      в””в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”¬в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”      в””в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв–Ів”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”
                            в”‚                        в”‚
                     в”Њв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв–јв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”ђ        в”Њв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”ґв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”ђ
                     в”‚  Daemon      в”‚в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв–єв”‚  Claude Agent   в”‚
                     в”‚  (daemon.ts) в”‚        в”‚  SDK (query)    в”‚
                     в””в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”¬в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”        в””в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”
                            в”‚
                в”Њв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”јв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”ђ
                в–ј           в–ј           в–ј
         в”Њв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”ђв”Њв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”ђв”Њв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”ђ
         в”‚ Worker 1 в”‚в”‚ Worker 2 в”‚в”‚ Worker N в”‚
         в”‚ (repo A) в”‚в”‚ (repo B) в”‚в”‚ (repo N) в”‚
         в””в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”в””в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”в””в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”
```

- **Daemon** вЂ” single background process, manages bots
- **Manager bot** вЂ” Telegram bot to add/remove project workers
- **Worker bots** вЂ” one per project directory, full Claude Code access

## Data Flow

| Connection | Destination | What's sent |
|---|---|---|
| Telegram Bot API | `api.telegram.org` | Messages, photos, documents (long polling) |
| Anthropic API | Via Claude Agent SDK | Your prompts + project files (as needed by Claude) |
| ngrok (optional) | `ngrok.com` | Dev server tunnel (only when you use `/preview`) |

No telemetry, no analytics, no tracking. The daemon only contacts the services listed above.

## Security & Transparency

Claude-TG is open source. You can audit every line of code that runs on your machine.

- See [SECURITY.md](SECURITY.md) for full details on network connections, local storage, and how to verify
- All local files stored in `~/.claude-tg/` with `0600` permissions
- Verify network connections yourself: `lsof -i -P | grep node` while the daemon runs

## Requirements

- Node.js >= 18
- [Claude Code](https://github.com/anthropics/claude-code) installed and authenticated on the machine running the daemon

## Contributing

Contributions are welcome! Here's how to get started:

```bash
git clone https://github.com/CubeAfterCube/claude-tg.git
cd claude-tg
npm install
npm run build
npm test
```

To run locally during development:

```bash
npm run dev       # watch mode with auto-restart
```

Then open a PR against `main`. See [CONTRIBUTING.md](CONTRIBUTING.md) for code style, project structure, and full guidelines.

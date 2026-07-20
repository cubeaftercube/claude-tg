#!/bin/sh
set -e

# Claude-TG вЂ” installer
# Usage: curl -fsSL https://raw.githubusercontent.com/CubeAfterCube/claude-tg/main/install.sh | sh

REQUIRED_NODE_MAJOR=18

echo "Installing Claude-TG..."
echo "License: MIT | Source: https://github.com/CubeAfterCube/claude-tg"
echo ""

# Check Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is required (>= ${REQUIRED_NODE_MAJOR})."
  echo "Install it from https://nodejs.org or via your package manager."
  exit 1
fi

NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if [ "$NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]; then
  echo "Error: Node.js >= ${REQUIRED_NODE_MAJOR} required, found ${NODE_MAJOR}."
  echo "Upgrade at https://nodejs.org"
  exit 1
fi

# Check npm
if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is required but not found."
  exit 1
fi

# Install
npm install -g claude-tg

echo ""
echo "Installed! Get started:"
echo ""
echo "  1. claude-tg setup"
echo "     (you'll need a bot token from @BotFather and your Telegram user ID from @userinfobot)"
echo ""
echo "  2. claude-tg start"
echo ""
echo "  3. DM your manager bot on Telegram, then use /add to attach a bot to a project."
echo ""

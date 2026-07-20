/**
 * Claude-TG GUI вЂ” Electron main process.
 * Embeds the existing daemon (manager + workers) and serves a management dashboard.
 */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, Notification } from "electron";
import { config, DATA_DIR } from "../config.js";
import { ClaudeBridge } from "../claude.js";
import { loadBots, addBot, removeBot } from "../store.js";
import { providerRegistry } from "../providers/registry.js";
import { costTracker } from "../cost/tracker.js";
import { getShellManager } from "../shell.js";
import type { BotConfig } from "../store.js";
import { TunnelManager } from "../tunnel.js";
import { ScheduleManager, loadSchedules } from "../scheduler.js";
import { createManager } from "../manager.js";
import { createWorker } from "../worker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// в”Ђв”Ђ Daemon state (embedded, not spawned) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
const activeWorkers = new Map<
  number,
  { config: BotConfig; bot: ReturnType<typeof createWorker>; bridge: ClaudeBridge; tunnelManager: TunnelManager }
>();
let scheduleManager: ScheduleManager;
let managerBot: ReturnType<typeof createManager>;
let healthCheckTimer: ReturnType<typeof setInterval> | null = null;
const HEALTH_CHECK_MS = 5 * 60_000;
const lastWorkerError = new Map<number, number>();
const RESTART_COOLDOWN_MS = 120_000;

// в”Ђв”Ђ Electron state в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// в”Ђв”Ђ Log buffer for the renderer в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
const LOG_BUFFER_MAX = 2000;
const logBuffer: Array<{ ts: string; bot: string; level: string; message: string }> = [];

function pushLog(level: string, message: string, bot?: string): void {
  const entry = {
    ts: new Date().toISOString(),
    bot: bot || "daemon",
    level,
    message,
  };
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
  // Push to renderer
  mainWindow?.webContents.send("gui:log-line", entry);
}

// Config file helpers
const CONFIG_FILE_PATH = path.join(DATA_DIR, "config.json");

function loadConfigFile(): Record<string, string | number> {
  try {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, "utf-8"));
    }
  } catch {}
  return {};
}

function saveConfigFile(key: string, value: string): void {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const cfg = loadConfigFile();
  cfg[key] = value;
  fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

// Hook console to capture logs
const origLog = console.log;
const origError = console.error;
console.log = (...args: unknown[]) => {
  origLog(...args);
  pushLog("info", args.map(String).join(" "));
};
console.error = (...args: unknown[]) => {
  origError(...args);
  pushLog("error", args.map(String).join(" "));
};

// в”Ђв”Ђ Daemon lifecycle в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

async function startWorker(botConfig: BotConfig): Promise<void> {
  const bridge = new ClaudeBridge(botConfig.id, botConfig.workingDir, botConfig.username);
  const tunnelManager = new TunnelManager(config.NGROK_AUTH_TOKEN);
  const bot = createWorker(botConfig, bridge, tunnelManager, scheduleManager);

  await bot.init();
  await bot.api.setMyCommands(getWorkerCommands());

  addBot(botConfig);
  activeWorkers.set(botConfig.id, { config: botConfig, bot, bridge, tunnelManager });

  const startPolling = async () => {
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 15_000;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await bot.start({ drop_pending_updates: true });
        return;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("409") && attempt < MAX_RETRIES) {
          const wait = RETRY_DELAY_MS * attempt;
          pushLog("warn", `409 Conflict (attempt ${attempt}/${MAX_RETRIES}), retrying in ${wait / 1000}s...`, botConfig.username);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        throw err;
      }
    }
  };

  pushLog("info", `Worker started: @${botConfig.username} в†’ ${botConfig.workingDir}`);
  mainWindow?.webContents.send("gui:bot-status-change", { botId: botConfig.id, status: "online" });

  startPolling().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    pushLog("error", `Polling error: ${msg}`, botConfig.username);
    mainWindow?.webContents.send("gui:bot-status-change", { botId: botConfig.id, status: "error" });
    bridge.abortAll();
    try { bot.stop(); } catch {}
    activeWorkers.delete(botConfig.id);
    lastWorkerError.set(botConfig.id, Date.now());
  });
}

async function stopWorker(botId: number): Promise<void> {
  const worker = activeWorkers.get(botId);
  if (!worker) return;

  worker.bridge.abortAll();
  scheduleManager.removeAllForBot(botId);
  await worker.tunnelManager.closeAll();
  await worker.bot.stop();
  activeWorkers.delete(botId);
  removeBot(botId);

  pushLog("info", `Worker stopped: @${worker.config.username}`);
  mainWindow?.webContents.send("gui:bot-status-change", { botId, status: "offline" });
}

async function initDaemon(): Promise<void> {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

  scheduleManager = new ScheduleManager(async (botId, chatId, promptMsg, scheduleId) => {
    const worker = activeWorkers.get(botId);
    if (!worker) {
      pushLog("error", `Worker ${botId} not found for schedule ${scheduleId}`);
      return;
    }
    worker.bridge.clearSession(chatId);
    await worker.bridge.sendMessage(chatId, promptMsg, {
      onResult: async (result) => {
        await worker.bot.api.sendMessage(chatId, `<b>Scheduled task done</b>\n\n${result.text}`.slice(0, 4000), { parse_mode: "HTML" }).catch(() => {});
      },
      onError: async (err) => {
        await worker.bot.api.sendMessage(chatId, `Scheduled task failed: ${err.message}`).catch(() => {});
      },
      onStreamChunk: () => {},
      onStatusUpdate: () => {},
      onToolApproval: async () => "allow",
      onAskUser: async () => ({}),
      onPlanApproval: async () => true,
      onSessionReset: () => {},
    }, "bypassPermissions", 25);
  });

  managerBot = createManager({ startWorker, stopWorker, getActiveWorkers });

  managerBot.catch((err) => {
    pushLog("error", `Manager error: ${err.message}`);
  });

  await managerBot.api.setMyCommands(getManagerCommands());

  // Restore saved workers вЂ” fire-and-forget (API calls inside startWorker could hang)
  const savedBots = loadBots();
  for (const botConfig of savedBots) {
    startWorker(botConfig).then(() => {
      pushLog("info", `Worker restored: @${botConfig.username}`);
    }).catch((err) => {
      pushLog("error", `Failed to restore worker @${botConfig.username}: ${err}`);
    });
  }
  if (savedBots.length > 0) {
    pushLog("info", `Restoring ${savedBots.length} worker(s)...`);
  }

  // Restore schedules
  scheduleManager.start(loadSchedules());

  // Health check
  healthCheckTimer = setInterval(async () => {
    for (const [id, worker] of activeWorkers) {
      try {
        await worker.bot.api.getMe();
      } catch (err) {
        pushLog("error", `Health check failed for @${worker.config.username}: ${(err as Error).message}`);
        worker.bridge.abortAll();
        worker.bridge.flushState();
        try { await worker.tunnelManager.closeAll(); } catch {}
        try { await worker.bot.stop(); } catch {}
        activeWorkers.delete(id);
        try { await startWorker(worker.config); } catch {}
      }
    }

    // Recover saved bots not running
    const saved = loadBots();
    for (const bc of saved) {
      if (!activeWorkers.has(bc.id)) {
        const lastErr = lastWorkerError.get(bc.id);
        if (lastErr && Date.now() - lastErr < RESTART_COOLDOWN_MS) continue;
        try {
          await startWorker(bc);
          lastWorkerError.delete(bc.id);
        } catch (err) {
          pushLog("error", `Recovery failed for @${bc.username}: ${(err as Error).message}`);
          lastWorkerError.set(bc.id, Date.now());
        }
      }
    }
  }, HEALTH_CHECK_MS);

  // Start manager polling вЂ” fire-and-forget (long polling blocks forever)
  const startManager = async () => {
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 15_000;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await managerBot.start({
          drop_pending_updates: true,
          onStart: (info) => {
            pushLog("info", `Manager bot: @${info.username}`);
            pushLog("info", `Active workers: ${activeWorkers.size}`);
            mainWindow?.webContents.send("gui:bot-status-change", { botId: 0, status: "manager-ready" });
          },
        });
        return;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("409") && attempt < MAX_RETRIES) {
          pushLog("warn", `Manager 409 Conflict (attempt ${attempt}/${MAX_RETRIES}), retrying...`);
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
          continue;
        }
        pushLog("error", `Manager polling error: ${msg}`);
        throw err;
      }
    }
  };
  startManager().catch((err) => {
    pushLog("error", `Manager bot failed: ${(err as Error).message}`);
  });
}

function getActiveWorkers(): Map<number, { config: BotConfig }> {
  const result = new Map<number, { config: BotConfig }>();
  for (const [id, w] of activeWorkers) {
    result.set(id, { config: w.config });
  }
  return result;
}

function getWorkerCommands() {
  return [
    { command: "new", description: "Start a fresh session" },
    { command: "model", description: "Switch Claude model" },
    { command: "cost", description: "Show token usage" },
    { command: "session", description: "Get session ID to resume in CLI" },
    { command: "resume", description: "Resume a CLI session in Telegram" },
    { command: "cancel", description: "Abort the current operation" },
    { command: "feedback", description: "Send feedback or report an issue" },
    { command: "help", description: "Show help" },
    { command: "preview", description: "Open live preview tunnel" },
    { command: "close", description: "Close active preview tunnel" },
    { command: "schedule", description: "Add a scheduled task" },
    { command: "schedules", description: "List scheduled tasks" },
    { command: "unschedule", description: "Remove a scheduled task" },
    { command: "effort", description: "Set reasoning effort level" },
    { command: "mode", description: "Set permission mode" },
  ];
}

function getManagerCommands() {
  return [
    { command: "bots", description: "List active worker bots" },
    { command: "add", description: "Add a new worker bot" },
    { command: "remove", description: "Remove a worker bot (or 'all')" },
    { command: "schedules", description: "View all scheduled tasks" },
    { command: "feedback", description: "Send feedback" },
    { command: "cancel", description: "Cancel current operation" },
    { command: "help", description: "Show help" },
  ];
}

async function shutdownDaemon(): Promise<void> {
  if (healthCheckTimer) clearInterval(healthCheckTimer);
  scheduleManager?.stop();
  // Save all bridge state before stopping
  for (const [, worker] of activeWorkers) {
    worker.bridge.abortAll();
    // Persist all bridge state before stopping
    worker.bridge.flushState();
    try { await worker.tunnelManager.closeAll(); } catch {}
    try { await worker.bot.stop(); } catch {}
  }
  // Don't clear bots.json вЂ” keep them for next launch
  activeWorkers.clear();
  pushLog("info", "Daemon shut down");
}

// в”Ђв”Ђ Electron IPC handlers в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

function setupIPC(): void {
  // Bots
  ipcMain.handle("gui:get-bots", () => {
    const bots: Array<BotConfig & { status: string; model: string }> = [];
    for (const [, w] of activeWorkers) {
      bots.push({
        ...w.config,
        status: "online",
        model: w.bridge.getModel(0), // chatId 0 = default
      });
    }
    // Include saved bots not currently active
    for (const bc of loadBots()) {
      if (!activeWorkers.has(bc.id)) {
        bots.push({ ...bc, status: "offline", model: "offline" });
      }
    }
    return bots;
  });

  ipcMain.handle("gui:add-bot", async (_event, { token, workingDir }: { token: string; workingDir: string }) => {
    if (!fs.existsSync(workingDir)) throw new Error(`Path does not exist: ${workingDir}`);
    if (!fs.statSync(workingDir).isDirectory()) throw new Error(`Not a directory: ${workingDir}`);

    const { Bot } = await import("grammy");
    const tempBot = new Bot(token);
    const me = await tempBot.api.getMe();
    const username = me.username || `bot_${me.id}`;

    if (activeWorkers.has(me.id)) throw new Error(`Bot @${username} is already active`);

    const botConfig: BotConfig = {
      id: me.id,
      token,
      username,
      workingDir,
    };

    await startWorker(botConfig);
    return botConfig;
  });

  ipcMain.handle("gui:remove-bot", async (_event, { botId }: { botId: number }) => {
    await stopWorker(botId);
  });

  // Logs
  ipcMain.handle("gui:get-logs", (_event, { lines = 100 }: { lines?: number }) => {
    return logBuffer.slice(-lines);
  });

  // Chat вЂ” relay to worker bridge
  ipcMain.handle("gui:send-message", async (event, { botId, chatId, prompt }: { botId: number; chatId: number; prompt: string }) => {
    const worker = activeWorkers.get(botId);
    if (!worker) throw new Error(`Bot ${botId} not active`);

    const sender = event.sender;

    await worker.bridge.sendMessage(chatId, prompt, {
      onStreamChunk: (text) => {
        sender.send("gui:stream-chunk", { chatId, text });
      },
      onStatusUpdate: (status) => {
        sender.send("gui:stream-status", { chatId, status });
      },
      onToolApproval: async (toolName, input) => {
        // Send approval request to renderer and wait
        const requestId = `${chatId}-${Date.now()}`;
        sender.send("gui:tool-approval", { chatId, requestId, toolName, input });
        // For now, auto-approve in GUI (user can change via mode)
        return "allow";
      },
      onAskUser: async (questions) => {
        const answers: Record<string, string> = {};
        for (const q of questions) {
          answers[q.question] = q.options[0]?.label || "";
        }
        return answers;
      },
      onPlanApproval: async () => {
        sender.send("gui:plan-approval", { chatId });
        return true; // Auto-approve in GUI for now
      },
      onResult: (result) => {
        sender.send("gui:stream-done", { chatId, result });
        sender.send("gui:token-update", {
          botId,
          usage: {
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            totalTokens: result.usage.inputTokens + result.usage.outputTokens,
          },
        });
      },
      onError: (error) => {
        sender.send("gui:stream-error", { chatId, error: error.message });
      },
      onSessionReset: () => {
        sender.send("gui:session-reset", { chatId });
      },
    });

    return { ok: true };
  });

  ipcMain.handle("gui:cancel", (_event, { botId, chatId }: { botId: number; chatId: number }) => {
    const worker = activeWorkers.get(botId);
    if (worker) {
      return worker.bridge.cancelQuery(chatId);
    }
    return false;
  });

  // Usage
  ipcMain.handle("gui:get-usage", (_event, { botId }: { botId: number }) => {
    const worker = activeWorkers.get(botId);
    if (!worker) return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const t = worker.bridge.getSessionTokens(0);
    return {
      inputTokens: t.inputTokens,
      outputTokens: t.outputTokens,
      cacheCreationTokens: t.cacheCreationTokens,
      cacheReadTokens: t.cacheReadTokens,
      totalTokens: t.inputTokens + t.outputTokens,
    };
  });

  // Schedules
  ipcMain.handle("gui:get-schedules", () => {
    return scheduleManager?.getAll() || [];
  });

  // Effort
  ipcMain.handle("gui:set-effort", (_event, { botId, chatId, effort }: { botId: number; chatId: number; effort: string }) => {
    const worker = activeWorkers.get(botId);
    if (worker) {
      worker.bridge.setEffort(chatId, effort);
      return { ok: true };
    }
    return { ok: false, error: "Bot not active" };
  });

  ipcMain.handle("gui:get-effort", (_event, { botId, chatId }: { botId: number; chatId: number }) => {
    const worker = activeWorkers.get(botId);
    if (worker) {
      return worker.bridge.getEffort(chatId);
    }
    return "medium";
  });

  // Permission mode
  ipcMain.handle("gui:set-mode", (_event, { botId, chatId, mode }: { botId: number; chatId: number; mode: string }) => {
    const worker = activeWorkers.get(botId);
    if (worker) {
      worker.bridge.setPermissionMode(chatId, mode);
      return { ok: true };
    }
    return { ok: false, error: "Bot not active" };
  });

  ipcMain.handle("gui:get-mode", (_event, { botId, chatId }: { botId: number; chatId: number }) => {
    const worker = activeWorkers.get(botId);
    if (worker) {
      return worker.bridge.getPermissionMode(chatId);
    }
    return "auto";
  });

  // Config — read/write ~/.claude-tg/config.json
  ipcMain.handle("gui:get-config", () => {
    const cfg = loadConfigFile();
    return { botToken: cfg.TELEGRAM_BOT_TOKEN || "", ownerId: cfg.TELEGRAM_OWNER_ID || "", ngrokToken: cfg.NGROK_AUTH_TOKEN || "" };
  });

  ipcMain.handle("gui:save-config", (_event, { key, value }: { key: string; value: string }) => {
    saveConfigFile(key, value);
    // Update in-memory config so daemon picks it up immediately
    if (key === "TELEGRAM_BOT_TOKEN") process.env.TELEGRAM_BOT_TOKEN = value;
    if (key === "TELEGRAM_OWNER_ID") process.env.TELEGRAM_OWNER_ID = value;
    if (key === "NGROK_AUTH_TOKEN") process.env.NGROK_AUTH_TOKEN = value;
    return { ok: true };
  });

  // Model
  ipcMain.handle("gui:set-model", (_event, { botId, chatId, model }: { botId: number; chatId: number; model: string }) => {
    const worker = activeWorkers.get(botId);
    if (worker) {
      worker.bridge.setModel(chatId, model);
      return { ok: true };
    }
    return { ok: false, error: "Bot not active" };
  });

  // в”Ђв”Ђ Provider в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

  ipcMain.handle("gui:get-providers", () => {
    return providerRegistry.getAll().map((p) => ({
      id: p.id,
      label: p.label,
      models: p.models,
    }));
  });

  ipcMain.handle("gui:set-provider", (_event, { botId, chatId, providerId }: { botId: number; chatId: number; providerId: string }) => {
    const worker = activeWorkers.get(botId);
    if (worker) {
      worker.bridge.setProvider(chatId, providerId);
      return { ok: true };
    }
    return { ok: false, error: "Bot not active" };
  });

  ipcMain.handle("gui:get-provider", (_event, { botId, chatId }: { botId: number; chatId: number }) => {
    const worker = activeWorkers.get(botId);
    if (worker) return worker.bridge.getProvider(chatId);
    return "claude";
  });

  ipcMain.handle("gui:set-deepseek-key", async (_event, { key }: { key: string }) => {
    if (key) {
      providerRegistry.enableDeepseek(key);
    } else {
      providerRegistry.disableDeepseek();
    }
    return { ok: true };
  });

  // в”Ђв”Ђ Cost / Currency в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

  ipcMain.handle("gui:get-session-cost", (_event, { botId, chatId }: { botId: number; chatId: number }) => {
    const worker = activeWorkers.get(botId);
    if (!worker) return { totalCostUsd: 0, currency: "USD", totalCostFormatted: "$0.00 USD" };
    const cost = costTracker.getSessionCost(chatId);
    return {
      totalCostUsd: cost.totalCostUsd,
      currency: cost.currency,
      totalCostFormatted: cost.totalCostFormatted,
    };
  });

  ipcMain.handle("gui:get-currency", () => {
    return costTracker.getCurrency();
  });

  ipcMain.handle("gui:set-currency", (_event, { code }: { code: string }) => {
    costTracker.setCurrency(code);
    return { ok: true };
  });

  ipcMain.handle("gui:get-available-currencies", async () => {
    const { getAvailableCurrencies, ensureRates } = await import("../cost/currency.js");
    await ensureRates();
    return getAvailableCurrencies();
  });

  ipcMain.handle("gui:set-custom-pricing", (_event, data: Record<string, Record<string, number>>) => {
    import("../cost/pricing.js").then(({ saveCustomPricing }) => saveCustomPricing(data));
    return { ok: true };
  });

  ipcMain.handle("gui:set-custom-rates", (_event, rates: Record<string, number>) => {
    import("../cost/currency.js").then(({ saveCustomRates }) => saveCustomRates(rates));
    return { ok: true };
  });

  // в”Ђв”Ђ Shell в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

  ipcMain.handle("gui:run-shell", (_event, { botId, command, cwd }: { botId: number; command: string; cwd: string }) => {
    const shell = getShellManager(botId);
    const result = shell.run(command, cwd);
    return {
      output: result.output,
      elapsedMs: result.elapsedMs,
      error: result.error,
    };
  });

  ipcMain.handle("gui:shell-history", (_event, { botId }: { botId: number }) => {
    const shell = getShellManager(botId);
    return shell.getHistory(20);
  });
}

// в”Ђв”Ђ Window + Tray в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

function getIconPath(): string {
  // Use the user's custom icon.ico, fall back to the assets directory
  const paths = [
    path.join(__dirname, "..", "..", "assets", "icon.ico"),       // dist в†’ assets
    path.join(__dirname, "..", "..", "..", "assets", "icon.ico"), // dist/gui в†’ assets
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return "";
}

function createDefaultIcon(): Electron.NativeImage {
  const size = 64;
  const canvas = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const off = (y * size + x) * 4;
      const cx = size / 2, cy = size / 2, r = size / 2 - 2;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (dist < r) {
        canvas[off] = 0x1e; canvas[off + 1] = 0x6f; canvas[off + 2] = 0xd0; canvas[off + 3] = 0xff;
      }
    }
  }
  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

function createWindow(): void {
  const iconPath = getIconPath();

  mainWindow = new BrowserWindow({
    ...(iconPath ? { icon: nativeImage.createFromPath(iconPath) } : { icon: createDefaultIcon() }),
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 500,
    title: "Claude-TG",
    show: false,
    frame: true,
    backgroundColor: "#0d1117",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
      if (Notification.isSupported()) {
        new Notification({ title: "Claude-TG", body: "Claude-TG is still running in the system tray." }).show();
      }
    }
  });
}

function createTray(): void {
  const iconPath = getIconPath();
  const trayIcon = iconPath
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : createDefaultIcon().resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);
  tray.setToolTip("Claude-TG");

  const contextMenu = Menu.buildFromTemplate([
    { label: "Show Dashboard", click: () => mainWindow?.show() },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on("click", () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
    }
  });
}

// в”Ђв”Ђ App lifecycle в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

app.whenReady().then(async () => {
  // Windows: set AppUserModelId for proper taskbar icon grouping
  if (process.platform === "win32") {
    app.setAppUserModelId("com.claude-tg.app");
  }

  // Init cost tracker (fetches currency rates)
  costTracker.init().catch(() => {});

  setupIPC();
  createWindow();
  createTray();

  // Update status immediately вЂ” daemon starts in background
  pushLog("info", "Starting daemon...");
  mainWindow?.webContents.send("gui:bot-status-change", { botId: 0, status: "starting" });

  try {
    // initDaemon returns quickly вЂ” workers and manager start fire-and-forget
    await initDaemon();
    pushLog("info", "Daemon initializing. Workers starting in background...");
  } catch (err) {
    pushLog("error", `Failed to start daemon: ${(err as Error).message}`);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });
});

app.on("window-all-closed", () => {
  // Don't quit вЂ” keep running in tray
});

app.on("before-quit", async () => {
  isQuitting = true;
  await shutdownDaemon();
});

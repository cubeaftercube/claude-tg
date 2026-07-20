/**
 * Claude-TG GUI вЂ” Renderer entry point.
 * Tab navigation, IPC listeners, bot management, logs, chat, usage, settings.
 */

// в”Ђв”Ђ Type declarations for preload API в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
interface BotInfo {
  id: number; token: string; username: string; workingDir: string;
  status: string; model: string;
}
interface LogEntry { ts: string; bot: string; level: string; message: string; }
interface TokenUsage { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; totalTokens: number; }

declare global {
  interface Window {
    claudeTGAPI: {
      getBots: () => Promise<BotInfo[]>;
      addBot: (token: string, workingDir: string) => Promise<BotInfo>;
      removeBot: (botId: number) => Promise<void>;
      getLogs: (lines?: number) => Promise<LogEntry[]>;
      onLogLine: (cb: (entry: LogEntry) => void) => () => void;
      sendMessage: (botId: number, chatId: number, prompt: string) => Promise<{ ok: boolean }>;
      cancelQuery: (botId: number, chatId: number) => Promise<boolean>;
      onStreamChunk: (cb: (data: { chatId: number; text: string }) => void) => () => void;
      onStreamStatus: (cb: (data: { chatId: number; status: string }) => void) => () => void;
      onStreamDone: (cb: (data: { chatId: number; result: unknown }) => void) => () => void;
      onStreamError: (cb: (data: { chatId: number; error: string }) => void) => () => void;
      onToolApproval: (cb: (data: unknown) => void) => () => void;
      onBotStatusChange: (cb: (data: { botId: number; status: string }) => void) => () => void;
      onTokenUpdate: (cb: (data: { botId: number; usage: TokenUsage }) => void) => () => void;
      setEffort: (botId: number, chatId: number, effort: string) => Promise<{ ok: boolean; error?: string }>;
      getEffort: (botId: number, chatId: number) => Promise<string>;
      setMode: (botId: number, chatId: number, mode: string) => Promise<{ ok: boolean; error?: string }>;
      getMode: (botId: number, chatId: number) => Promise<string>;
      setModel: (botId: number, chatId: number, model: string) => Promise<{ ok: boolean; error?: string }>;
      getUsage: (botId: number) => Promise<TokenUsage>;
      getSchedules: () => Promise<unknown[]>;
      getProviders: () => Promise<Array<{ id: string; label: string; models: Array<{ id: string; label: string }> }>>;
      setProvider: (botId: number, chatId: number, providerId: string) => Promise<{ ok: boolean; error?: string }>;
      getProvider: (botId: number, chatId: number) => Promise<string>;
      setDeepseekKey: (key: string) => Promise<{ ok: boolean }>;
      getConfig: () => Promise<{ botToken: string; ownerId: string; ngrokToken: string }>;
      saveConfig: (key: string, value: string) => Promise<{ ok: boolean }>;
      runShell: (botId: number, command: string, cwd: string) => Promise<{ output: string; elapsedMs: number; error: string | null }>;
      shellHistory: (botId: number) => Promise<Array<{ command: string; cwd: string; ts: string; elapsedMs: number }>>;
    };
  }
}

const api = window.claudeTGAPI;

// Diagnostic: show visible error if preload failed
if (!api) {
  document.body.innerHTML = '<div style="padding:40px;color:#f85149;font-family:sans-serif">' +
    '<h2>Preload failed</h2>' +
    '<p><code>window.claudeTGAPI</code> is undefined. The preload script did not run.</p>' +
    '<p>Check DevTools (Ctrl+Shift+I) for errors.</p>' +
    '</div>';
  throw new Error("claudeTGAPI not available вЂ” preload script failed");
}

// в”Ђв”Ђ Tab Navigation в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

let activeTab = "bots";

document.querySelectorAll(".nav-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const tabName = (tab as HTMLElement).dataset.tab!;
    switchTab(tabName);
  });
});

function switchTab(name: string): void {
  activeTab = name;
  document.querySelectorAll(".nav-tab").forEach((t) => t.classList.remove("active"));
  document.querySelector(`.nav-tab[data-tab="${name}"]`)?.classList.add("active");
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
  document.getElementById(`panel-${name}`)?.classList.add("active");

  if (name === "bots") refreshBotList();
  if (name === "logs") refreshLogFilter();
  if (name === "chat") refreshChatSelect();
  if (name === "usage") refreshUsageSelect();
  if (name === "settings") loadSettingsConfig();
}

// в”Ђв”Ђ Daemon status в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

function setDaemonStatus(status: "online" | "starting" | "error"): void {
  const dot = document.querySelector(".status-dot")!;
  const text = document.getElementById("status-text")!;
  dot.className = "status-dot " + status;
  text.textContent = status === "online" ? "Running" : status === "starting" ? "Starting..." : "Error";
}

api.onBotStatusChange((data) => {
  if (data.status === "online" || data.status === "manager-ready" || data.status === "starting") {
    setDaemonStatus("online");
  }
});

// Active polling: a successful getBots() call (even with 0 bots) means the daemon is running.
async function initialStatusCheck(): Promise<void> {
  try {
    await api.getBots(); // If this succeeds, IPC is working = daemon is online
    setDaemonStatus("online");
  } catch {
    // Daemon not ready yet вЂ” retry in 2s
    setTimeout(initialStatusCheck, 2000);
  }
}
setTimeout(initialStatusCheck, 1500); // Give daemon 1.5s to initialize

// Final fallback вЂ” set online after 10s regardless
setTimeout(() => setDaemonStatus("online"), 10000);

// в”Ђв”Ђ Bot Management в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

async function refreshBotList(): Promise<void> {
  const container = document.getElementById("bot-list")!;
  try {
    const bots = await api.getBots();
    if (bots.length === 0) {
      container.innerHTML = '<p class="empty-state">No bots configured. Add one to get started.</p>';
      return;
    }

    container.innerHTML = bots.map((b) => `
      <div class="bot-card" id="bot-${b.id}">
        <div class="bot-info">
          <h4>@${escapeHtml(b.username)}</h4>
          <div class="bot-path">${escapeHtml(b.workingDir)}</div>
          <div class="bot-meta">Model: ${escapeHtml(b.model)}</div>
        </div>
        <span class="bot-status ${b.status}">${b.status}</span>
        <div class="bot-actions">
          <button class="btn btn-secondary btn-bot-remove" data-bot-id="${b.id}">Remove</button>
        </div>
      </div>
    `).join("");

    // Wire remove buttons
    container.querySelectorAll(".btn-bot-remove").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const botId = Number((btn as HTMLElement).dataset.botId!);
        if (confirm(`Remove bot #${botId}?`)) {
          await api.removeBot(botId);
          refreshBotList();
        }
      });
    });
  } catch (err) {
    container.innerHTML = `<p class="error-msg">Failed to load bots: ${escapeHtml(String(err))}</p>`;
  }
}

document.getElementById("btn-add-bot")?.addEventListener("click", () => {
  document.getElementById("add-bot-form")!.classList.toggle("hidden");
});

document.getElementById("btn-add-cancel")?.addEventListener("click", () => {
  document.getElementById("add-bot-form")!.classList.add("hidden");
});

document.getElementById("btn-add-confirm")?.addEventListener("click", async () => {
  const token = (document.getElementById("bot-token") as HTMLInputElement).value.trim();
  const dir = (document.getElementById("bot-dir") as HTMLInputElement).value.trim();
  const errorEl = document.getElementById("add-bot-error")!;

  if (!token || !dir) {
    errorEl.textContent = "Both fields are required.";
    errorEl.classList.remove("hidden");
    return;
  }

  try {
    await api.addBot(token, dir);
    document.getElementById("add-bot-form")!.classList.add("hidden");
    (document.getElementById("bot-token") as HTMLInputElement).value = "";
    (document.getElementById("bot-dir") as HTMLInputElement).value = "";
    errorEl.classList.add("hidden");
    refreshBotList();
  } catch (err) {
    errorEl.textContent = String(err);
    errorEl.classList.remove("hidden");
  }
});

// в”Ђв”Ђ Live Log Viewer в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

const logOutput = document.getElementById("log-output")! as HTMLPreElement;
const logAutoscroll = document.getElementById("log-autoscroll") as HTMLInputElement;
let logEntries: LogEntry[] = [];

async function refreshLogFilter(): Promise<void> {
  const select = document.getElementById("log-filter-bot") as HTMLSelectElement;
  const bots = await api.getBots();
  select.innerHTML = '<option value="all">All bots</option>' +
    bots.map((b) => `<option value="${b.username}">@${escapeHtml(b.username)}</option>`).join("");
}

function renderLogs(): void {
  const botFilter = (document.getElementById("log-filter-bot") as HTMLSelectElement).value;
  const levelFilter = (document.getElementById("log-filter-level") as HTMLSelectElement).value;
  const search = (document.getElementById("log-search") as HTMLInputElement).value.toLowerCase();

  const filtered = logEntries.filter((e) => {
    if (botFilter !== "all" && e.bot !== botFilter) return false;
    if (levelFilter !== "all" && e.level !== levelFilter) return false;
    if (search && !e.message.toLowerCase().includes(search)) return false;
    return true;
  });

  logOutput.innerHTML = filtered.map((e) => {
    const time = new Date(e.ts).toLocaleTimeString("en-GB", { hour12: false });
    return `<span class="log-line ${e.level}"><span class="ts">${time}</span><span class="bot-tag">[${escapeHtml(e.bot)}]</span>${escapeHtml(e.message)}</span>`;
  }).join("\n");

  if (logAutoscroll.checked) {
    const container = document.getElementById("log-container")!;
    container.scrollTop = container.scrollHeight;
  }
}

// Load initial logs
api.getLogs(200).then((entries) => {
  logEntries = entries;
  renderLogs();
});

// Stream new log lines
api.onLogLine((entry) => {
  logEntries.push(entry);
  if (logEntries.length > 2000) logEntries.shift();
  renderLogs();
});

document.getElementById("log-filter-bot")?.addEventListener("change", renderLogs);
document.getElementById("log-filter-level")?.addEventListener("change", renderLogs);
document.getElementById("log-search")?.addEventListener("input", renderLogs);

// в”Ђв”Ђ Chat в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

let currentChatBot = 0;
let isStreaming = false;

async function refreshChatSelect(): Promise<void> {
  const select = document.getElementById("chat-bot-select") as HTMLSelectElement;
  const bots = await api.getBots();
  select.innerHTML = '<option value="">Select bot...</option>' +
    bots.filter(b => b.status === "online").map(b => `<option value="${b.id}">@${escapeHtml(b.username)}</option>`).join("");
}

(document.getElementById("chat-bot-select") as HTMLSelectElement)?.addEventListener("change", function () {
  currentChatBot = Number(this.value);
});

(document.getElementById("chat-effort") as HTMLSelectElement)?.addEventListener("change", function () {
  if (currentChatBot) api.setEffort(currentChatBot, 0, this.value);
});

document.querySelectorAll("#panel-chat .mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#panel-chat .mode-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    if (currentChatBot) {
      api.setMode(currentChatBot, 0, (btn as HTMLElement).dataset.mode!);
    }
  });
});

function addChatMessage(role: "user" | "assistant", text: string): void {
  const container = document.getElementById("chat-messages")!;
  const div = document.createElement("div");
  div.className = `chat-msg ${role}`;
  div.innerHTML = `<div class="msg-role">${role === "user" ? "You" : "Claude"}</div><div>${escapeHtml(text)}</div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

let assistantMsgDiv: HTMLDivElement | null = null;

api.onStreamChunk(({ chatId, text }) => {
  if (chatId !== 0) return;
  if (!assistantMsgDiv) {
    const container = document.getElementById("chat-messages")!;
    assistantMsgDiv = document.createElement("div");
    assistantMsgDiv.className = "chat-msg assistant";
    assistantMsgDiv.innerHTML = '<div class="msg-role">Claude</div><div class="stream-content"></div>';
    container.appendChild(assistantMsgDiv);
  }
  const content = assistantMsgDiv.querySelector(".stream-content")!;
  content.textContent += text;
  const container = document.getElementById("chat-messages")!;
  container.scrollTop = container.scrollHeight;
});

api.onStreamDone(({ chatId }) => {
  if (chatId !== 0) return;
  assistantMsgDiv = null;
  isStreaming = false;
  toggleChatButtons(false);
});

api.onStreamError(({ chatId, error }) => {
  if (chatId !== 0) return;
  assistantMsgDiv = null;
  isStreaming = false;
  toggleChatButtons(false);
  addChatMessage("assistant", `Error: ${error}`);
});

function toggleChatButtons(sending: boolean): void {
  isStreaming = sending;
  document.getElementById("btn-send")!.classList.toggle("hidden", sending);
  document.getElementById("btn-cancel-chat")!.classList.toggle("hidden", !sending);
}

document.getElementById("btn-send")?.addEventListener("click", sendChatMessage);
document.getElementById("chat-input")?.addEventListener("keydown", (e) => {
  if ((e as KeyboardEvent).key === "Enter" && !(e as KeyboardEvent).shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
});

document.getElementById("btn-cancel-chat")?.addEventListener("click", async () => {
  if (currentChatBot) {
    await api.cancelQuery(currentChatBot, 0);
    isStreaming = false;
    toggleChatButtons(false);
  }
});

async function sendChatMessage(): Promise<void> {
  if (!currentChatBot || isStreaming) return;
  const input = document.getElementById("chat-input") as HTMLTextAreaElement;
  const text = input.value.trim();
  if (!text) return;

  input.value = "";

  // в”Ђв”Ђ !command: shell escape hatch в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  if (text.startsWith("!")) {
    const cmd = text.slice(1).trim();
    addChatMessage("user", `!${cmd}`);

    if (!cmd || cmd === "history") {
      if (cmd === "history") {
        const hist = await api.shellHistory(currentChatBot);
        const lines = hist.map((e, i) =>
          `[${i + 1}] ${new Date(e.ts).toLocaleTimeString()}  ${(e.elapsedMs / 1000).toFixed(1)}s  ${e.command}`
        ).join("\n");
        addChatMessage("assistant", lines || "No shell command history.");
      } else {
        addChatMessage("assistant", "Usage: !<command>\n\nExamples:\n!ls -la\n!npm test\n!git status\n!history");
      }
      return;
    }

    addChatMessage("assistant", `Running: ${cmd}...`);
    // Find bot working dir
    const bots = await api.getBots();
    const bot = bots.find(b => b.id === currentChatBot);
    const cwd = bot?.workingDir || ".";

    const result = await api.runShell(currentChatBot, cmd, cwd);
    const header = result.error
      ? `! ${cmd}  (${(result.elapsedMs / 1000).toFixed(1)}s, ${result.error})`
      : `! ${cmd}  (${(result.elapsedMs / 1000).toFixed(1)}s)`;
    addChatMessage("assistant", `${header}\n${result.output || "(no output)"}`);
    return;
  }

  addChatMessage("user", text);
  toggleChatButtons(true);

  try {
    await api.sendMessage(currentChatBot, 0, text);
  } catch (err) {
    addChatMessage("assistant", `Error: ${String(err)}`);
    toggleChatButtons(false);
  }
}

// в”Ђв”Ђ Usage Dashboard в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

async function refreshUsageSelect(): Promise<void> {
  const select = document.getElementById("usage-bot-select") as HTMLSelectElement;
  const bots = await api.getBots();
  select.innerHTML = '<option value="">Select bot...</option>' +
    bots.map(b => `<option value="${b.id}">@${escapeHtml(b.username)}</option>`).join("");
}

document.getElementById("usage-bot-select")?.addEventListener("change", async function () {
  const botId = Number((this as HTMLSelectElement).value);
  if (!botId) return;
  const usage = await api.getUsage(botId);
  document.getElementById("usage-input")!.textContent = usage.inputTokens.toLocaleString();
  document.getElementById("usage-output")!.textContent = usage.outputTokens.toLocaleString();
  document.getElementById("usage-cache-write")!.textContent = usage.cacheCreationTokens.toLocaleString();
  document.getElementById("usage-cache-read")!.textContent = usage.cacheReadTokens.toLocaleString();
  document.getElementById("usage-total")!.textContent = usage.totalTokens.toLocaleString();
});

// Real-time token updates
api.onTokenUpdate(({ botId, usage }) => {
  const select = document.getElementById("usage-bot-select") as HTMLSelectElement;
  if (Number(select.value) === botId) {
    document.getElementById("usage-input")!.textContent = usage.inputTokens.toLocaleString();
    document.getElementById("usage-output")!.textContent = usage.outputTokens.toLocaleString();
    document.getElementById("usage-cache-write")!.textContent = usage.cacheCreationTokens.toLocaleString();
    document.getElementById("usage-cache-read")!.textContent = usage.cacheReadTokens.toLocaleString();
    document.getElementById("usage-total")!.textContent = usage.totalTokens.toLocaleString();
  }
});

// в”Ђв”Ђ Settings в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

document.querySelectorAll("#panel-settings .mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#panel-settings .mode-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

// Provider settings
document.getElementById("settings-provider")?.addEventListener("change", function () {
  const provider = (this as HTMLSelectElement).value;
  document.getElementById("deepseek-config")!.classList.toggle("hidden", provider !== "deepseek");
});

document.getElementById("btn-save-deepseek-key")?.addEventListener("click", async () => {
  const key = (document.getElementById("settings-deepseek-key") as HTMLInputElement).value.trim();
  const status = document.getElementById("deepseek-status")!;
  if (!key) {
    status.textContent = "Enter a key first.";
    status.classList.remove("hidden");
    return;
  }
  try {
    await api.setDeepseekKey(key);
    status.textContent = "Key saved.";
    status.classList.remove("hidden");
  } catch (err) {
    status.textContent = `Error: ${String(err)}`;
    status.classList.remove("hidden");
  }
});

// Save bot token
document.getElementById("btn-save-bot-token")?.addEventListener("click", async () => {
  const token = (document.getElementById("settings-bot-token") as HTMLInputElement).value.trim();
  const status = document.getElementById("bot-token-status")!;
  if (!token) { status.textContent = "Enter a token first."; status.classList.remove("hidden"); return; }
  try {
    await api.saveConfig("TELEGRAM_BOT_TOKEN", token);
    status.textContent = "Token saved. Restart to apply.";
    status.classList.remove("hidden");
  } catch (err) {
    status.textContent = `Error: ${String(err)}`;
    status.classList.remove("hidden");
  }
});

// Save owner ID
document.getElementById("btn-save-owner-id")?.addEventListener("click", async () => {
  const id = (document.getElementById("settings-owner-id") as HTMLInputElement).value.trim();
  const status = document.getElementById("owner-id-status")!;
  if (!id || !/^\d+$/.test(id)) { status.textContent = "Enter a valid numeric ID."; status.classList.remove("hidden"); return; }
  try {
    await api.saveConfig("TELEGRAM_OWNER_ID", id);
    status.textContent = "Owner ID saved.";
    status.classList.remove("hidden");
  } catch (err) {
    status.textContent = `Error: ${String(err)}`;
    status.classList.remove("hidden");
  }
});


async function loadSettingsConfig(): Promise<void> {
  try {
    const cfg = await api.getConfig();
    (document.getElementById("settings-bot-token") as HTMLInputElement).value = cfg.botToken || "";
    (document.getElementById("settings-owner-id") as HTMLInputElement).value = cfg.ownerId ? String(cfg.ownerId) : "";
    (document.getElementById("settings-ngrok") as HTMLInputElement).value = cfg.ngrokToken || "";
  } catch { /* config not available yet */ }
}

// Chat provider selector
document.getElementById("chat-provider")?.addEventListener("change", function () {
  if (currentChatBot) {
    api.setProvider(currentChatBot, 0, (this as HTMLSelectElement).value);
  }
});

// в”Ђв”Ђ Utility в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// в”Ђв”Ђ Init в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

refreshBotList();

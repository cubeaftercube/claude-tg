import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "./config.js";
import { logTool, logApproval, logStatus } from "./log.js";
import { providerRegistry } from "./providers/registry.js";
import type { AIProvider, ProviderQueryOptions } from "./providers/types.js";
import { costTracker } from "./cost/tracker.js";

const COOLDOWN_MS = 2000;
const THINKING_ROTATE_MS = 2000;

const AUTO_APPROVE_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
  "Task",
  "TaskCreate",
  "TaskUpdate",
  "TaskList",
  "TaskGet",
  "TaskOutput",
  "TaskStop",
];

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface AskUserQuestion {
  question: string;
  header: string;
  options: Array<{ label: string; description: string }>;
  multiSelect: boolean;
}

export interface SendCallbacks {
  onStreamChunk: (text: string) => void;
  onStatusUpdate: (status: string) => void;
  onToolApproval: (
    toolName: string,
    input: Record<string, unknown>
  ) => Promise<"allow" | "always" | "deny">;
  onAskUser: (questions: AskUserQuestion[]) => Promise<Record<string, string>>;
  onPlanApproval: (planFileContent?: string) => Promise<boolean>;
  onResult: (result: {
    text: string;
    usage: TokenUsage;
    turns: number;
    durationMs: number;
  }) => void;
  onError: (error: Error) => void;
  onSessionReset?: () => void;
}

export const AVAILABLE_MODELS = [
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-fable-5", label: "Fable 5" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
] as const;

const DEFAULT_MODEL = AVAILABLE_MODELS[0].id;

// Claude Code-style spinner words shown during thinking
const THINKING_WORDS = [
  "Thinking...",
  "Reasoning...",
  "Analyzing...",
  "Contemplating...",
  "Processing...",
  "Investigating...",
  "Considering...",
  "Evaluating...",
  "Synthesizing...",
  "Formulating...",
  "Pondering...",
  "Deliberating...",
  "Examining...",
  "Deciphering...",
];

function formatToolStatus(toolName: string, detail?: string): string {
  const toolVerbs: Record<string, string> = {
    Read: "Reading",
    Bash: "Running",
    Edit: "Editing",
    MultiEdit: "Editing",
    Write: "Writing",
    Glob: "Searching files",
    Grep: "Searching code",
    WebSearch: "Searching",
    WebFetch: "Fetching",
    Task: "Running agent",
    TodoWrite: "Updating tasks",
    NotebookEdit: "Editing notebook",
    EnterPlanMode: "Planning",
    ExitPlanMode: "Finalizing plan",
  };
  const verb = toolVerbs[toolName] || `Using ${toolName}`;
  return detail ? `${verb}: ${detail}` : `${verb}...`;
}

// Full path/detail for terminal logs
function toolDetail(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "Read":
    case "Write":
    case "Edit":
      return String(input.file_path || "");
    case "Bash":
      return String(input.command || "").slice(0, 80);
    case "Glob":
      return String(input.pattern || "");
    case "Grep":
      return String(input.pattern || "");
    default:
      return "";
  }
}

// Short detail for Telegram status (filename only, truncated commands)
function toolStatusDetail(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
      return path.basename(String(input.file_path || ""));
    case "NotebookEdit":
      return path.basename(String(input.notebook_path || ""));
    case "Bash":
      return String(input.command || "").slice(0, 60);
    case "Glob":
      return String(input.pattern || "");
    case "Grep":
      return `"${String(input.pattern || "").slice(0, 40)}"`;
    case "WebSearch":
      return `"${String(input.query || "").slice(0, 40)}"`;
    case "WebFetch":
      return String(input.url || "").slice(0, 50);
    default:
      return "";
  }
}

interface PersistedState {
  sessions: Record<string, string>;
  sessionTokens: Record<string, TokenUsage>;
  selectedModels: Record<string, string>;
  sessionApprovedTools: Record<string, string[]>; // Set<string> serialized as array
  yoloChats: number[]; // Set<number> serialized as array
  selectedEfforts: Record<string, string>; // Per-chat effort level
  permissionModes: Record<string, string>; // Per-chat permission mode
  selectedProviders: Record<string, string>; // Per-chat provider id
}

export class ClaudeBridge {
  readonly workingDir: string;
  readonly botId: number;
  private readonly tag: string;
  private readonly stateFile: string;

  private sessions = new Map<number, string>();
  private sessionTokens = new Map<number, TokenUsage>();
  private activeAborts = new Map<number, AbortController>();
  private selectedModels = new Map<number, string>();
  private lastQueryEnd = new Map<number, number>();
  private lastPrompts = new Map<number, string>();
  private sessionApprovedTools = new Map<number, Set<string>>();
  private yoloChats = new Set<number>();
  private cancelRequested = new Set<number>(); // Tracks user-initiated cancels to suppress error messages
  private selectedEfforts = new Map<number, string>(); // Per-chat effort level
  private permissionModes = new Map<number, string>(); // Per-chat permission mode: auto|plan|bypass|manual
  private selectedProviders = new Map<number, string>(); // Per-chat provider: "claude" | "deepseek"
  private lastQueryCosts = new Map<number, string>(); // Per-chat last query cost formatted string
  // Strip CLAUDECODE env var once so SDK subprocesses don't refuse to start
  // when the daemon is launched from within a Claude Code session.
  private readonly cleanEnv: Record<string, string | undefined>;

  constructor(botId: number, workingDir: string, tag: string) {
    this.botId = botId;
    this.workingDir = workingDir;
    this.tag = tag;
    this.stateFile = path.join(config.DATA_DIR, `state-${botId}.json`);
    // Strip CLAUDECODE so SDK subprocesses don't refuse to start,
    // and strip ANTHROPIC_API_KEY so stale keys from .env files or
    // shell env don't override the user's working Claude Code CLI auth.
    // If explicitly configured in our config, re-add it.
    const { CLAUDECODE: _, ANTHROPIC_API_KEY: __, ...cleanEnv } = process.env;
    if (config.ANTHROPIC_API_KEY) {
      cleanEnv.ANTHROPIC_API_KEY = config.ANTHROPIC_API_KEY;
    }
    // Forward env vars from Claude Code's settings.json (e.g. ANTHROPIC_BASE_URL
    // for users behind proxies). Only set if not already in process.env.
    try {
      const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
        if (settings.env && typeof settings.env === "object") {
          for (const [key, value] of Object.entries(settings.env)) {
            if (typeof value === "string" && !cleanEnv[key]) {
              cleanEnv[key] = value;
            }
          }
        }
      }
    } catch {}
    this.cleanEnv = cleanEnv;
    this.loadState();
  }

  private loadState(): void {
    try {
      if (!fs.existsSync(this.stateFile)) return;
      const raw: PersistedState = JSON.parse(fs.readFileSync(this.stateFile, "utf-8"));
      for (const [k, v] of Object.entries(raw.sessions || {})) this.sessions.set(Number(k), v);
      for (const [k, v] of Object.entries(raw.sessionTokens || {})) this.sessionTokens.set(Number(k), v);
      for (const [k, v] of Object.entries(raw.selectedModels || {})) this.selectedModels.set(Number(k), v);
      for (const [k, v] of Object.entries(raw.sessionApprovedTools || {})) {
        this.sessionApprovedTools.set(Number(k), new Set(v));
      }
      for (const id of raw.yoloChats || []) this.yoloChats.add(Number(id));
      for (const [k, v] of Object.entries(raw.selectedEfforts || {})) this.selectedEfforts.set(Number(k), v);
      for (const [k, v] of Object.entries(raw.permissionModes || {})) this.permissionModes.set(Number(k), v);
      for (const [k, v] of Object.entries(raw.selectedProviders || {})) this.selectedProviders.set(Number(k), v);
    } catch {}
  }

  private saveState(): void {
    try {
      fs.mkdirSync(config.DATA_DIR, { recursive: true, mode: 0o700 });
      // Serialize Sets to arrays for JSON storage
      const approvedTools: Record<string, string[]> = {};
      for (const [k, v] of this.sessionApprovedTools) {
        approvedTools[String(k)] = [...v];
      }
      const state: PersistedState = {
        sessions: Object.fromEntries(this.sessions),
        sessionTokens: Object.fromEntries(this.sessionTokens),
        selectedModels: Object.fromEntries(this.selectedModels),
        sessionApprovedTools: approvedTools,
        yoloChats: [...this.yoloChats],
        selectedEfforts: Object.fromEntries(this.selectedEfforts),
        permissionModes: Object.fromEntries(this.permissionModes),
        selectedProviders: Object.fromEntries(this.selectedProviders),
      };
      fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
    } catch {}
  }

  isProcessing(chatId: number): boolean {
    return this.activeAborts.has(chatId);
  }

  /** Atomically try to claim the processing lock for a chat.
   *  Returns true if the lock was acquired, false if already processing. */
  tryStartProcessing(chatId: number): boolean {
    if (this.activeAborts.has(chatId)) return false;
    // Pre-claim with a placeholder вЂ” replaced by sendMessage() with a real AbortController.
    // This closes the race window between the isProcessing check and the AbortController creation.
    this.activeAborts.set(chatId, new AbortController());
    this.cancelRequested.delete(chatId);
    return true;
  }

  private releaseProcessing(chatId: number): void {
    this.activeAborts.delete(chatId);
    this.lastQueryEnd.set(chatId, Date.now());
  }

  getSessionTokens(chatId: number): TokenUsage {
    return this.sessionTokens.get(chatId) || { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
  }

  clearSession(chatId: number): void {
    this.sessions.delete(chatId);
    this.sessionTokens.delete(chatId);
    this.sessionApprovedTools.delete(chatId);
    this.yoloChats.delete(chatId);
    this.cancelRequested.delete(chatId);
    this.selectedEfforts.delete(chatId);
    this.permissionModes.delete(chatId);
    this.lastQueryCosts.delete(chatId);
    costTracker.clearSession(chatId);
    this.saveState();
  }

  setYolo(chatId: number, enabled: boolean): void {
    if (enabled) {
      this.yoloChats.add(chatId);
    } else {
      this.yoloChats.delete(chatId);
    }
    this.saveState();
  }

  isYolo(chatId: number): boolean {
    // Backward compat: yolo is now "bypass" permission mode
    return this.permissionModes.get(chatId) === "bypass" || this.yoloChats.has(chatId);
  }

  setModel(chatId: number, modelId: string): void {
    this.selectedModels.set(chatId, modelId);
    this.sessions.delete(chatId);
    this.saveState();
  }

  getModel(chatId: number): string {
    return this.selectedModels.get(chatId) || DEFAULT_MODEL;
  }

  getSessionId(chatId: number): string | undefined {
    return this.sessions.get(chatId);
  }

  setSessionId(chatId: number, sessionId: string): void {
    this.sessions.set(chatId, sessionId);
    this.sessionTokens.delete(chatId);
    this.sessionApprovedTools.delete(chatId);
    this.saveState();
  }

  getProjectSessionsDir(): string {
    const projectKey = this.workingDir.replace(/[\\/]/g, "-");
    return path.join(os.homedir(), ".claude", "projects", projectKey);
  }

  listRecentSessions(limit = 10): Array<{ sessionId: string; modifiedAt: Date; promptPreview: string }> {
    const dir = this.getProjectSessionsDir();
    if (!fs.existsSync(dir)) return [];

    const files = fs.readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => {
        const fullPath = path.join(dir, f);
        const stat = fs.statSync(fullPath);
        return { name: f, fullPath, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit);

    return files.map(({ name, fullPath, mtime }) => {
      const sessionId = name.replace(/\.jsonl$/, "");
      let promptPreview = "(no preview)";

      try {
        const fd = fs.openSync(fullPath, "r");
        const buf = Buffer.alloc(8192);
        const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
        fs.closeSync(fd);

        const chunk = buf.toString("utf-8", 0, bytesRead);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            if (entry.type === "user" && entry.sessionId === sessionId) {
              const content = entry.message?.content;
              let text = "";
              if (typeof content === "string") {
                text = content;
              } else if (Array.isArray(content)) {
                const textBlock = content.find((b: Record<string, unknown>) => b.type === "text");
                if (textBlock) text = String(textBlock.text || "");
              }
              if (text) {
                promptPreview = text.length > 80 ? text.slice(0, 80) + "..." : text;
                break;
              }
            }
          } catch {}
        }
      } catch {}

      return { sessionId, modifiedAt: new Date(mtime), promptPreview };
    });
  }

  getSessionHistory(sessionId: string, limit = 10): Array<{ role: "user" | "assistant"; text: string; timestamp: string }> {
    try {
      const filePath = path.join(this.getProjectSessionsDir(), `${sessionId}.jsonl`);
      if (!fs.existsSync(filePath)) return [];

      const raw = fs.readFileSync(filePath, "utf-8");
      const entries: Array<{ role: "user" | "assistant"; text: string; timestamp: string }> = [];

      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (entry.type !== "user" && entry.type !== "assistant") continue;

          const content = entry.message?.content;
          let text = "";

          if (entry.type === "user") {
            if (typeof content === "string") {
              text = content;
            } else if (Array.isArray(content)) {
              const textBlock = content.find((b: Record<string, unknown>) => b.type === "text");
              if (textBlock) text = String(textBlock.text || "");
            }
          } else {
            // assistant вЂ” extract only text blocks, skip thinking/tool_use
            if (Array.isArray(content)) {
              const texts = content
                .filter((b: Record<string, unknown>) => b.type === "text")
                .map((b: Record<string, unknown>) => String(b.text || ""));
              text = texts.join("\n");
            }
          }

          if (!text.trim()) continue;

          const truncated = text.length > 500 ? text.slice(0, 500) + "..." : text;
          entries.push({
            role: entry.type as "user" | "assistant",
            text: truncated,
            timestamp: entry.timestamp || "",
          });
        } catch {}
      }

      return entries.slice(-limit);
    } catch {
      return [];
    }
  }

  cancelQuery(chatId: number): boolean {
    const controller = this.activeAborts.get(chatId);
    if (controller) {
      this.cancelRequested.add(chatId); // Mark as user-initiated вЂ” suppress error callbacks
      controller.abort();
      return true;
    }
    return false;
  }

  isCancelRequested(chatId: number): boolean {
    return this.cancelRequested.has(chatId);
  }

  isCoolingDown(chatId: number): boolean {
    const last = this.lastQueryEnd.get(chatId);
    if (!last) return false;
    return Date.now() - last < COOLDOWN_MS;
  }

  setLastPrompt(chatId: number, prompt: string): void {
    this.lastPrompts.set(chatId, prompt);
  }

  getLastPrompt(chatId: number): string | undefined {
    return this.lastPrompts.get(chatId);
  }

  // в”Ђв”Ђ Effort control в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

  setEffort(chatId: number, level: string): void {
    this.selectedEfforts.set(chatId, level);
    this.saveState();
  }

  getEffort(chatId: number): string {
    return this.selectedEfforts.get(chatId) || "medium";
  }

  // в”Ђв”Ђ Permission modes в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

  setPermissionMode(chatId: number, mode: string): void {
    this.permissionModes.set(chatId, mode);
    // Keep yoloChats in sync for backward compat
    if (mode === "bypass") {
      this.yoloChats.add(chatId);
    } else {
      this.yoloChats.delete(chatId);
    }
    this.saveState();
  }

  getPermissionMode(chatId: number): string {
    return this.permissionModes.get(chatId) || "auto";
  }

  // в”Ђв”Ђ Provider selection в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

  setProvider(chatId: number, providerId: string): void {
    this.selectedProviders.set(chatId, providerId);
    this.saveState();
  }

  getProvider(chatId: number): string {
    return this.selectedProviders.get(chatId) || "claude";
  }

  getLastQueryCost(chatId: number): string {
    return this.lastQueryCosts.get(chatId) || "";
  }

  getFormattedSessionCost(chatId: number): string {
    return costTracker.getFormattedSessionCost(chatId);
  }

  /** Persist all current state to disk вЂ” called on shutdown */
  flushState(): void {
    this.saveState();
  }

  abortAll(): void {
    for (const [, controller] of this.activeAborts) {
      controller.abort();
    }
    this.activeAborts.clear();
  }

  getTempDir(chatId?: number): string {
    const base = path.join(os.tmpdir(), `claude-tg-${this.botId}`);
    return chatId != null ? path.join(base, String(chatId)) : base;
  }

  cleanupTempFiles(chatId?: number): void {
    try {
      const tmpDir = this.getTempDir(chatId);
      if (fs.existsSync(tmpDir)) {
        const files = fs.readdirSync(tmpDir);
        for (const f of files) {
          const fullPath = path.join(tmpDir, f);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            fs.rmSync(fullPath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(fullPath);
          }
        }
        fs.rmdirSync(tmpDir);
      }
      // If a per-chat cleanup left the base dir empty, remove it too
      if (chatId != null) {
        const baseDir = this.getTempDir();
        try {
          if (fs.existsSync(baseDir) && fs.readdirSync(baseDir).length === 0) {
            fs.rmdirSync(baseDir);
          }
        } catch {}
      }
    } catch {}
  }

  async sendMessage(
    chatId: number,
    prompt: string,
    callbacks: SendCallbacks,
    permissionMode: "default" | "bypassPermissions" = "default",
    maxTurns?: number
  ): Promise<void> {
    // Replace the tryStartProcessing() placeholder with a fresh AbortController.
    // tryStartProcessing() already checked the lock, so this is a safe swap.
    const abortController = new AbortController();
    this.activeAborts.set(chatId, abortController);
    this.cancelRequested.delete(chatId);

    // Track whether the abort was triggered so we can suppress spurious errors
    // from SDK internal operations that reject after the loop exits.
    let wasAborted = false;
    abortController.signal.addEventListener("abort", () => { wasAborted = true; }, { once: true });

    const sessionId = this.sessions.get(chatId);
    let hasStreamedText = false;

    let wordIdx = Math.floor(Math.random() * THINKING_WORDS.length);
    const thinkingInterval = setInterval(() => {
      if (hasStreamedText || abortController.signal.aborted) {
        clearInterval(thinkingInterval);
        return;
      }
      wordIdx = (wordIdx + 1) % THINKING_WORDS.length;
      const word = THINKING_WORDS[wordIdx];
      callbacks.onStatusUpdate(word);
      logStatus(word, this.tag);
    }, THINKING_ROTATE_MS);

    try {
      const model = this.selectedModels.get(chatId) || DEFAULT_MODEL;
      const providerId = this.getProvider(chatId);

      // Route non-Claude providers through their own query pipeline
      if (providerId !== "claude" && providerRegistry.has(providerId)) {
        clearInterval(thinkingInterval);
        await this._sendViaProvider(chatId, prompt, model, providerId, callbacks, abortController);
        return;
      }

      let lastWrittenFilePath: string | null = null;

      // Resolve permission mode
      const chatMode = this.getPermissionMode(chatId);
      let sdkPermissionMode: "default" | "bypassPermissions" | "plan" = "default";
      if (chatMode === "bypass") sdkPermissionMode = "bypassPermissions";
      else if (chatMode === "plan") sdkPermissionMode = "plan";
      const isManual = chatMode === "manual";

      // Resolve effort (only supported values by SDK)
      const effort = this.getEffort(chatId);
      const effortLevels = ["low", "medium", "high", "max"] as const;
      const validEffort = effortLevels.includes(effort as typeof effortLevels[number]) ? effort as typeof effortLevels[number] : undefined;

      const q = query({
        prompt,
        options: {
          env: this.cleanEnv,
          cwd: this.workingDir,
          model,
          includePartialMessages: true,
          permissionMode: permissionMode === "bypassPermissions" ? "bypassPermissions" : sdkPermissionMode,
          settingSources: ['user', 'project', 'local'],
          ...(maxTurns ? { maxTurns } : {}),
          ...(sessionId ? { resume: sessionId } : {}),
          ...(validEffort && validEffort !== "medium" ? { effort: validEffort } : {}),
          abortController,
          canUseTool: async (toolName, input, { signal }) => {
            // Stop thinking words вЂ” tool status is more informative
            clearInterval(thinkingInterval);

            const inp = input as Record<string, unknown>;
            const detail = toolDetail(toolName, inp);
            const statusDetail = toolStatusDetail(toolName, inp) || undefined;

            // Interactive: relay questions to user and collect answers
            if (toolName === "AskUserQuestion") {
              logTool(toolName, "", this.tag);
              callbacks.onStatusUpdate("Asking user...");
              try {
                const questions = (inp.questions || []) as AskUserQuestion[];
                const answers = await Promise.race([
                  callbacks.onAskUser(questions),
                  new Promise<Record<string, string>>((_, reject) => {
                    if (signal.aborted) { reject(new Error("aborted")); return; }
                    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
                  }),
                ]);
                return { behavior: "allow" as const, updatedInput: { ...inp, answers } };
              } catch {
                return { behavior: "deny" as const, message: "User did not answer (cancelled or timed out)" };
              }
            }

            // Track the last file written (used to capture plan content)
            if (toolName === "Write") {
              const filePath = inp.file_path;
              if (typeof filePath === "string") {
                lastWrittenFilePath = filePath;
              }
            }

            // Interactive: show plan and get approval before proceeding
            if (toolName === "ExitPlanMode") {
              logTool(toolName, "", this.tag);
              callbacks.onStatusUpdate("Waiting for plan approval...");
              let planFileContent: string | undefined;

              // Method 1: Read from tracked Write tool path (stream events or canUseTool)
              if (lastWrittenFilePath) {
                try {
                  planFileContent = fs.readFileSync(lastWrittenFilePath, "utf-8");
                } catch {}
              }

              // Method 2: Find most recent plan file in ~/.claude/plans/
              if (!planFileContent) {
                try {
                  const plansDir = path.join(os.homedir(), ".claude", "plans");
                  if (fs.existsSync(plansDir)) {
                    const now = Date.now();
                    const files = fs.readdirSync(plansDir)
                      .filter(f => f.endsWith(".md"))
                      .map(f => ({ name: f, mtime: fs.statSync(path.join(plansDir, f)).mtimeMs }))
                      .filter(f => now - f.mtime < 5 * 60 * 1000) // written in last 5 min
                      .sort((a, b) => b.mtime - a.mtime);
                    if (files.length > 0) {
                      planFileContent = fs.readFileSync(path.join(plansDir, files[0].name), "utf-8");
                    }
                  }
                } catch {}
              }
              const approved = await Promise.race([
                callbacks.onPlanApproval(planFileContent),
                new Promise<boolean>((resolve) => {
                  if (signal.aborted) { resolve(false); return; }
                  signal.addEventListener("abort", () => resolve(false), { once: true });
                }),
              ]);
              if (approved) {
                return { behavior: "allow" as const, updatedInput: input };
              }
              return { behavior: "deny" as const, message: "User rejected the plan via Telegram" };
            }

            // Manual mode: every tool requires explicit approval
            if (isManual) {
              logTool(`${toolName} (manual approval)`, detail, this.tag);
              callbacks.onStatusUpdate("Waiting for approval...");
              const result = await Promise.race([
                callbacks.onToolApproval(toolName, inp),
                new Promise<"deny">((resolve) => {
                  if (signal.aborted) { resolve("deny"); return; }
                  signal.addEventListener("abort", () => resolve("deny"), { once: true });
                }),
              ]);
              logApproval(toolName, result, this.tag);
              if (result === "allow") {
                return { behavior: "allow" as const, updatedInput: input };
              }
              return { behavior: "deny" as const, message: "User denied this action" };
            }

            if (AUTO_APPROVE_TOOLS.includes(toolName)) {
              logTool(toolName, detail, this.tag);
              callbacks.onStatusUpdate(formatToolStatus(toolName, statusDetail));
              return { behavior: "allow" as const, updatedInput: input };
            }

            // Check if user already approved this tool for the session
            if (this.sessionApprovedTools.get(chatId)?.has(toolName)) {
              logTool(`${toolName} (session-approved)`, detail, this.tag);
              callbacks.onStatusUpdate(formatToolStatus(toolName, statusDetail));
              return { behavior: "allow" as const, updatedInput: input };
            }

            logTool(`${toolName} (awaiting approval)`, detail, this.tag);
            callbacks.onStatusUpdate("Waiting for approval...");

            const result = await Promise.race([
              callbacks.onToolApproval(toolName, inp),
              new Promise<"deny">((resolve) => {
                if (signal.aborted) {
                  resolve("deny");
                  return;
                }
                signal.addEventListener("abort", () => resolve("deny"), {
                  once: true,
                });
              }),
            ]);

            if (result === "always") {
              if (!this.sessionApprovedTools.has(chatId)) {
                this.sessionApprovedTools.set(chatId, new Set());
              }
              this.sessionApprovedTools.get(chatId)!.add(toolName);
              this.saveState();
            }

            logApproval(toolName, result, this.tag);

            if (result === "allow" || result === "always") {
              return { behavior: "allow" as const, updatedInput: input };
            }
            return {
              behavior: "deny" as const,
              message: "User denied this action via Telegram",
            };
          },
        },
      });

      // Track tool_use blocks from stream events to capture Write file paths
      // (canUseTool may not be called for Write in the agent SDK)
      let streamToolName = "";
      let streamToolInputJson = "";

      for await (const message of q) {
        if (abortController.signal.aborted) break;

        if (message.type === "system" && message.subtype === "init") {
          if (sessionId && message.session_id !== sessionId) {
            callbacks.onSessionReset?.();
          }
          this.sessions.set(chatId, message.session_id);
        } else if (message.type === "stream_event") {
          const event = message.event as Record<string, unknown>;
          if (event.type === "content_block_start") {
            const block = event.content_block as Record<string, unknown> | undefined;
            if (block?.type === "tool_use" && typeof block.name === "string") {
              streamToolName = block.name;
              streamToolInputJson = "";
              const status = formatToolStatus(block.name);
              callbacks.onStatusUpdate(status);
              logStatus(status, this.tag);
            } else if (block?.type === "thinking") {
              callbacks.onStatusUpdate("Thinking deeply...");
              logStatus("Thinking deeply...", this.tag);
            }
          } else if (event.type === "content_block_delta") {
            const delta = event.delta as Record<string, unknown> | undefined;
            if (delta?.type === "text_delta" && typeof delta.text === "string") {
              if (!hasStreamedText) {
                hasStreamedText = true;
                clearInterval(thinkingInterval);
              }
              callbacks.onStreamChunk(delta.text);
            } else if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
              streamToolInputJson += delta.partial_json;
            }
          } else if (event.type === "content_block_stop") {
            if (streamToolName === "Write" && streamToolInputJson) {
              try {
                const parsed = JSON.parse(streamToolInputJson);
                if (typeof parsed.file_path === "string") {
                  lastWrittenFilePath = parsed.file_path;
                }
              } catch {}
            }
            streamToolName = "";
            streamToolInputJson = "";
          }
        } else if (message.type === "result") {
          clearInterval(thinkingInterval);
          if (message.subtype === "success") {
            const msg = message as Record<string, unknown>;
            const rawUsage = msg.usage as Record<string, number> | undefined;
            const usage: TokenUsage = {
              inputTokens: rawUsage?.input_tokens || 0,
              outputTokens: rawUsage?.output_tokens || 0,
              cacheCreationTokens: rawUsage?.cache_creation_input_tokens || 0,
              cacheReadTokens: rawUsage?.cache_read_input_tokens || 0,
            };

            const prev = this.sessionTokens.get(chatId) || { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
            this.sessionTokens.set(chatId, {
              inputTokens: prev.inputTokens + usage.inputTokens,
              outputTokens: prev.outputTokens + usage.outputTokens,
              cacheCreationTokens: prev.cacheCreationTokens + usage.cacheCreationTokens,
              cacheReadTokens: prev.cacheReadTokens + usage.cacheReadTokens,
            });
            this.saveState();

            // Track cost
            const modelId = this.selectedModels.get(chatId) || DEFAULT_MODEL;
            const queryCost = costTracker.track(
              chatId, modelId,
              usage.inputTokens, usage.outputTokens,
              usage.cacheCreationTokens, usage.cacheReadTokens,
            );
            if (queryCost) this.lastQueryCosts.set(chatId, queryCost);

            let resultText = msg.result as string || "";

            // Detect Claude API auth failures and provide actionable guidance
            if (resultText.includes("API Error: 403") || resultText.includes("Failed to authenticate")) {
              resultText = "Claude Code authentication failed.\n\nTo fix, run these commands on your server:\n1. claude login\n2. claude-tg stop && claude-tg start\n\nIf that doesn't work, update Claude Code:\n  npm install -g @anthropic-ai/claude-code@latest";
            }

            callbacks.onResult({
              text: resultText,
              usage,
              turns: msg.num_turns as number || 0,
              durationMs: msg.duration_ms as number || 0,
            });
          } else {
            const errors = (message as Record<string, unknown>).errors as string[] | undefined;
            callbacks.onError(
              new Error(errors?.join(", ") || "Claude query failed")
            );
          }
          break; // Result is the final message вЂ” exit immediately so the bot is ready for new requests
        }
      }
    } catch (error) {
      clearInterval(thinkingInterval);
      // Suppress errors from user-initiated cancels and SDK-internal abort rejections.
      // When the AbortController fires, the SDK's internal write and control-request
      // operations may reject with "Operation aborted" after the for-await loop exits.
      // These are NOT real errors вЂ” the user asked to cancel, or the SDK is cleaning up.
      const isAbortError =
        wasAborted ||
        this.isCancelRequested(chatId) ||
        (error instanceof Error &&
          (error.message === "Operation aborted" || error.name === "AbortError"));
      if (!isAbortError) {
        callbacks.onError(
          error instanceof Error ? error : new Error(String(error))
        );
      }
    } finally {
      clearInterval(thinkingInterval);
      this.releaseProcessing(chatId);
      this.cleanupTempFiles(chatId);
    }
  }

  /**
   * Route a message through a non-Claude provider (Deepseek, etc.).
   * Translates provider events to the standard callbacks.
   */
  private async _sendViaProvider(
    chatId: number,
    prompt: string,
    model: string,
    providerId: string,
    callbacks: SendCallbacks,
    abortController: AbortController,
  ): Promise<void> {
    const provider = providerRegistry.get(providerId);
    if (!provider) {
      callbacks.onError(new Error(`Provider "${providerId}" is not available.`));
      return;
    }

    const effort = this.getEffort(chatId);
    const effortLevels = ["low", "medium", "high", "max"] as const;
    const validEffort = effortLevels.includes(effort as typeof effortLevels[number])
      ? (effort as typeof effortLevels[number])
      : undefined;

    const providerOpts: ProviderQueryOptions = {
      prompt,
      model,
      cwd: this.workingDir,
      env: this.cleanEnv,
      maxTurns: 25,
      effort: validEffort,
      abortSignal: abortController.signal,
    };

    try {
      let buffer = "";

      for await (const event of provider.query(providerOpts)) {
        if (abortController.signal.aborted) break;

        switch (event.type) {
          case "text_delta":
            buffer += event.text;
            callbacks.onStreamChunk(event.text);
            break;

          case "status":
            callbacks.onStatusUpdate(event.status);
            break;

          case "result":
            if (event.subtype === "success") {
              const usage = {
                inputTokens: event.usage.inputTokens,
                outputTokens: event.usage.outputTokens,
                cacheCreationTokens: 0,
                cacheReadTokens: 0,
              };
              const prev = this.sessionTokens.get(chatId) || {
                inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0,
              };
              this.sessionTokens.set(chatId, {
                inputTokens: prev.inputTokens + usage.inputTokens,
                outputTokens: prev.outputTokens + usage.outputTokens,
                cacheCreationTokens: prev.cacheCreationTokens + usage.cacheCreationTokens,
                cacheReadTokens: prev.cacheReadTokens + usage.cacheReadTokens,
              });
              this.saveState();

              const queryCost = costTracker.track(
                chatId, model,
                usage.inputTokens, usage.outputTokens,
                usage.cacheCreationTokens, usage.cacheReadTokens,
              );
              if (queryCost) this.lastQueryCosts.set(chatId, queryCost);

              callbacks.onResult({
                text: buffer || event.text,
                usage,
                turns: event.turns,
                durationMs: event.durationMs,
              });
            } else {
              callbacks.onError(new Error(event.errors?.join(", ") || "Provider query failed"));
            }
            return;

          case "error":
            callbacks.onError(new Error(event.message));
            return;
        }
      }
    } catch (err) {
      if (!abortController.signal.aborted) {
        callbacks.onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }
}

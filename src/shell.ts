/**
 * Shell command execution with history persistence.
 * The "!" escape hatch — runs commands directly without touching Claude.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { config } from "./config.js";

const MAX_OUTPUT_BYTES = 100_000; // Buffer max
const DISPLAY_MAX = 10_000;       // Trimmed for Telegram
const TIMEOUT_MS = 120_000;
const MAX_HISTORY = 100;

interface HistoryEntry {
  command: string;
  cwd: string;
  ts: string;
  elapsedMs: number;
}

export class ShellManager {
  private botId: number;
  private history: HistoryEntry[] = [];
  private historyFile: string;

  constructor(botId: number) {
    this.botId = botId;
    this.historyFile = path.join(config.DATA_DIR, `shell_history-${botId}.json`);
    this._loadHistory();
  }

  /** Run a shell command and capture output. Returns trimmed result. */
  run(command: string, cwd: string): { output: string; elapsedMs: number; error: string | null } {
    const start = Date.now();
    try {
      const shell = process.platform === "win32" ? "powershell.exe" : "/bin/bash";
      const output = execSync(command, {
        cwd,
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        encoding: "utf-8",
        shell,
        windowsHide: true,
      });

      const elapsed = Date.now() - start;
      const trimmed = this._trim(output);
      this._addToHistory(command, cwd, elapsed);
      return { output: trimmed, elapsedMs: elapsed, error: null };
    } catch (err) {
      const elapsed = Date.now() - start;
      const e = err as { stdout?: string; stderr?: string; message: string; status?: number };
      const output = [e.stdout, e.stderr].filter(Boolean).join("\n") || e.message;
      const trimmed = this._trim(output);
      this._addToHistory(command, cwd, elapsed);
      return { output: trimmed, elapsedMs: elapsed, error: `exit ${e.status ?? 1}: ${e.message.slice(0, 100)}` };
    }
  }

  /** Get recent history (last N entries) */
  getHistory(limit = 10): HistoryEntry[] {
    return this.history.slice(-limit);
  }

  /** Format history for display */
  formatHistory(): string {
    const entries = this.getHistory(10);
    if (entries.length === 0) return "No shell command history.";
    return entries.map((e, i) => {
      const n = this.history.length - entries.length + i + 1;
      const time = new Date(e.ts).toLocaleTimeString("en-GB", { hour12: false });
      return `[${n}] ${time}  ${(e.elapsedMs / 1000).toFixed(1)}s  ${e.command}`;
    }).join("\n");
  }

  private _trim(output: string): string {
    if (output.length <= DISPLAY_MAX) return output;
    return output.slice(0, DISPLAY_MAX) + `\n\n... (truncated, full: ${(output.length / 1024).toFixed(1)} KB)`;
  }

  private _addToHistory(command: string, cwd: string, elapsedMs: number): void {
    this.history.push({
      command,
      cwd,
      ts: new Date().toISOString(),
      elapsedMs,
    });
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(-MAX_HISTORY);
    }
    this._saveHistory();
  }

  private _loadHistory(): void {
    try {
      if (fs.existsSync(this.historyFile)) {
        this.history = JSON.parse(fs.readFileSync(this.historyFile, "utf-8"));
      }
    } catch {}
  }

  private _saveHistory(): void {
    try {
      fs.mkdirSync(config.DATA_DIR, { recursive: true, mode: 0o700 });
      fs.writeFileSync(this.historyFile, JSON.stringify(this.history, null, 2), { mode: 0o600 });
    } catch {}
  }
}

/** Per-bot shell manager cache */
const managers = new Map<number, ShellManager>();

export function getShellManager(botId: number): ShellManager {
  let m = managers.get(botId);
  if (!m) {
    m = new ShellManager(botId);
    managers.set(botId, m);
  }
  return m;
}

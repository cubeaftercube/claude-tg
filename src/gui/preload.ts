/**
 * claude-tg GUI — Preload script.
 * Securely exposes IPC methods to the renderer via contextBridge.
 */
import { contextBridge, ipcRenderer } from "electron";

export interface BotInfo {
  id: number;
  token: string;
  username: string;
  workingDir: string;
  status: string;
  model: string;
}

export interface LogEntry {
  ts: string;
  bot: string;
  level: string;
  message: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
}

contextBridge.exposeInMainWorld("claudeTGAPI", {
  // Bots
  getBots: (): Promise<BotInfo[]> => ipcRenderer.invoke("gui:get-bots"),
  addBot: (token: string, workingDir: string): Promise<BotInfo> =>
    ipcRenderer.invoke("gui:add-bot", { token, workingDir }),
  removeBot: (botId: number): Promise<void> =>
    ipcRenderer.invoke("gui:remove-bot", { botId }),

  // Logs
  getLogs: (lines?: number): Promise<LogEntry[]> =>
    ipcRenderer.invoke("gui:get-logs", { lines }),
  onLogLine: (callback: (entry: LogEntry) => void) => {
    const handler = (_event: unknown, entry: LogEntry) => callback(entry);
    ipcRenderer.on("gui:log-line", handler);
    return () => ipcRenderer.removeListener("gui:log-line", handler);
  },

  // Chat
  sendMessage: (botId: number, chatId: number, prompt: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("gui:send-message", { botId, chatId, prompt }),
  cancelQuery: (botId: number, chatId: number): Promise<boolean> =>
    ipcRenderer.invoke("gui:cancel", { botId, chatId }),
  onStreamChunk: (callback: (data: { chatId: number; text: string }) => void) => {
    const handler = (_event: unknown, data: { chatId: number; text: string }) => callback(data);
    ipcRenderer.on("gui:stream-chunk", handler);
    return () => ipcRenderer.removeListener("gui:stream-chunk", handler);
  },
  onStreamStatus: (callback: (data: { chatId: number; status: string }) => void) => {
    const handler = (_event: unknown, data: { chatId: number; status: string }) => callback(data);
    ipcRenderer.on("gui:stream-status", handler);
    return () => ipcRenderer.removeListener("gui:stream-status", handler);
  },
  onStreamDone: (callback: (data: { chatId: number; result: unknown }) => void) => {
    const handler = (_event: unknown, data: { chatId: number; result: unknown }) => callback(data);
    ipcRenderer.on("gui:stream-done", handler);
    return () => ipcRenderer.removeListener("gui:stream-done", handler);
  },
  onStreamError: (callback: (data: { chatId: number; error: string }) => void) => {
    const handler = (_event: unknown, data: { chatId: number; error: string }) => callback(data);
    ipcRenderer.on("gui:stream-error", handler);
    return () => ipcRenderer.removeListener("gui:stream-error", handler);
  },
  onToolApproval: (callback: (data: { chatId: number; requestId: string; toolName: string; input: unknown }) => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data as { chatId: number; requestId: string; toolName: string; input: unknown });
    ipcRenderer.on("gui:tool-approval", handler);
    return () => ipcRenderer.removeListener("gui:tool-approval", handler);
  },

  // Status
  onBotStatusChange: (callback: (data: { botId: number; status: string }) => void) => {
    const handler = (_event: unknown, data: { botId: number; status: string }) => callback(data);
    ipcRenderer.on("gui:bot-status-change", handler);
    return () => ipcRenderer.removeListener("gui:bot-status-change", handler);
  },
  onTokenUpdate: (callback: (data: { botId: number; usage: TokenUsage }) => void) => {
    const handler = (_event: unknown, data: { botId: number; usage: TokenUsage }) => callback(data);
    ipcRenderer.on("gui:token-update", handler);
    return () => ipcRenderer.removeListener("gui:token-update", handler);
  },

  // Settings
  setEffort: (botId: number, chatId: number, effort: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("gui:set-effort", { botId, chatId, effort }),
  getEffort: (botId: number, chatId: number): Promise<string> =>
    ipcRenderer.invoke("gui:get-effort", { botId, chatId }),
  setMode: (botId: number, chatId: number, mode: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("gui:set-mode", { botId, chatId, mode }),
  getMode: (botId: number, chatId: number): Promise<string> =>
    ipcRenderer.invoke("gui:get-mode", { botId, chatId }),
  setModel: (botId: number, chatId: number, model: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("gui:set-model", { botId, chatId, model }),

  // Usage
  getUsage: (botId: number): Promise<TokenUsage> =>
    ipcRenderer.invoke("gui:get-usage", { botId }),

  // Schedules
  getSchedules: (): Promise<unknown[]> =>
    ipcRenderer.invoke("gui:get-schedules"),

  // Config
  getConfig: (): Promise<{ botToken: string; ownerId: string; ngrokToken: string }> =>
    ipcRenderer.invoke("gui:get-config"),
  saveConfig: (key: string, value: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("gui:save-config", { key, value }),

  // Providers
  getProviders: (): Promise<Array<{ id: string; label: string; models: Array<{ id: string; label: string }> }>> =>
    ipcRenderer.invoke("gui:get-providers"),
  setProvider: (botId: number, chatId: number, providerId: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("gui:set-provider", { botId, chatId, providerId }),
  getProvider: (botId: number, chatId: number): Promise<string> =>
    ipcRenderer.invoke("gui:get-provider", { botId, chatId }),
  setDeepseekKey: (key: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("gui:set-deepseek-key", { key }),

  // Shell
  runShell: (botId: number, command: string, cwd: string): Promise<{ output: string; elapsedMs: number; error: string | null }> =>
    ipcRenderer.invoke("gui:run-shell", { botId, command, cwd }),
  shellHistory: (botId: number): Promise<Array<{ command: string; cwd: string; ts: string; elapsedMs: number }>> =>
    ipcRenderer.invoke("gui:shell-history", { botId }),
});

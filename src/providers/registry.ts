/**
 * Provider registry — manages available AI providers.
 * Supports Claude (built-in via Agent SDK) and Deepseek (API key required).
 */
import fs from "node:fs";
import path from "node:path";
import type { AIProvider, ModelInfo } from "./types.js";
import { DeepseekProvider } from "./deepseek.js";
import { config } from "../config.js";

const CLAUDE_MODELS: ModelInfo[] = [
  { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { id: "claude-fable-5", label: "Claude Fable 5" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
];

export class ProviderRegistry {
  private providers = new Map<string, AIProvider>();
  private defaultProviderId = "claude";

  constructor() {
    // Claude is always available (uses existing Agent SDK)
    this.providers.set("claude", {
      id: "claude",
      label: "Claude (Agent SDK)",
      models: CLAUDE_MODELS,
      query: async function* () {
        throw new Error("Claude provider uses Agent SDK directly — not via query()");
      },
      validateAuth: async () => true, // Claude uses CLI auth, always available
    } as AIProvider);

    // Deepseek — optional, requires API key
    const dsKey = this.loadDeepseekKey();
    if (dsKey) {
      this.providers.set("deepseek", new DeepseekProvider(dsKey));
    }
  }

  get(id: string): AIProvider | undefined {
    return this.providers.get(id);
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  getAll(): AIProvider[] {
    return [...this.providers.values()];
  }

  getDefault(): string {
    return this.defaultProviderId;
  }

  getAllModels(): ModelInfo[] {
    const models: ModelInfo[] = [];
    for (const [, p] of this.providers) {
      models.push(...p.models);
    }
    return models;
  }

  /** Enable Deepseek provider with an API key */
  enableDeepseek(apiKey: string): void {
    const ds = new DeepseekProvider(apiKey);
    this.providers.set("deepseek", ds);
    this.saveDeepseekKey(apiKey);
  }

  /** Disable Deepseek provider */
  disableDeepseek(): void {
    this.providers.delete("deepseek");
    this.saveDeepseekKey("");
  }

  private loadDeepseekKey(): string {
    try {
      const cfgPath = path.join(config.DATA_DIR, "config.json");
      if (fs.existsSync(cfgPath)) {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
        return cfg.DEEPSEEK_API_KEY || "";
      }
    } catch {}
    return "";
  }

  private saveDeepseekKey(key: string): void {
    try {
      const cfgPath = path.join(config.DATA_DIR, "config.json");
      let cfg: Record<string, unknown> = {};
      if (fs.existsSync(cfgPath)) {
        cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
      }
      if (key) {
        cfg.DEEPSEEK_API_KEY = key;
      } else {
        delete cfg.DEEPSEEK_API_KEY;
      }
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    } catch {}
  }
}

/** Global singleton */
export const providerRegistry = new ProviderRegistry();

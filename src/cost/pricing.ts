/**
 * Model pricing tables вЂ” default USD prices per million tokens.
 * Supports custom overrides persisted to ~/.claude-tg/pricing.json.
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

export interface ModelPricing {
  modelId: string;
  label: string;
  inputPerMTok: number;      // USD per 1M input tokens
  outputPerMTok: number;     // USD per 1M output tokens
  cacheWritePerMTok: number; // USD per 1M cache write tokens
  cacheHitPerMTok: number;   // USD per 1M cache read tokens
}

// в”Ђв”Ђ Default pricing (from info.txt, July 2026) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

const DEFAULTS: Record<string, Omit<ModelPricing, "modelId">> = {
  // Claude models
  "claude-opus-4-8": {
    label: "Claude Opus 4.8",
    inputPerMTok: 5.00,
    outputPerMTok: 25.00,
    cacheWritePerMTok: 6.25,
    cacheHitPerMTok: 0.50,
  },
  "claude-opus-4-7": {
    label: "Claude Opus 4.7",
    inputPerMTok: 5.00,
    outputPerMTok: 25.00,
    cacheWritePerMTok: 6.25,
    cacheHitPerMTok: 0.50,
  },
  "claude-sonnet-5": {
    label: "Claude Sonnet 5",
    inputPerMTok: 2.00,
    outputPerMTok: 10.00,
    cacheWritePerMTok: 2.50,
    cacheHitPerMTok: 0.20,
  },
  "claude-fable-5": {
    label: "Claude Fable 5",
    inputPerMTok: 10.00,
    outputPerMTok: 50.00,
    cacheWritePerMTok: 12.50,
    cacheHitPerMTok: 1.00,
  },
  "claude-haiku-4-5-20251001": {
    label: "Claude Haiku 4.5",
    inputPerMTok: 1.00,
    outputPerMTok: 5.00,
    cacheWritePerMTok: 1.25,
    cacheHitPerMTok: 0.10,
  },
  // Deepseek models
  "deepseek-v4-pro": {
    label: "DeepSeek V4 Pro",
    inputPerMTok: 0.435,
    outputPerMTok: 0.87,
    cacheWritePerMTok: 0,
    cacheHitPerMTok: 0.003625,
  },
  "deepseek-v4-flash": {
    label: "DeepSeek V4 Flash",
    inputPerMTok: 0.14,
    outputPerMTok: 0.28,
    cacheWritePerMTok: 0,
    cacheHitPerMTok: 0.0028,
  },
  "deepseek-chat": {
    label: "DeepSeek Chat (V3)",
    inputPerMTok: 0.14,
    outputPerMTok: 0.28,
    cacheWritePerMTok: 0,
    cacheHitPerMTok: 0.0028,
  },
};

// в”Ђв”Ђ Custom pricing persistence в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

const PRICING_FILE = path.join(config.DATA_DIR, "pricing.json");

function loadCustomPricing(): Record<string, Partial<Omit<ModelPricing, "modelId">>> {
  try {
    if (fs.existsSync(PRICING_FILE)) {
      return JSON.parse(fs.readFileSync(PRICING_FILE, "utf-8"));
    }
  } catch {}
  return {};
}

export function saveCustomPricing(data: Record<string, Partial<Omit<ModelPricing, "modelId">>>): void {
  try {
    fs.mkdirSync(config.DATA_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(PRICING_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  } catch {}
}

// в”Ђв”Ђ Public API в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

export function getPricing(modelId: string): ModelPricing | undefined {
  const base = DEFAULTS[modelId];
  if (!base) return undefined;

  const customs = loadCustomPricing();
  const overrides = customs[modelId] || {};

  return {
    modelId,
    label: base.label,
    inputPerMTok: overrides.inputPerMTok ?? base.inputPerMTok,
    outputPerMTok: overrides.outputPerMTok ?? base.outputPerMTok,
    cacheWritePerMTok: overrides.cacheWritePerMTok ?? base.cacheWritePerMTok,
    cacheHitPerMTok: overrides.cacheHitPerMTok ?? base.cacheHitPerMTok,
  };
}

export function getAllPricing(): ModelPricing[] {
  return Object.keys(DEFAULTS).map((id) => getPricing(id)!);
}

export function getDefaultPricing(modelId: string): Omit<ModelPricing, "modelId"> | undefined {
  return DEFAULTS[modelId];
}

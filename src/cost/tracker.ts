/**
 * Cost calculator вЂ” converts token usage into monetary cost.
 * Uses ModelPricing for rates and CurrencyConverter for display currency.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getPricing, type ModelPricing } from "./pricing.js";
import { convert, formatCost, ensureRates, getCurrencySymbol, type CurrencyRates } from "./currency.js";

export interface CostBreakdown {
  inputCost: number;       // USD
  outputCost: number;      // USD
  cacheWriteCost: number;  // USD
  cacheHitCost: number;    // USD
  totalCostUsd: number;    // USD
  currency: string;
  totalCostFormatted: string;
}

// Per-session accumulated costs
export class CostTracker {
  private sessionCosts = new Map<number, CostBreakdown>();
  private currency = "USD";
  private rates: CurrencyRates | null = null;

  async init(): Promise<void> {
    this.rates = await ensureRates();
    // Restore saved currency
    try {
      const cfgPath = path.join(os.homedir(), ".claude-tg", "config.json");
      if (fs.existsSync(cfgPath)) {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
        if (cfg.COST_CURRENCY) this.currency = cfg.COST_CURRENCY;
      }
    } catch {}
  }

  setCurrency(code: string): void {
    this.currency = code;
    // Persist to config
    try {
      const cfgPath = path.join(os.homedir(), ".claude-tg", "config.json");
      let cfg: Record<string, unknown> = {};
      if (fs.existsSync(cfgPath)) {
        cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
      }
      cfg.COST_CURRENCY = code;
      fs.mkdirSync(path.dirname(cfgPath), { recursive: true, mode: 0o700 });
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    } catch {}
  }

  getCurrency(): string {
    return this.currency;
  }

  /**
   * Calculate cost for a single query and accumulate into session.
   * Returns the formatted cost string for the result summary line.
   */
  track(
    chatId: number,
    modelId: string,
    inputTokens: number,
    outputTokens: number,
    cacheCreationTokens: number,
    cacheReadTokens: number,
  ): string {
    const pricing = getPricing(modelId);
    if (!pricing) {
      // Unknown model вЂ” return empty cost string
      return "";
    }

    const queryCost = this._calculate(pricing, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens);

    // Accumulate into session
    const prev = this.sessionCosts.get(chatId) || this._zeroBreakdown();
    this.sessionCosts.set(chatId, {
      inputCost: prev.inputCost + queryCost.inputCost,
      outputCost: prev.outputCost + queryCost.outputCost,
      cacheWriteCost: prev.cacheWriteCost + queryCost.cacheWriteCost,
      cacheHitCost: prev.cacheHitCost + queryCost.cacheHitCost,
      totalCostUsd: prev.totalCostUsd + queryCost.totalCostUsd,
      currency: this.currency,
      totalCostFormatted: "",
    });

    // Format the per-query cost
    const converted = convert(queryCost.totalCostUsd, this.currency, this.rates || undefined);
    if (converted < 0.01) {
      return `${getCurrencySymbol(this.currency)}${converted.toFixed(4)}`;
    }
    return `${getCurrencySymbol(this.currency)}${converted.toFixed(2)}`;
  }

  getSessionCost(chatId: number): CostBreakdown {
    const cost = this.sessionCosts.get(chatId) || this._zeroBreakdown();
    const converted = convert(cost.totalCostUsd, this.currency, this.rates || undefined);
    return {
      ...cost,
      currency: this.currency,
      totalCostFormatted: formatCost(converted, this.currency),
    };
  }

  getFormattedSessionCost(chatId: number): string {
    const cost = this.getSessionCost(chatId);
    return cost.totalCostFormatted;
  }

  clearSession(chatId: number): void {
    this.sessionCosts.delete(chatId);
  }

  private _calculate(
    pricing: ModelPricing,
    inputTokens: number,
    outputTokens: number,
    cacheCreationTokens: number,
    cacheReadTokens: number,
  ): Omit<CostBreakdown, "currency" | "totalCostFormatted"> {
    const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMTok;
    const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMTok;
    const cacheWriteCost = (cacheCreationTokens / 1_000_000) * pricing.cacheWritePerMTok;
    const cacheHitCost = (cacheReadTokens / 1_000_000) * pricing.cacheHitPerMTok;
    const totalCostUsd = inputCost + outputCost + cacheWriteCost + cacheHitCost;

    return { inputCost, outputCost, cacheWriteCost, cacheHitCost, totalCostUsd };
  }

  private _zeroBreakdown(): CostBreakdown {
    return {
      inputCost: 0, outputCost: 0, cacheWriteCost: 0, cacheHitCost: 0,
      totalCostUsd: 0, currency: this.currency, totalCostFormatted: formatCost(0, this.currency),
    };
  }
}

/** Global singleton for the cost tracker */
export const costTracker = new CostTracker();

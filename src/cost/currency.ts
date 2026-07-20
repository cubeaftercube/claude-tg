/**
 * Currency conversion вЂ” fetches rates from frankfurter.dev API.
 * Caches rates for 24 hours in ~/.claude-tg/currency.json.
 * Re-fetches only on app launch or when a new currency is added.
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

export interface CurrencyRates {
  base: string;
  rates: Record<string, number>;
  fetchedAt: number; // Unix ms
}

const RATES_FILE = path.join(config.DATA_DIR, "currency.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FRANKFURTER_URL = "https://api.frankfurter.dev/v2/rates";

// Popular currencies we always fetch
const DEFAULT_QUOTES = ["USD", "EUR", "RUB", "GBP", "JPY", "CNY", "INR", "BRL", "CAD", "AUD"];

// в”Ђв”Ђ Persistence в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

function loadCached(): CurrencyRates | null {
  try {
    if (!fs.existsSync(RATES_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(RATES_FILE, "utf-8")) as CurrencyRates;
    if (Date.now() - raw.fetchedAt > CACHE_TTL_MS) return null;
    return raw;
  } catch {
    return null;
  }
}

function saveCache(rates: CurrencyRates): void {
  try {
    fs.mkdirSync(config.DATA_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(RATES_FILE, JSON.stringify(rates, null, 2), { mode: 0o600 });
  } catch {}
}

// в”Ђв”Ђ Custom rate overrides в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

const CUSTOM_RATES_FILE = path.join(config.DATA_DIR, "custom-rates.json");

export function loadCustomRates(): Record<string, number> {
  try {
    if (fs.existsSync(CUSTOM_RATES_FILE)) {
      return JSON.parse(fs.readFileSync(CUSTOM_RATES_FILE, "utf-8"));
    }
  } catch {}
  return {};
}

export function saveCustomRates(rates: Record<string, number>): void {
  try {
    fs.mkdirSync(config.DATA_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(CUSTOM_RATES_FILE, JSON.stringify(rates, null, 2), { mode: 0o600 });
  } catch {}
}

// в”Ђв”Ђ Fetching в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

let cachedRates: CurrencyRates | null = null;

export async function ensureRates(additionalCurrencies: string[] = []): Promise<CurrencyRates> {
  // Check memory cache first
  if (cachedRates && Date.now() - cachedRates.fetchedAt < CACHE_TTL_MS) {
    // Check if all requested currencies are in cache
    const missing = additionalCurrencies.filter((c) => !(c in cachedRates!.rates) && c !== cachedRates!.base);
    if (missing.length === 0) return cachedRates;
  }

  // Check disk cache
  const disk = loadCached();
  if (disk && Date.now() - disk.fetchedAt < CACHE_TTL_MS) {
    const missing = additionalCurrencies.filter((c) => !(c in disk.rates) && c !== disk.base);
    if (missing.length === 0) {
      cachedRates = disk;
      return disk;
    }
  }

  // Fetch fresh rates
  const allQuotes = [...new Set([...DEFAULT_QUOTES, ...additionalCurrencies])];
  const quotesParam = allQuotes.join(",");

  try {
    const res = await fetch(`${FRANKFURTER_URL}?quotes=${quotesParam}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = (await res.json()) as Array<{ date: string; base: string; quote: string; rate: number }>;

    // Transform from array format to CurrencyRates format
    const rates: Record<string, number> = {};
    for (const entry of data) {
      rates[entry.quote] = entry.rate;
    }
    // EUR base rate is always 1
    rates["EUR"] = 1;

    const result: CurrencyRates = {
      base: "EUR",
      rates,
      fetchedAt: Date.now(),
    };

    // Merge custom overrides on top
    const customs = loadCustomRates();
    for (const [code, customRate] of Object.entries(customs)) {
      result.rates[code] = customRate;
    }

    cachedRates = result;
    saveCache(result);
    return result;
  } catch (err) {
    // Fall back to cached rates if fetch fails
    if (disk) {
      console.warn(`[currency] Fetch failed, using cached rates: ${(err as Error).message}`);
      cachedRates = disk;
      return disk;
    }
    // Last resort: hardcoded fallback rates
    const fallback: CurrencyRates = {
      base: "EUR",
      rates: { EUR: 1, USD: 1.1456, RUB: 89.47 },
      fetchedAt: 0,
    };
    cachedRates = fallback;
    return fallback;
  }
}

// в”Ђв”Ђ Conversion в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

/**
 * Convert a USD amount to the target currency.
 * frankfurter gives EUR-based rates, so:
 *   USD в†’ EUR = usdAmount / eurToUsd
 *   EUR в†’ target = eurAmount * targetRate
 */
export function convert(usdAmount: number, toCurrency: string, rates?: CurrencyRates): number {
  if (toCurrency === "USD") return usdAmount;

  const r = rates || cachedRates;
  if (!r) return usdAmount; // No rates loaded, return USD

  const eurToUsd = r.rates["USD"] || 1;
  const eurAmount = usdAmount / eurToUsd;

  if (toCurrency === "EUR") return eurAmount;

  const targetRate = r.rates[toCurrency];
  if (!targetRate) return usdAmount; // Unknown currency, return USD

  return eurAmount * targetRate;
}

export function getCurrencySymbol(code: string): string {
  const symbols: Record<string, string> = {
    USD: "$", EUR: "€", RUB: "₽", GBP: "£", JPY: "¥",
    CNY: "¥", INR: "₹", BRL: "R$", CAD: "C$", AUD: "A$",
  };
  return symbols[code] || code;
}

export function formatCost(amount: number, currency: string): string {
  if (amount < 0.01) {
    return `${getCurrencySymbol(currency)}${amount.toFixed(4)} ${currency}`;
  }
  return `${getCurrencySymbol(currency)}${amount.toFixed(2)} ${currency}`;
}

/** Get list of available currency codes */
export function getAvailableCurrencies(): string[] {
  const rates = cachedRates;
  if (!rates) return [...DEFAULT_QUOTES];
  return Object.keys(rates.rates).filter((k) => k.length === 3 && k === k.toUpperCase());
}

/** Initialize rates on startup вЂ” call once from daemon/gui main */
export async function initCurrency(): Promise<void> {
  await ensureRates();
}

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "cost-test-"));
const origHome = process.env.HOME;
process.env.HOME = tmpHome;
process.env.TELEGRAM_BOT_TOKEN = "123456:ABC-DEF";
process.env.TELEGRAM_OWNER_ID = "999";

const { getPricing, getAllPricing, saveCustomPricing } = await import("../src/cost/pricing.js");
const { convert, formatCost, getCurrencySymbol } = await import("../src/cost/currency.js");

after(() => {
  process.env.HOME = origHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("Pricing", () => {
  it("returns pricing for known models", () => {
    const p = getPricing("claude-opus-4-8");
    assert.ok(p);
    assert.equal(p!.inputPerMTok, 5.00);
    assert.equal(p!.outputPerMTok, 25.00);
    assert.equal(p!.cacheHitPerMTok, 0.50);
  });

  it("returns pricing for Deepseek models", () => {
    const p = getPricing("deepseek-v4-pro");
    assert.ok(p);
    assert.equal(p!.inputPerMTok, 0.435);
    assert.equal(p!.outputPerMTok, 0.87);
  });

  it("returns undefined for unknown models", () => {
    assert.equal(getPricing("nonexistent-model"), undefined);
  });

  it("returns all pricing entries", () => {
    const all = getAllPricing();
    assert.ok(all.length >= 6);
    assert.ok(all.some((p) => p.modelId === "claude-fable-5"));
    assert.ok(all.some((p) => p.modelId === "deepseek-v4-flash"));
  });

  it("supports custom pricing overrides", () => {
    saveCustomPricing({
      "claude-opus-4-8": { inputPerMTok: 3.00, outputPerMTok: 15.00 },
    });
    const p = getPricing("claude-opus-4-8");
    assert.equal(p!.inputPerMTok, 3.00);
    assert.equal(p!.outputPerMTok, 15.00);
    // Non-overridden fields keep defaults
    assert.equal(p!.cacheHitPerMTok, 0.50);
    // Clean up
    saveCustomPricing({});
  });
});

describe("Currency", () => {
  it("converts USD to itself", () => {
    assert.equal(convert(10, "USD"), 10);
  });

  it("formats costs with symbols", () => {
    assert.ok(formatCost(5.50, "USD").includes("$5.50"));
    assert.ok(formatCost(0.001, "USD").includes("0.0010"));
  });

  it("returns symbols for known currencies", () => {
    assert.equal(getCurrencySymbol("USD"), "$");
    assert.equal(getCurrencySymbol("EUR"), "€");
    assert.equal(getCurrencySymbol("RUB"), "₽");
    assert.equal(getCurrencySymbol("GBP"), "£");
  });

  it("returns code for unknown currencies", () => {
    assert.equal(getCurrencySymbol("XYZ"), "XYZ");
  });
});

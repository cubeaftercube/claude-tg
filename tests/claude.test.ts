import { describe, it, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Create a temp HOME so config.DATA_DIR resolves to an isolated directory
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "claude-test-"));
const origHome = process.env.HOME;
process.env.HOME = tmpHome;
process.env.TELEGRAM_BOT_TOKEN = "123456:ABC-DEF";
process.env.TELEGRAM_OWNER_ID = "999";

const { ClaudeBridge, AVAILABLE_MODELS } = await import("../src/claude.js");
const { config } = await import("../src/config.js");

after(() => {
  process.env.HOME = origHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function createBridge(botId = 1, workingDir = "/tmp/test-project"): ClaudeBridge {
  return new ClaudeBridge(botId, workingDir, "testbot");
}

describe("ClaudeBridge", () => {
  let bridge: ClaudeBridge;

  beforeEach(() => {
    bridge = createBridge();
  });

  afterEach(() => {
    bridge.abortAll();
  });

  describe("model management", () => {
    it("returns default model for new chats", () => {
      assert.equal(bridge.getModel(123), AVAILABLE_MODELS[0].id);
    });

    it("persists model selection across sessions", () => {
      bridge.setModel(456, "claude-sonnet-5");
      assert.equal(bridge.getModel(456), "claude-sonnet-5");

      // Simulate restart: create new bridge, state should persist from file
      const bridge2 = createBridge();
      assert.equal(bridge2.getModel(456), "claude-sonnet-5");
      bridge2.abortAll();
    });

    it("clears session when model is changed", () => {
      bridge.setSessionId(789, "test-session-id");
      bridge.setModel(789, "claude-haiku-4-5-20251001");
      assert.equal(bridge.getSessionId(789), undefined);
    });

    it("AVAILABLE_MODELS includes all expected models", () => {
      const ids = AVAILABLE_MODELS.map((m) => m.id);
      assert.ok(ids.includes("claude-opus-4-8"), "Opus 4.8 missing");
      assert.ok(ids.includes("claude-sonnet-5"), "Sonnet 5 missing");
      assert.ok(ids.includes("claude-fable-5"), "Fable 5 missing");
      assert.ok(ids.includes("claude-haiku-4-5-20251001"), "Haiku 4.5 missing");
    });
  });

  describe("processing lock", () => {
    it("tryStartProcessing acquires lock", () => {
      assert.equal(bridge.tryStartProcessing(100), true);
      assert.equal(bridge.isProcessing(100), true);
    });

    it("tryStartProcessing fails when already locked", () => {
      assert.equal(bridge.tryStartProcessing(200), true);
      assert.equal(bridge.tryStartProcessing(200), false);
    });

    it("releaseProcessing frees the lock", () => {
      bridge.tryStartProcessing(300);
      // Access private method via any cast for testing
      (bridge as unknown as { releaseProcessing(id: number): void }).releaseProcessing(300);
      assert.equal(bridge.isProcessing(300), false);
    });
  });

  describe("yolo mode", () => {
    it("starts disabled", () => {
      assert.equal(bridge.isYolo(111), false);
    });

    it("enables and disables yolo", () => {
      bridge.setYolo(111, true);
      assert.equal(bridge.isYolo(111), true);
      bridge.setYolo(111, false);
      assert.equal(bridge.isYolo(111), false);
    });

    it("persists yolo across restarts", () => {
      bridge.setYolo(222, true);

      const bridge2 = createBridge();
      assert.equal(bridge2.isYolo(222), true);
      bridge2.abortAll();
    });
  });

  describe("session tokens", () => {
    it("starts at zero", () => {
      const tokens = bridge.getSessionTokens(333);
      assert.equal(tokens.inputTokens, 0);
      assert.equal(tokens.outputTokens, 0);
    });

    it("clears on session reset", () => {
      bridge.clearSession(333);
      const tokens = bridge.getSessionTokens(333);
      assert.equal(tokens.inputTokens, 0);
    });
  });

  describe("cancel query", () => {
    it("cancelQuery sets cancelRequested flag", () => {
      bridge.tryStartProcessing(400);
      bridge.cancelQuery(400);
      assert.equal(bridge.isCancelRequested(400), true);
    });

    it("cancelQuery returns false when nothing to cancel", () => {
      assert.equal(bridge.cancelQuery(999), false);
    });
  });

  describe("last prompt", () => {
    it("stores and retrieves last prompt", () => {
      bridge.setLastPrompt(500, "hello world");
      assert.equal(bridge.getLastPrompt(500), "hello world");
    });

    it("returns undefined for unknown chat", () => {
      assert.equal(bridge.getLastPrompt(999), undefined);
    });
  });

  describe("clear session", () => {
    it("clears all state for a chat", () => {
      bridge.setYolo(600, true);
      bridge.setSessionId(600, "some-session");
      bridge.clearSession(600);

      assert.equal(bridge.isYolo(600), false);
      assert.equal(bridge.getSessionId(600), undefined);
    });
  });

  describe("temp directory", () => {
    it("returns unique temp dir per bot", () => {
      const dir = bridge.getTempDir();
      assert.ok(dir.includes("claude-tg-1"));
    });
  });
});

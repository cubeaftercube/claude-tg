import { describe, it, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Create a temp HOME so config.DATA_DIR resolves to an isolated directory
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "sched-test-"));
const origHome = process.env.HOME;
process.env.HOME = tmpHome;
process.env.TELEGRAM_BOT_TOKEN = "123456:ABC-DEF";
process.env.TELEGRAM_OWNER_ID = "999";

const { generateScheduleId, loadSchedules } = await import("../src/scheduler.js");
import type { Schedule } from "../src/scheduler.js";
import { DATA_DIR } from "../src/config.js";

const SCHEDULES_FILE = path.join(DATA_DIR, "schedules.json");

function saveSchedules(schedules: Schedule[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2), { mode: 0o600 });
}

after(() => {
  process.env.HOME = origHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function cleanup() {
  try { fs.unlinkSync(SCHEDULES_FILE); } catch {}
}

function createTestSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: generateScheduleId(),
    botId: 1,
    chatId: 123,
    prompt: "Run tests",
    cronExpr: "0 9 * * *",
    humanLabel: "daily 9am",
    createdAt: new Date().toISOString(),
    lastRunAt: null,
    ...overrides,
  };
}

describe("Schedule data layer", () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  describe("generateScheduleId", () => {
    it("generates unique IDs", () => {
      const id1 = generateScheduleId();
      const id2 = generateScheduleId();
      assert.notEqual(id1, id2);
    });

    it("generates IDs with expected prefix", () => {
      const id = generateScheduleId();
      assert.ok(id.startsWith("sched_"), `Expected sched_ prefix, got: ${id}`);
    });
  });

  describe("CRUD via persistence layer", () => {
    it("starts empty", () => {
      assert.deepEqual(loadSchedules(), []);
    });

    it("adds and retrieves schedule", () => {
      const s = createTestSchedule();
      saveSchedules([s]);
      const all = loadSchedules();
      assert.equal(all.length, 1);
      assert.equal(all[0].id, s.id);
      assert.equal(all[0].prompt, s.prompt);
    });

    it("removes schedule by id", () => {
      const s = createTestSchedule();
      saveSchedules([s]);
      const filtered = loadSchedules().filter((x) => x.id !== s.id);
      saveSchedules(filtered);
      assert.equal(loadSchedules().length, 0);
    });

    it("filters by bot id", () => {
      const s1 = createTestSchedule({ botId: 1 });
      const s2 = createTestSchedule({ botId: 2 });
      saveSchedules([s1, s2]);
      const bot1 = loadSchedules().filter((s) => s.botId === 1);
      const bot2 = loadSchedules().filter((s) => s.botId === 2);
      assert.equal(bot1.length, 1);
      assert.equal(bot2.length, 1);
      assert.equal(loadSchedules().filter((s) => s.botId === 999).length, 0);
    });

    it("removes all for a bot", () => {
      const s1 = createTestSchedule({ botId: 1 });
      const s2 = createTestSchedule({ botId: 1 });
      const s3 = createTestSchedule({ botId: 2 });
      saveSchedules([s1, s2, s3]);
      const filtered = loadSchedules().filter((s) => s.botId !== 1);
      saveSchedules(filtered);
      assert.equal(loadSchedules().length, 1);
      assert.equal(loadSchedules()[0].botId, 2);
    });

    it("replaces schedule with same id", () => {
      const s = createTestSchedule();
      saveSchedules([s]);
      const updated = { ...s, prompt: "Updated task" };
      const filtered = loadSchedules().filter((x) => x.id !== s.id);
      filtered.push(updated);
      saveSchedules(filtered);
      assert.equal(loadSchedules().length, 1);
      assert.equal(loadSchedules()[0].prompt, "Updated task");
    });
  });

  describe("persistence", () => {
    it("persists across reads", () => {
      const s = createTestSchedule();
      saveSchedules([s]);
      // Second read should return same data
      const loaded = loadSchedules();
      assert.equal(loaded.length, 1);
      assert.equal(loaded[0].id, s.id);
      assert.equal(loaded[0].humanLabel, "daily 9am");
    });

    it("handles corrupted file gracefully", () => {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(SCHEDULES_FILE, "not valid json{{{");
      assert.deepEqual(loadSchedules(), []);
    });
  });
});

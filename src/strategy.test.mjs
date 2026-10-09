import assert from "node:assert/strict";
import test from "node:test";
import { currentPhase } from "./model.ts";
import {
  buildStrategyTimeline,
  generateStrategy,
  moveRelay,
  nextPlannedDriverAt,
  plannedDriverAt,
  pitWindowAt,
  resizeRelay,
  scheduleQualifying,
  validateStrategy,
} from "./strategy.ts";

function sampleStrategy(overrides = {}) {
  return {
    durationMinutes: 90,
    minRelays: 3,
    scheduledStartAt: 0,
    qualifyingMinutes: 20,
    qualifyingKarts: 1,
    changeoverMinutes: 2,
    minStintMinutes: 10,
    maxStintMinutes: 45,
    distributionMode: "next",
    qualifyingOrder: ["a", "b", "c"],
    qualifyingDone: [],
    fuelWindows: [],
    relays: [
      { id: "r1", driver: "a", durationMinutes: 30 },
      { id: "r2", driver: "b", durationMinutes: 30 },
      { id: "r3", driver: "c", durationMinutes: 30 },
    ],
    ...overrides,
  };
}

test("resolves an active race even when qualification finish status is missing", () => {
  assert.equal(
    currentPhase({
      phase: "qualifying",
      startAt: 1_000,
      qualificationStartAt: null,
      qualificationFinishAt: null,
    }),
    "race",
  );
  assert.equal(
    currentPhase({
      phase: "race",
      startAt: null,
      qualificationStartAt: 500,
      qualificationFinishAt: null,
    }),
    "qualifying",
  );
});

test("generates minimum relay count and balances driver time", () => {
  const generated = generateStrategy(
    sampleStrategy({ durationMinutes: 100, minRelays: 4, fuelWindows: [
      { id: "f", label: "Fuel", opensAt: 0, closesAt: 1, plannedAt: null, stopMinutes: 10, status: "unplanned" },
    ] }),
    ["a", "b", "c"],
  );
  assert.equal(generated.relays.length, 4);
  assert.equal(generated.relays.reduce((sum, relay) => sum + relay.durationMinutes, 0), 90);
  const driverTotals = ["a", "b", "c"].map((id) =>
    generated.relays.filter((relay) => relay.driver === id).reduce((sum, relay) => sum + relay.durationMinutes, 0),
  );
  assert.ok(Math.max(...driverTotals) - Math.min(...driverTotals) <= 23);
  assert.equal(generated.fuelWindows[0].status, "planned");
});

test("moves a relay without changing its assigned duration", () => {
  const moved = moveRelay(sampleStrategy().relays, 0, 2);
  assert.deepEqual(moved.map((relay) => relay.id), ["r2", "r3", "r1"]);
  assert.deepEqual(moved.map((relay) => relay.durationMinutes), [30, 30, 30]);
});

test("redistributes a resized relay to its immediate successor by default", () => {
  const resized = resizeRelay(sampleStrategy(), 0, 35);
  assert.deepEqual(resized.relays.map((relay) => relay.durationMinutes), [35, 25, 30]);
});

test("distributes a resized relay across later relays when selected", () => {
  const resized = resizeRelay(
    sampleStrategy({ distributionMode: "remaining" }),
    0,
    36,
  );
  assert.deepEqual(resized.relays.map((relay) => relay.durationMinutes), [36, 27, 27]);
  assert.throws(() => resizeRelay(sampleStrategy(), 0, 50), /limites/);
});

test("validates pit windows, minimum relay count, and finish duration", () => {
  const strategy = sampleStrategy({
    minRelays: 4,
    fuelWindows: [
      { id: "f", label: "Plein", opensAt: 10, closesAt: 20, plannedAt: 25, stopMinutes: 5, status: "planned" },
    ],
  });
  const alerts = validateStrategy(strategy);
  assert.ok(alerts.some((alert) => alert.includes("Minimum 4")));
  assert.ok(alerts.some((alert) => alert.includes("heure prévue")));
  assert.ok(alerts.some((alert) => alert.includes("fenêtre")));
  assert.equal(pitWindowAt(strategy.fuelWindows[0], 15).status, "planned");
});

test("schedules parallel qualification passes within the configured window", () => {
  const start = 1_000_000;
  const slots = scheduleQualifying(["a", "b", "c"], 20, 2, start);
  assert.equal(slots[0].startAt, slots[1].startAt);
  assert.equal(slots[2].startAt, start + 10 * 60_000);
  assert.equal(slots[2].endAt, start + 20 * 60_000);
});

test("selects the strategy driver for the active qualification slot or race relay", () => {
  const strategy = sampleStrategy({ qualifyingKarts: 2 });
  assert.equal(plannedDriverAt(strategy, "qualifying", 5 * 60_000, 0, null), "a");
  assert.equal(plannedDriverAt(strategy, "qualifying", 12 * 60_000, 0, null), "c");
  assert.equal(plannedDriverAt(strategy, "race", 35 * 60_000, null, 0), "b");
});

test("anchors strategy pit and relay times at the actual race start", () => {
  const strategy = sampleStrategy({
    fuelWindows: [
      { id: "f", label: "Fuel", opensAt: 15, closesAt: 25, plannedAt: 20, stopMinutes: 5, status: "planned" },
    ],
  });
  const timeline = buildStrategyTimeline(strategy, 1_000_000);
  assert.equal(timeline[0].startAt, 1_000_000);
  assert.ok(timeline.every((item) => item.startAt >= 1_000_000));
});

test("selects the next strategy pilot for qualification and race", () => {
  const strategy = sampleStrategy({ qualifyingKarts: 2 });
  assert.equal(nextPlannedDriverAt(strategy, "qualifying", 5 * 60_000, 0, null), "c");
  assert.equal(nextPlannedDriverAt(strategy, "race", 35 * 60_000, null, 0), "c");
});
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  P2_85_SOAK_DEFAULT_DURATION_MS,
  P2_85_SOAK_DEFAULT_INTERVAL_MS,
  P2_85_SOAK_EVIDENCE_BOUNDARY_SUMMARY,
  createP285SoakScenarioPlan,
  evaluateP285SoakTrend,
  isP285SoakTrendAcceptable,
  normalizeP285ProcessSample,
  resolveP285SoakConfig,
  serializeP285SoakFailure
} from "./p2-85-context-emotion-proactive-soak-real-ui.mjs";

const source = readFileSync("scripts/p2-85-context-emotion-proactive-soak-real-ui.mjs", "utf8");

test("P2-85 soak defaults to twenty continuous minutes and accepts explicit short overrides", () => {
  const defaults = resolveP285SoakConfig({});
  assert.equal(defaults.durationMs, P2_85_SOAK_DEFAULT_DURATION_MS);
  assert.equal(defaults.intervalMs, P2_85_SOAK_DEFAULT_INTERVAL_MS);
  assert.equal(defaults.plannedInvocationCount, 20);
  assert.equal(defaults.qualifiesAsTwentyMinuteSoak, true);
  assert.equal(defaults.runQualification, "twenty_minute_or_longer");

  const shortRun = resolveP285SoakConfig({
    P2_85_SOAK_DURATION_MS: "5000",
    P2_85_SOAK_INTERVAL_MS: "2000"
  });
  assert.equal(shortRun.durationMs, 5000);
  assert.equal(shortRun.intervalMs, 2000);
  assert.equal(shortRun.plannedInvocationCount, 3);
  assert.equal(shortRun.qualifiesAsTwentyMinuteSoak, false);
  assert.equal(shortRun.runQualification, "short_non_qualifying");
});

test("P2-85 soak rejects malformed timing overrides and never lets a short run call itself twenty minutes", () => {
  const config = resolveP285SoakConfig({
    P2_85_SOAK_DURATION_MS: "nope",
    P2_85_SOAK_INTERVAL_MS: "0"
  });
  assert.equal(config.durationMs, P2_85_SOAK_DEFAULT_DURATION_MS);
  assert.equal(config.intervalMs, P2_85_SOAK_DEFAULT_INTERVAL_MS);
  assert.match(source, /completed_short_non_qualifying/u);
  assert.match(source, /qualifiesAsTwentyMinuteSoak/u);
  assert.match(source, /short_non_qualifying/u);
});

test("P2-85 soak trend records process resources without a fixed host-specific memory threshold", () => {
  assert.deepEqual(normalizeP285ProcessSample({
    mainAlive: true,
    cdpAvailable: true,
    processCount: "4",
    workingSetBytes: "100",
    cpuTimeSeconds: "1.5"
  }), {
    mainAlive: true,
    cdpAvailable: true,
    processCount: 4,
    workingSetBytes: 100,
    cpuTimeSeconds: 1.5
  });

  const trend = evaluateP285SoakTrend([
    { mainAlive: true, cdpAvailable: true, processCount: 4, workingSetBytes: 100, cpuTimeSeconds: 1 },
    { mainAlive: true, cdpAvailable: true, processCount: 4, workingSetBytes: 120, cpuTimeSeconds: 2 },
    { mainAlive: true, cdpAvailable: true, processCount: 5, workingSetBytes: 150, cpuTimeSeconds: 3 },
    { mainAlive: true, cdpAvailable: true, processCount: 4, workingSetBytes: 160, cpuTimeSeconds: 4 }
  ]);
  assert.equal(trend.mainAliveThroughout, true);
  assert.equal(trend.cdpAvailableThroughout, true);
  assert.equal(trend.workingSetBytesDelta, 60);
  assert.equal(trend.cpuTimeSecondsDelta, 3);
  assert.equal(trend.processCountStrictlyGrowing, false);
  assert.equal(isP285SoakTrendAcceptable(trend), true);
});

test("P2-85 soak flags lifecycle loss and sustained process growth", () => {
  const unhealthy = evaluateP285SoakTrend([
    { mainAlive: true, cdpAvailable: true, processCount: 1, workingSetBytes: 10, cpuTimeSeconds: 1 },
    { mainAlive: true, cdpAvailable: true, processCount: 2, workingSetBytes: 20, cpuTimeSeconds: 2 },
    { mainAlive: true, cdpAvailable: false, processCount: 3, workingSetBytes: 30, cpuTimeSeconds: 3 },
    { mainAlive: false, cdpAvailable: false, processCount: 4, workingSetBytes: 40, cpuTimeSeconds: 4 }
  ]);
  assert.equal(unhealthy.processCountStrictlyGrowing, true);
  assert.equal(unhealthy.mainAliveThroughout, false);
  assert.equal(unhealthy.cdpAvailableThroughout, false);
  assert.equal(isP285SoakTrendAcceptable(unhealthy), false);
});

test("P2-85 soak resets before every scenario and covers two complete rounds", () => {
  assert.deepEqual(createP285SoakScenarioPlan(8), [
    "chat_opened_replace_active",
    "reply_visible_generic_once",
    "explicit_game_single_presentation",
    "proactive_suppress_single_defer",
    "chat_opened_replace_active",
    "reply_visible_generic_once",
    "explicit_game_single_presentation",
    "proactive_suppress_single_defer"
  ]);
  assert.match(source, /await resetP285AcceptanceBaseline\(pet\);/u);
  assert.match(source, /createP285SoakScenarioPlan\(cycleIndex \+ 1\)/u);
});

test("P2-85 soak keeps primary and cleanup failures distinct", () => {
  assert.deepEqual(serializeP285SoakFailure(new Error("scenario_rejected")), {
    name: "Error",
    message: "scenario_rejected"
  });
  assert.equal(serializeP285SoakFailure(null), null);
  assert.match(source, /let primaryFailure = null;/u);
  assert.match(source, /let cleanupFailure = null;/u);
  assert.match(source, /primaryFailure: error\?\.primaryFailure/u);
  assert.match(source, /cleanupFailure: error\?\.cleanupFailure/u);
});

test("P2-85 soak documents fixture and privacy boundaries and reuses the closed scenario contract", () => {
  assert.match(P2_85_SOAK_EVIDENCE_BOUNDARY_SUMMARY, /single continuous production Electron/u);
  assert.match(P2_85_SOAK_EVIDENCE_BOUNDARY_SUMMARY, /fake acceptance fixtures/u);
  assert.match(P2_85_SOAK_EVIDENCE_BOUNDARY_SUMMARY, /not real OS media\/game, model quality/u);
  assert.match(source, /createP285SoakScenarioPlan\(cycleIndex \+ 1\)/u);
  assert.match(source, /validateScenarioObservation\(scenarioId, observation\.payload, events\)/u);
  assert.match(source, /non_unique_observation/u);
  assert.match(source, /assertNoScreenshotResidue/u);
  assert.match(source, /cleanupP285ProductionContext/u);
  assert.match(source, /waitForP285OwnedProcessExit/u);
  assert.match(source, /ownedProcessTreeExited/u);
  assert.match(source, /isP285CdpPortReleased/u);
  assert.doesNotMatch(source, /AI_DESKTOP_PET_PROVIDER: "local-openai-compatible"/u);
});

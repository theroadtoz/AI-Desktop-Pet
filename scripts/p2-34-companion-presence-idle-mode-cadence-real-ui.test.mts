import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const runnerSource = readFileSync(
  "scripts/p2-34-companion-presence-idle-mode-cadence-real-ui.mjs",
  "utf8"
);

test("P2-34 captures idle telemetry before startup bubble settlement", () => {
  const idleStartIndexPosition = runnerSource.indexOf(
    "const idleStartIndex = lastTelemetryIndex();"
  );
  const startupBubbleWaitPosition = runnerSource.indexOf(
    "await waitForBubbleHidden(signal, pet, 10_000)"
  );

  assert.notEqual(idleStartIndexPosition, -1);
  assert.notEqual(startupBubbleWaitPosition, -1);
  assert.ok(
    idleStartIndexPosition < startupBubbleWaitPosition,
    "idle telemetry must include action-first events that occur while startup bubble clears"
  );
});

test("P2-34 reuses the pre-settlement idle index for all idle acceptance checks", () => {
  const idleStartIndexPosition = runnerSource.indexOf(
    "const idleStartIndex = lastTelemetryIndex();"
  );
  const idleChecks = [
    "waitForLowFrequencyQueuedDecision(signal, idleStartIndex, 9_000)",
    'waitForCandidateTerminal(signal, "idle_presence", idleStartIndex, 9_000)',
    'inspectCandidateActionFirst("idle_presence", idleStartIndex)'
  ];

  for (const check of idleChecks) {
    const checkPosition = runnerSource.indexOf(check);
    assert.notEqual(checkPosition, -1, `missing idle check: ${check}`);
    assert.ok(checkPosition > idleStartIndexPosition, `idle check must use the captured index: ${check}`);
  }
});

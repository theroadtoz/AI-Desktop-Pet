import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const runnerSource = readFileSync(
  "scripts/p2-34-companion-presence-idle-mode-cadence-real-ui.mjs",
  "utf8"
);

function loadCandidateSkipReasonSanitizer() {
  const match = runnerSource.match(/const safeCandidateSkipReasons = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(match, "missing closed candidate skip-reason allowlist");
  const sanitizerMatch = runnerSource.match(
    /function sanitizeCandidateSkipReason\(skipReason\) \{[\s\S]*?\n\}/
  );
  assert.ok(sanitizerMatch, "missing candidate skip-reason sanitizer");
  return Function(`
    const safeCandidateSkipReasons = new Set([${match[1]}]);
    ${sanitizerMatch[0]}
    return sanitizeCandidateSkipReason;
  `)() as (skipReason: unknown) => string | null;
}

function loadSafeSuppressionReasons() {
  const match = runnerSource.match(/const safeSuppressionSkipReasons = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(match, "missing closed safe suppression allowlist");
  return new Set(Function(`return [${match[1]}];`)() as string[]);
}

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

test("P2-34 retains only fixed P2-85 context skip reasons in diagnostics", () => {
  const sanitizeCandidateSkipReason = loadCandidateSkipReasonSanitizer();
  assert.equal(sanitizeCandidateSkipReason("context_model_busy"), "context_model_busy");
  assert.equal(sanitizeCandidateSkipReason("context_focus_suppressed"), "context_focus_suppressed");
  assert.equal(sanitizeCandidateSkipReason("context_lifecycle_suspended"), "context_lifecycle_suspended");
  assert.match(runnerSource, /skipReason: sanitizeCandidateSkipReason\(event\.payload\?\.skipReason\)/);
});

test("P2-34 drops arbitrary dynamic context skip reasons from diagnostics", () => {
  const sanitizeCandidateSkipReason = loadCandidateSkipReasonSanitizer();
  assert.equal(sanitizeCandidateSkipReason("context_evil_dynamic"), null);
  assert.equal(sanitizeCandidateSkipReason("context_model_busy:private"), null);
  assert.equal(sanitizeCandidateSkipReason("context_"), null);
  assert.equal(sanitizeCandidateSkipReason("model_busy"), null);
});

test("P2-34 accepts only the fixed engagement-equivalent suppression reason", () => {
  const safeSuppressionReasons = loadSafeSuppressionReasons();
  assert.equal(safeSuppressionReasons.has("context_engagement_suppressed"), true);
  assert.equal(safeSuppressionReasons.has("context_presentation_busy"), false);
  assert.equal(safeSuppressionReasons.has("context_model_busy"), false);
  assert.equal(safeSuppressionReasons.has("context_evil_dynamic"), false);
  assert.match(
    runnerSource,
    /safeSuppressionSkipReasons\.has\(outcome\.skipReason\)[\s\S]*?bubble\.state === "hidden" && bubble\.textLength === 0/
  );
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/p2-91c2c-memory-clear-real-ui.mjs", "utf8");
const preloadSource = readFileSync("src/preload/chat-preload.ts", "utf8");

test("P2-91C2C real UI uses bundled preload and restart readback", () => {
  assert.match(source, /window\.memoryApi\.clearCards\(\)/u);
  assert.match(source, /window\.memoryApi\.listCards\(\)/u);
  assert.match(source, /window\.memoryApi\.listReviews\(\)/u);
  assert.match(source, /window\.userProfileApi\.getUserProfile\(\)/u);
  assert.match(source, /await stopElectron\(context\);[\s\S]*const second = await openApp\(\)/u);
  assert.match(source, /diskFactsClearedSuppressionsPreserved/u);
  assert.match(source, /diskPendingOnlyCleared/u);
  assert.match(source, /diskLegacyProfileRemoved/u);
  assert.match(source, /restartReadback/u);
  assert.doesNotMatch(source, /memory-clear-transaction\.js/u);
});

test("P2-91C2C real UI proves unsafe and untrusted zero-change boundaries", () => {
  for (const marker of [
    "invalidZeroChange",
    "futureZeroChange",
    "sensitiveZeroChange",
    "unauthorizedChildAndForeignZeroChange",
    "sameParticipants(before, snapshotParticipants())",
    "petUnauthorized",
    "childUnauthorized",
    "foreignUnauthorized"
  ]) {
    assert.equal(source.includes(marker), true, marker);
  }
  assert.match(preloadSource, /ipcRenderer\.invoke\(["']memory:clear["']\)/u);
  assert.match(source, /Unauthorized memory request/u);
  assert.doesNotMatch(source, /BridgeAbsent|bridgeAbsent/u);
  assert.match(source, /AI_DESKTOP_PET_P2_91C2C_UNTRUSTED_PRELOAD_FIXTURE/u);
  assert.match(source, /window\.memoryApi\.clearCards\(\)/u);
  assert.match(source, /mtimeNs: statSync\(path, \{ bigint: true \}\)\.mtimeNs\.toString\(\)/u);
  assert.match(source, /message\.includes\('Memory clear failed'\)/u);
  assert.match(source, /!existsSync\(paths\.transaction\)/u);
  assert.match(source, /findScreenshotResidue/u);
  assert.match(source, /cleanupRealUiRun/u);
});

test("P2-91C2C real UI proves startup recovery-required fail-closed behavior", () => {
  for (const marker of [
    "startupRecoveryRequired",
    "startupRecoveryRequiredFixedFailure",
    "startupRecoveryRequiredZeroChange",
    "startupRecoveryRequiredResidueRetained"
  ]) {
    assert.equal(source.includes(marker), true, marker);
  }
  assert.match(source, /Memory clear failed/u);
});

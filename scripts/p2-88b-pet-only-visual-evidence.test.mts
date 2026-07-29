import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  cleanupPetOnlyVisualEvidence,
  waitForPetOnlyVisualReview,
  waitForPetVisibleBaseline
} from "./support/p2-88b-pet-only-visual-evidence.mjs";

function createContext(env: Record<string, string> = {}) {
  const runDir = mkdtempSync(join(tmpdir(), "p2-88b-review-"));
  const visualDir = join(runDir, "visual-evidence");
  mkdirSync(visualDir);
  return {
    runDir,
    env,
    p288VisualDir: visualDir
  };
}

const enabledEnv = {
  AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1",
  AI_DESKTOP_PET_P2_88B_SAFE_FIXTURE: "1",
  AI_DESKTOP_PET_P2_88B_VISUAL_REVIEW_HANDSHAKE: "1"
};

test("P2-88B pet baseline retries the existing pixel probe until a visible frame", async () => {
  let nowMs = 0;
  const pixels = [0, 0, 1_001];
  const result = await waitForPetVisibleBaseline({}, {
    timeoutMs: 12_000,
    pollIntervalMs: 150,
    now: () => nowMs,
    sleepFor: async (delayMs: number) => {
      nowMs += delayMs;
    },
    readCanvasState: async () => ({ width: 640, height: 720 }),
    probeVisibleFrame: async () => ({
      contextLost: false,
      nonTransparentPixels: pixels.shift() ?? 0,
      attempts: 1
    })
  });

  assert.deepEqual(result, {
    baselineVisible: true,
    rendererVisiblePixels: 1_001,
    rendererContextLost: false,
    rendererProbeAttempts: 3,
    canvasWidth: 640,
    canvasHeight: 720,
    canvasSizeNonZero: true
  });
  assert.equal(nowMs, 300);
});

test("P2-88B pet baseline never accepts a context-lost frame", async () => {
  let nowMs = 0;
  const frames = [
    { contextLost: true, nonTransparentPixels: 2_000, attempts: 1 },
    { contextLost: false, nonTransparentPixels: 1_001, attempts: 1 }
  ];
  const result = await waitForPetVisibleBaseline({}, {
    timeoutMs: 12_000,
    pollIntervalMs: 150,
    now: () => nowMs,
    sleepFor: async (delayMs: number) => {
      nowMs += delayMs;
    },
    readCanvasState: async () => ({ width: 640, height: 720 }),
    probeVisibleFrame: async () => frames.shift()
  });

  assert.equal(result.baselineVisible, true);
  assert.equal(result.rendererContextLost, false);
  assert.equal(result.rendererProbeAttempts, 2);
  assert.equal(nowMs, 150);
});

test("P2-88B pet baseline times out with bounded safe diagnostics", async () => {
  let nowMs = 0;
  let failure;
  try {
    await waitForPetVisibleBaseline({}, {
      timeoutMs: 500,
      pollIntervalMs: 150,
      now: () => nowMs,
      sleepFor: async (delayMs: number) => {
        nowMs += delayMs;
      },
      readCanvasState: async () => ({ width: 640, height: 0 }),
      probeVisibleFrame: async () => ({
        contextLost: false,
        nonTransparentPixels: 0,
        attempts: 1
      })
    });
  } catch (error) {
    failure = error;
  }

  assert.equal(failure?.message, "pet_renderer_not_visible");
  assert.deepEqual(failure?.baselineObservation, {
    baselineVisible: false,
    rendererVisiblePixels: 0,
    rendererContextLost: false,
    rendererProbeAttempts: 4,
    canvasWidth: 640,
    canvasHeight: 0,
    canvasSizeNonZero: false
  });
  assert.equal(nowMs, 500);
});

test("P2-88B bounded visual review handshake accepts an external approval marker", async (t) => {
  const context = createContext(enabledEnv);
  t.after(() => rmSync(context.runDir, { recursive: true, force: true }));
  let nowMs = 0;
  const result = await waitForPetOnlyVisualReview(context, {
    timeoutMs: 120_000,
    pollIntervalMs: 250,
    now: () => nowMs,
    sleepFor: async (delayMs) => {
      assert.equal(existsSync(join(context.p288VisualDir, "review-ready")), true);
      writeFileSync(join(context.p288VisualDir, "review-approve"), "");
      nowMs += delayMs;
    }
  });

  assert.deepEqual(result, {
    visualReviewHandshakeEnabled: true,
    visualReviewDecision: "approved",
    humanVisualReviewConfirmed: true
  });
  cleanupPetOnlyVisualEvidence(context);
  assert.equal(existsSync(context.p288VisualDir), false);
});

test("P2-88B bounded visual review handshake fails closed on reject and timeout", async (t) => {
  const rejected = createContext(enabledEnv);
  const timedOut = createContext(enabledEnv);
  t.after(() => {
    rmSync(rejected.runDir, { recursive: true, force: true });
    rmSync(timedOut.runDir, { recursive: true, force: true });
  });

  await assert.rejects(
    waitForPetOnlyVisualReview(rejected, {
      timeoutMs: 120_000,
      pollIntervalMs: 250,
      now: () => 0,
      sleepFor: async () => {
        writeFileSync(join(rejected.p288VisualDir, "review-reject"), "");
      }
    }),
    /visual_review_rejected/
  );

  let nowMs = 0;
  await assert.rejects(
    waitForPetOnlyVisualReview(timedOut, {
      timeoutMs: 500,
      pollIntervalMs: 250,
      now: () => nowMs,
      sleepFor: async (delayMs) => {
        nowMs += delayMs;
      }
    }),
    /visual_review_timeout/
  );
  cleanupPetOnlyVisualEvidence(rejected);
  cleanupPetOnlyVisualEvidence(timedOut);
  assert.equal(existsSync(rejected.p288VisualDir), false);
  assert.equal(existsSync(timedOut.p288VisualDir), false);
});

test("P2-88B visual review needs all three gates and cleanup removes every marker", async (t) => {
  for (const missingGate of Object.keys(enabledEnv)) {
    const env = { ...enabledEnv, [missingGate]: "" };
    const context = createContext(env);
    t.after(() => rmSync(context.runDir, { recursive: true, force: true }));
    assert.deepEqual(await waitForPetOnlyVisualReview(context), {
      visualReviewHandshakeEnabled: false,
      visualReviewDecision: "not_requested",
      humanVisualReviewConfirmed: false
    });
    assert.equal(existsSync(join(context.p288VisualDir, "review-ready")), false);
  }

  const context = createContext(enabledEnv);
  t.after(() => rmSync(context.runDir, { recursive: true, force: true }));
  for (const marker of ["review-ready", "review-approve", "review-reject"]) {
    writeFileSync(join(context.p288VisualDir, marker), "");
  }
  cleanupPetOnlyVisualEvidence(context);
  assert.equal(existsSync(context.p288VisualDir), false);
  assert.equal(context.p288VisualEvidenceDeleted, true);
});

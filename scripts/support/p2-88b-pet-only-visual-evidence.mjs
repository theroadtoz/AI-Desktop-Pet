import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  captureVisiblePageFrame,
  waitForVisibleRendererFrame
} from "../p2-63a-yawn-motion-isolated-state-trigger-real-ui.mjs";
import { evaluate, sleep } from "./real-ui-harness.mjs";

const SAMPLE_OFFSETS_MS = [250, 750];
const PET_VISIBLE_BASELINE_TIMEOUT_MS = 12_000;
const PET_VISIBLE_BASELINE_POLL_INTERVAL_MS = 150;
const VISUAL_REVIEW_TIMEOUT_MS = 120_000;
const VISUAL_REVIEW_POLL_INTERVAL_MS = 250;
const VISUAL_REVIEW_READY_MARKER = "review-ready";
const VISUAL_REVIEW_APPROVE_MARKER = "review-approve";
const VISUAL_REVIEW_REJECT_MARKER = "review-reject";

export async function waitForPetVisibleBaseline(pet, dependencies = {}) {
  const now = dependencies.now ?? Date.now;
  const sleepFor = dependencies.sleepFor ?? sleep;
  const probeVisibleFrame = dependencies.probeVisibleFrame ?? waitForVisibleRendererFrame;
  const readCanvasState = dependencies.readCanvasState ?? (() => evaluate(pet, `(() => {
    const canvas = document.querySelector("#pet-canvas");
    return { width: canvas?.width ?? 0, height: canvas?.height ?? 0 };
  })()`));
  const requestedTimeoutMs = Number(dependencies.timeoutMs ?? PET_VISIBLE_BASELINE_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(requestedTimeoutMs)
    ? Math.min(PET_VISIBLE_BASELINE_TIMEOUT_MS, Math.max(1, requestedTimeoutMs))
    : PET_VISIBLE_BASELINE_TIMEOUT_MS;
  const requestedPollIntervalMs = Number(
    dependencies.pollIntervalMs ?? PET_VISIBLE_BASELINE_POLL_INTERVAL_MS
  );
  const pollIntervalMs = Number.isFinite(requestedPollIntervalMs)
    ? Math.min(1_000, Math.max(1, requestedPollIntervalMs))
    : PET_VISIBLE_BASELINE_POLL_INTERVAL_MS;
  const deadline = now() + timeoutMs;
  const maxOuterAttempts = Math.ceil(timeoutMs / pollIntervalMs) + 1;
  let outerAttempts = 0;
  let rendererProbeAttempts = 0;
  let lastObservation = createBaselineObservation();

  while (now() < deadline && outerAttempts < maxOuterAttempts) {
    outerAttempts += 1;
    const canvas = normalizeCanvasState(await readCanvasState());
    const renderer = await probeVisibleFrame(pet);
    rendererProbeAttempts += normalizeCount(renderer?.attempts);
    lastObservation = {
      baselineVisible: false,
      rendererVisiblePixels: normalizeCount(renderer?.nonTransparentPixels),
      rendererContextLost: renderer?.contextLost === true,
      rendererProbeAttempts,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      canvasSizeNonZero: canvas.width > 0 && canvas.height > 0
    };
    dependencies.onObservation?.(lastObservation);
    if (
      lastObservation.canvasSizeNonZero &&
      lastObservation.rendererContextLost === false &&
      lastObservation.rendererVisiblePixels > 1_000
    ) {
      return { ...lastObservation, baselineVisible: true };
    }
    const remainingMs = deadline - now();
    if (remainingMs <= 0) break;
    await sleepFor(Math.min(pollIntervalMs, remainingMs));
  }

  const error = new Error("pet_renderer_not_visible");
  error.baselineObservation = lastObservation;
  throw error;
}

function createBaselineObservation() {
  return {
    baselineVisible: false,
    rendererVisiblePixels: 0,
    rendererContextLost: false,
    rendererProbeAttempts: 0,
    canvasWidth: 0,
    canvasHeight: 0,
    canvasSizeNonZero: false
  };
}

function normalizeCanvasState(value) {
  return {
    width: normalizeCount(value?.width),
    height: normalizeCount(value?.height)
  };
}

function normalizeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 100_000_000) : 0;
}

export async function capturePetOnlyStateIdleVisualEvidence({
  pet,
  context,
  hasExactTerminal
}) {
  const visualDir = join(context.runDir, "visual-evidence");
  context.p288VisualDir = visualDir;
  mkdirSync(visualDir, { recursive: true });
  const startedAtMs = Date.now();
  const frames = [];

  for (const offsetMs of SAMPLE_OFFSETS_MS) {
    await sleep(Math.max(0, startedAtMs + offsetMs - Date.now()));
    if (hasExactTerminal()) break;
    await evaluate(pet, "new Promise((resolveFrame) => requestAnimationFrame(() => resolveFrame()))");
    if (hasExactTerminal()) break;
    const frame = await captureVisiblePageFrame({
      waitForVisibleFrame: () => waitForVisibleRendererFrame(pet),
      capturePageScreenshot: async () => {
        const result = await pet.cdp.send("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: false
        });
        return Buffer.from(result.data, "base64");
      }
    });
    if (hasExactTerminal()) break;
    const name = offsetMs === 250 ? "pet-idle-250ms.png" : "pet-idle-750ms.png";
    writeFileSync(join(visualDir, name), frame.data);
    frames.push(frame);
  }

  if (frames.length === 0) throw new Error("state_idle_visual_window_missed");
  const rendererContextLost = frames.some((frame) => frame.rendererContextLost);
  if (rendererContextLost) throw new Error("pet_renderer_context_lost");
  return {
    stateIdleFrameVisible: true,
    capturedFrameCount: frames.length,
    pngVisiblePixels: Math.max(...frames.map((frame) => frame.pngNonTransparentPixels)),
    rendererVisiblePixels: Math.max(...frames.map((frame) => frame.rendererNonTransparentPixels)),
    rendererContextLost,
    rendererProbeAttempts: frames.reduce((total, frame) => total + frame.rendererProbeAttempts, 0),
    screenshotAttempts: frames.reduce((total, frame) => total + frame.screenshotAttempts, 0)
  };
}

export async function waitForPetOnlyVisualReview(context, dependencies = {}) {
  const handshakeEnabled =
    context.env?.AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY === "1" &&
    context.env?.AI_DESKTOP_PET_P2_88B_SAFE_FIXTURE === "1" &&
    context.env?.AI_DESKTOP_PET_P2_88B_VISUAL_REVIEW_HANDSHAKE === "1";
  if (!handshakeEnabled) {
    context.p288VisualReviewHandshakeEnabled = false;
    context.p288VisualReviewDecision = "not_requested";
    context.p288HumanVisualReviewConfirmed = false;
    return {
      visualReviewHandshakeEnabled: false,
      visualReviewDecision: "not_requested",
      humanVisualReviewConfirmed: false
    };
  }

  const visualDir = context.p288VisualDir;
  if (typeof visualDir !== "string" || !existsSync(visualDir)) {
    throw new Error("visual_review_evidence_unavailable");
  }
  context.p288VisualReviewHandshakeEnabled = true;
  context.p288VisualReviewDecision = "pending";
  context.p288HumanVisualReviewConfirmed = false;
  const now = dependencies.now ?? Date.now;
  const sleepFor = dependencies.sleepFor ?? sleep;
  const requestedTimeoutMs = Number(dependencies.timeoutMs ?? VISUAL_REVIEW_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(requestedTimeoutMs)
    ? Math.min(VISUAL_REVIEW_TIMEOUT_MS, Math.max(1, requestedTimeoutMs))
    : VISUAL_REVIEW_TIMEOUT_MS;
  const requestedPollIntervalMs = Number(dependencies.pollIntervalMs ?? VISUAL_REVIEW_POLL_INTERVAL_MS);
  const pollIntervalMs = Number.isFinite(requestedPollIntervalMs)
    ? Math.min(1_000, Math.max(1, requestedPollIntervalMs))
    : VISUAL_REVIEW_POLL_INTERVAL_MS;
  const approveMarker = join(visualDir, VISUAL_REVIEW_APPROVE_MARKER);
  const rejectMarker = join(visualDir, VISUAL_REVIEW_REJECT_MARKER);
  writeFileSync(join(visualDir, VISUAL_REVIEW_READY_MARKER), "");
  const deadline = now() + timeoutMs;

  while (now() < deadline) {
    if (existsSync(rejectMarker)) {
      context.p288VisualReviewDecision = "rejected";
      throw new Error("visual_review_rejected");
    }
    if (existsSync(approveMarker)) {
      context.p288VisualReviewDecision = "approved";
      context.p288HumanVisualReviewConfirmed = true;
      return {
        visualReviewHandshakeEnabled: true,
        visualReviewDecision: "approved",
        humanVisualReviewConfirmed: true
      };
    }
    await sleepFor(Math.min(pollIntervalMs, Math.max(1, deadline - now())));
  }
  if (existsSync(rejectMarker)) {
    context.p288VisualReviewDecision = "rejected";
    throw new Error("visual_review_rejected");
  }
  if (existsSync(approveMarker)) {
    context.p288VisualReviewDecision = "approved";
    context.p288HumanVisualReviewConfirmed = true;
    return {
      visualReviewHandshakeEnabled: true,
      visualReviewDecision: "approved",
      humanVisualReviewConfirmed: true
    };
  }
  context.p288VisualReviewDecision = "timeout";
  throw new Error("visual_review_timeout");
}

export function cleanupPetOnlyVisualEvidence(context) {
  const visualDir = context.p288VisualDir;
  if (typeof visualDir === "string" && existsSync(visualDir)) {
    rmSync(visualDir, { recursive: true, force: true });
  }
  context.p288VisualEvidenceDeleted = typeof visualDir !== "string" || !existsSync(visualDir);
}

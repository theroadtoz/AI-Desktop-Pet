import "./styles.css";
import { initializeCubismRuntime } from "./live2d/cubism-runtime";
import { loadWitchLive2DModel } from "./live2d/cubism-model";
import { createLive2DRenderer } from "./live2d/cubism-renderer";
import { registerWebGLContextRecovery } from "./live2d/context-recovery";
import type { LoadedLive2DModel, Live2DFrameSample, Live2DRenderer } from "./live2d/types";
import type { EmotionTag } from "../../shared/emotion";
import { getScreenDragDelta, shouldSuppressScaleWheelDuringDrag, type ScreenPoint } from "./drag-pointer";
import { createScaleWheelNormalizer, hasScaleWheelModifiers } from "./scale-wheel";
import {
  createClickActionScheduler,
  createRapidTouchComboDetector,
  getInteractionActionCooldownSkipReason,
  getPresenceFilteredPetInteractionActions,
  getRandomPetInteractionActionsForMode,
  getPetInteractionAction,
  getWindowShakeLightFeedbackSkipReason,
  isStrongInteractionAction,
  selectRandomPetInteractionAction,
  type PetInteractionAction
} from "./interaction-actions";
import {
  createInteractionActionPlayer,
  type InteractionActionReason,
  type InteractionActionStrategy
} from "./interaction-action-player";
import { DEFAULT_DIALOGUE_MODE_ID, type DialogueModeId } from "../../shared/dialogue-style";
import { DEFAULT_PRESENCE_MODE_ID, type PresenceModeId } from "../../shared/presence-mode";
import {
  selectEmotionPresentation,
  type EmotionPresentation
} from "../../shared/emotion-presentation";
import type { PetPresentationIntent } from "../../shared/pet-role-state";
import { getPetActionTriggerActionType } from "../../shared/pet-action-trigger";
import { getPetAccessoryPreset, type PetAccessoryPresetId } from "../../shared/pet-accessory";
import {
  clampProactiveSpeechBubbleDuration,
  getProactiveSpeechBubbleLine,
  type ProactiveSpeechBubblePayload
} from "../../shared/proactive-speech-bubble";

const foundCanvas = document.querySelector<HTMLCanvasElement>("#pet-canvas");
const foundProactiveSpeechBubble = document.querySelector<HTMLDivElement>("#proactive-speech-bubble");

if (!foundCanvas) {
  throw new Error("pet canvas missing");
}

if (!foundProactiveSpeechBubble) {
  throw new Error("proactive speech bubble missing");
}

const canvas: HTMLCanvasElement = foundCanvas;
const proactiveSpeechBubble: HTMLDivElement = foundProactiveSpeechBubble;
const foundGl = canvas.getContext("webgl2", {
  alpha: true,
  antialias: true,
  premultipliedAlpha: false,
  preserveDrawingBuffer: false
});

if (!foundGl) {
  throw new Error("WebGL2 is not available");
}

const gl: WebGL2RenderingContext = foundGl;
const rendererBootTimeMs = performance.now();

type Rgba = readonly [number, number, number, number];

const vertexShaderSource = `#version 300 es
in vec2 a_position;
in vec4 a_color;
out vec4 v_color;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_color = a_color;
}`;

const fragmentShaderSource = `#version 300 es
precision mediump float;

in vec4 v_color;
out vec4 outColor;

void main() {
  outColor = v_color;
}`;

function createShader(type: GLenum, source: string): WebGLShader {
  const shader = gl.createShader(type);

  if (!shader) {
    throw new Error("failed to create WebGL shader");
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "unknown shader error";
    gl.deleteShader(shader);
    throw new Error(message);
  }

  return shader;
}

function createProgram(): WebGLProgram {
  const vertexShader = createShader(gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = createShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
  const program = gl.createProgram();

  if (!program) {
    throw new Error("failed to create WebGL program");
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? "unknown program error";
    gl.deleteProgram(program);
    throw new Error(message);
  }

  return program;
}

function toClipX(x: number, width: number): number {
  return (x / width) * 2 - 1;
}

function toClipY(y: number, height: number): number {
  return 1 - (y / height) * 2;
}

function ellipseVertices(
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  color: Rgba
): Float32Array {
  const steps = 72;
  const vertices: number[] = [
    toClipX(centerX, width),
    toClipY(centerY, height),
    ...color
  ];

  for (let index = 0; index <= steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    const x = centerX + Math.cos(angle) * radiusX;
    const y = centerY + Math.sin(angle) * radiusY;
    vertices.push(toClipX(x, width), toClipY(y, height), ...color);
  }

  return new Float32Array(vertices);
}

function resizeCanvas(): void {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

type PlaceholderResources = {
  program: WebGLProgram;
  buffer: WebGLBuffer;
  positionLocation: number;
  colorLocation: number;
};

let placeholderResources: PlaceholderResources | null = null;

function invalidatePlaceholderResources(): void {
  placeholderResources = null;
}

function getPlaceholderResources(): PlaceholderResources {
  if (placeholderResources) {
    return placeholderResources;
  }

  const program = createProgram();
  const buffer = gl.createBuffer();

  if (!buffer) {
    throw new Error("failed to create WebGL buffer");
  }

  placeholderResources = {
    program,
    buffer,
    positionLocation: gl.getAttribLocation(program, "a_position"),
    colorLocation: gl.getAttribLocation(program, "a_color")
  };

  return placeholderResources;
}

function drawEllipse(vertices: Float32Array): void {
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  gl.drawArrays(gl.TRIANGLE_FAN, 0, vertices.length / 6);
}

function drawPlaceholderPet(): void {
  if (gl.isContextLost()) {
    return;
  }

  resizeCanvas();

  const { program, buffer, positionLocation, colorLocation } = getPlaceholderResources();
  const width = canvas.width;
  const height = canvas.height;
  const centerX = width / 2;

  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.enableVertexAttribArray(positionLocation);
  gl.enableVertexAttribArray(colorLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 24, 0);
  gl.vertexAttribPointer(colorLocation, 4, gl.FLOAT, false, 24, 8);

  drawEllipse(ellipseVertices(width, height, centerX, height * 0.56, width * 0.26, height * 0.3, [0.42, 0.14, 0.58, 0.62]));
  drawEllipse(ellipseVertices(width, height, centerX, height * 0.27, width * 0.18, height * 0.13, [0.96, 0.78, 0.92, 0.72]));
  drawEllipse(ellipseVertices(width, height, centerX, height * 0.2, width * 0.22, height * 0.1, [0.2, 0.09, 0.28, 0.5]));
  drawEllipse(ellipseVertices(width, height, centerX - width * 0.065, height * 0.26, width * 0.022, height * 0.016, [0.16, 0.06, 0.18, 0.7]));
  drawEllipse(ellipseVertices(width, height, centerX + width * 0.065, height * 0.26, width * 0.022, height * 0.016, [0.16, 0.06, 0.18, 0.7]));
}

let live2DRenderer: Live2DRenderer | null = null;
let live2DModel: LoadedLive2DModel | null = null;
let isUsingLive2D = false;
let pendingPresentation: EmotionPresentation | null = null;
let lastPresentation: EmotionPresentation = { emotion: "neutral", intensity: "low", mode: "neutral" };
let pendingAccessoryPresetId: PetAccessoryPresetId | null = null;
let lastAccessoryPresetId: PetAccessoryPresetId = "none";
let isStartingPetRenderer = false;
let isRecoveringContext = false;
let currentRenderStartMs = 0;
let firstFrameMs: number | undefined;
let recoveryCount = 0;
let pendingLive2DFrameSample: ((sample: Live2DFrameSample) => void) | null = null;
let hasPlayedStartupAppearance = false;
let currentDialogueModeId: DialogueModeId = DEFAULT_DIALOGUE_MODE_ID;
let currentPresenceModeId: PresenceModeId = DEFAULT_PRESENCE_MODE_ID;
let proactiveSpeechBubbleTimeout: number | null = null;

function clearProactiveSpeechBubble(): void {
  if (proactiveSpeechBubbleTimeout !== null) {
    window.clearTimeout(proactiveSpeechBubbleTimeout);
    proactiveSpeechBubbleTimeout = null;
  }

  proactiveSpeechBubble.textContent = "";
  proactiveSpeechBubble.dataset.state = "hidden";
  delete proactiveSpeechBubble.dataset.lineId;
  delete proactiveSpeechBubble.dataset.reason;
  proactiveSpeechBubble.setAttribute("aria-hidden", "true");
}

function showProactiveSpeechBubble(payload: ProactiveSpeechBubblePayload): void {
  if (currentPresenceModeId === "sleep") {
    clearProactiveSpeechBubble();
    return;
  }

  clearProactiveSpeechBubble();
  proactiveSpeechBubble.textContent = getProactiveSpeechBubbleLine(payload.lineId);
  proactiveSpeechBubble.dataset.state = "visible";
  proactiveSpeechBubble.dataset.lineId = payload.lineId;
  proactiveSpeechBubble.dataset.reason = payload.reason;
  proactiveSpeechBubble.setAttribute("aria-hidden", "false");
  proactiveSpeechBubbleTimeout = window.setTimeout(
    clearProactiveSpeechBubble,
    clampProactiveSpeechBubbleDuration(payload.durationMs)
  );
}

async function applyBasePresentationToLoadedModel(
  presentation: EmotionPresentation,
  accessoryPresetId: PetAccessoryPresetId
): Promise<void> {
  if (!live2DModel) {
    return;
  }

  await live2DModel.setEmotionPresentation(presentation);

  const accessoryPreset = getPetAccessoryPreset(accessoryPresetId);
  if (accessoryPreset.expressionName) {
    await live2DModel.setExpression(accessoryPreset.expressionName);
  }
}

function applyBasePresentationToModel(presentation: EmotionPresentation, accessoryPresetId: PetAccessoryPresetId): void {
  if (!live2DModel) {
    pendingPresentation = presentation;
    pendingAccessoryPresetId = accessoryPresetId;
    return;
  }

  pendingPresentation = null;
  pendingAccessoryPresetId = null;

  void applyBasePresentationToLoadedModel(presentation, accessoryPresetId);
}

const interactionActionPlayer = createInteractionActionPlayer({
  now: () => performance.now(),
  scheduleTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearScheduledTimeout: (handle) => window.clearTimeout(handle),
  getAction: getPetInteractionAction,
  getCooldownSkipReason: getInteractionActionCooldownSkipReason,
  getWindowShakeLightFeedbackSkipReason,
  isStrongAction: isStrongInteractionAction,
  boostInteraction: (durationMs) => {
    live2DRenderer?.boostInteraction(durationMs);
  },
  pauseLook: () => {
    live2DModel?.setLookPaused(true);
  },
  resumeLook: () => {
    live2DModel?.setLookPaused(false);
  },
  setLookTarget: (x, y) => {
    live2DModel?.setLookTarget(x, y);
  },
  resetLookTarget: () => {
    live2DModel?.setLookTarget(0, 0);
  },
  setPoseTarget: (target) => {
    live2DModel?.setTemporaryPoseTarget(target);
  },
  resetPoseTarget: () => {
    live2DModel?.resetTemporaryPoseTarget();
  },
  applyTemporaryPartOpacities: (partIds) => {
    live2DModel?.applyTemporaryPartOpacities(partIds, 1);
  },
  restoreTemporaryPartOpacities: () => {
    live2DModel?.restoreTemporaryPartOpacities();
  },
  setExpression: (expressionName) => {
    void live2DModel?.setExpression(expressionName);
  },
  clearExpression: () => {
    live2DModel?.clearExpression();
  },
  applyPresentation: applyBasePresentationToModel,
  getPersistentPresentation: () => ({
    presentation: lastPresentation,
    accessoryPresetId: lastAccessoryPresetId
  }),
  reportTelemetry: (type, payload) => {
    window.petApi?.reportTelemetry(type, payload);
  }
});

function applyBasePresentation(presentation: EmotionPresentation, accessoryPresetId: PetAccessoryPresetId): void {
  lastPresentation = presentation;
  lastAccessoryPresetId = accessoryPresetId;
  applyBasePresentationToModel(presentation, accessoryPresetId);
}

function applyPresentationIntent(intent: PetPresentationIntent): void {
  const expressionAllowed = intent.expression.mode === "emphasis"
    ? intent.allowEmphasisExpression
    : intent.expression.mode === "micro"
      ? intent.allowMicroExpression
      : true;

  canvas.dataset.roleState = intent.state;
  canvas.dataset.workStatus = intent.workStatus;
  canvas.dataset.expressionEmotion = intent.expression.emotion;
  canvas.dataset.expressionIntensity = intent.expression.intensity;
  canvas.dataset.expressionMode = intent.expression.mode;
  window.petApi?.reportTelemetry("pet_presentation_intent_applied", {
    state: intent.state,
    requestVersion: intent.requestVersion,
    emotion: intent.expression.emotion,
    intensity: intent.expression.intensity,
    mode: intent.expression.mode,
    allowMicroExpression: intent.allowMicroExpression,
    allowEmphasisExpression: intent.allowEmphasisExpression,
    recovery: intent.recovery
  });
  lastAccessoryPresetId = intent.accessoryPresetId;

  if (expressionAllowed) {
    lastPresentation = intent.expression;
  }

  if (!interactionActionPlayer.isActive()) {
    applyBasePresentationToModel(lastPresentation, lastAccessoryPresetId);
  }

  live2DRenderer?.boostInteraction();
}

const removePresentationIntentListener = window.petApi?.onPresentationIntent((intent) => {
  applyPresentationIntent(intent);
}) ?? null;
window.petApi?.presentationReady();

function drawFallbackPet(): void {
  isUsingLive2D = false;
  drawPlaceholderPet();
}

function disposeLive2DRenderer(): void {
  live2DRenderer?.release();
  live2DRenderer = null;
  live2DModel = null;
  isUsingLive2D = false;
}

function reportRenderHealth(renderer: "live2d" | "placeholder", message?: string): void {
  window.petApi?.reportRenderHealth({
    framesPerSecond: 0,
    isContextLost: gl.isContextLost(),
    timestamp: Date.now(),
    renderer,
    ...(firstFrameMs !== undefined ? { firstFrameMs } : {}),
    renderStartMs: currentRenderStartMs,
    recoveryCount,
    ...(message ? { message } : {})
  });
}

function waitForNextLive2DFrameSample(timeoutMs = 2_000): Promise<Live2DFrameSample | null> {
  return new Promise((resolve) => {
    const timeoutId = window.setTimeout(() => {
      pendingLive2DFrameSample = null;
      resolve(null);
    }, timeoutMs);

    pendingLive2DFrameSample = (sample) => {
      window.clearTimeout(timeoutId);
      pendingLive2DFrameSample = null;
      resolve(sample);
    };
  });
}

async function releaseCubismStaticWebGLResources(): Promise<void> {
  const { CubismRenderer_WebGL } = await import("./live2d/vendor/framework/rendering/cubismrenderer_webgl");
  CubismRenderer_WebGL.doStaticRelease();
}

async function startPetRenderer(): Promise<void> {
  if (isStartingPetRenderer) {
    return;
  }

  isStartingPetRenderer = true;
  currentRenderStartMs = Math.round(performance.now() - rendererBootTimeMs);

  try {
    if (gl.isContextLost()) {
      reportRenderHealth("placeholder", "WebGL context is lost");
      return;
    }

    disposeLive2DRenderer();
    resizeCanvas();
    await initializeCubismRuntime();

    live2DModel = await loadWitchLive2DModel(gl, canvas.width, canvas.height);
    live2DRenderer = createLive2DRenderer(canvas, gl, live2DModel, (sample) => {
      pendingLive2DFrameSample?.(sample);
      window.petApi?.reportRenderHealth({
        framesPerSecond: 0,
        isContextLost: gl.isContextLost(),
        timestamp: Date.now(),
        renderer: "live2d",
        ...(firstFrameMs !== undefined ? { firstFrameMs } : {}),
        renderStartMs: currentRenderStartMs,
        recoveryCount,
        ...sample
      });
    }, (sample) => {
      window.petApi?.reportTelemetry("pet_performance_sample", {
        mode: sample.mode,
        presenceModeId: sample.presenceModeId,
        targetFramesPerSecond: sample.targetFramesPerSecond,
        rafCallbacks: sample.rafCallbacks,
        renderedFrames: sample.renderedFrames,
        skippedFrames: sample.skippedFrames,
        live2DUpdates: sample.live2DUpdates,
        physicsUpdates: sample.physicsUpdates,
        breathUpdates: sample.breathUpdates,
        rafFramesPerSecond: sample.rafFramesPerSecond,
        renderedFramesPerSecond: sample.renderedFramesPerSecond,
        skippedFramesPerSecond: sample.skippedFramesPerSecond,
        live2DUpdatesPerSecond: sample.live2DUpdatesPerSecond,
        physicsUpdatesPerSecond: sample.physicsUpdatesPerSecond,
        breathUpdatesPerSecond: sample.breathUpdatesPerSecond
      });
    });
    live2DRenderer.setPresenceMode(currentPresenceModeId);
    isUsingLive2D = true;
    live2DModel.setLookTarget(0, 0);
    const firstLive2DFrameSample = waitForNextLive2DFrameSample();
    live2DRenderer.start();
    if (pendingPresentation) {
      applyBasePresentationToModel(pendingPresentation, pendingAccessoryPresetId ?? lastAccessoryPresetId);
    } else if (lastPresentation.mode !== "neutral") {
      applyBasePresentationToModel(lastPresentation, lastAccessoryPresetId);
    } else if (lastAccessoryPresetId !== "none") {
      applyBasePresentationToModel(lastPresentation, lastAccessoryPresetId);
    }
    reportRenderHealth("live2d");
    const sample = await firstLive2DFrameSample;
    if (!hasPlayedStartupAppearance && sample && sample.nonTransparentPixels > 0) {
      hasPlayedStartupAppearance = true;
      interactionActionPlayer.playAction(getPetInteractionAction("appearance"), "startup_first_visible_frame");
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[live2d] failed to start Live2D renderer; using placeholder", {
      message
    });
    drawFallbackPet();
    reportRenderHealth("placeholder", message);
  } finally {
    isStartingPetRenderer = false;
    firstFrameMs = firstFrameMs ?? Math.round(performance.now() - rendererBootTimeMs);
    window.petApi?.reportFirstFrame({
      firstFrameMs,
      renderStartMs: currentRenderStartMs,
      renderer: isUsingLive2D ? "live2d" : "placeholder",
      recoveryCount
    });
  }
}

function handleWebGLContextLost(): void {
  const renderer = isUsingLive2D ? "live2d" : "placeholder";

  isRecoveringContext = true;
  recoveryCount += 1;
  window.petApi?.reportTelemetry("webgl_context_lost", {
    renderer,
    recoveryCount,
    isContextLost: gl.isContextLost()
  });
  window.petApi?.reportTelemetry("recovery_started", {
    source: "webgl_context_lost",
    renderer,
    recoveryCount
  });
  live2DRenderer?.stop();
  live2DRenderer = null;
  live2DModel = null;
  isUsingLive2D = false;
  pendingPresentation = lastPresentation;
  pendingAccessoryPresetId = lastAccessoryPresetId;
  invalidatePlaceholderResources();
  endDrag();
  reportRenderHealth(renderer, "WebGL context lost");
}

async function handleWebGLContextRestored(): Promise<void> {
  invalidatePlaceholderResources();
  window.petApi?.reportTelemetry("webgl_context_restored", {
    recoveryCount,
    isContextLost: gl.isContextLost()
  });

  try {
    await releaseCubismStaticWebGLResources();
    const frameSample = waitForNextLive2DFrameSample();
    await startPetRenderer();
    const sample = isUsingLive2D ? await frameSample : null;

    if (isUsingLive2D && (!sample || sample.nonTransparentPixels <= 0)) {
      throw new Error("Live2D recovery produced an empty frame");
    }

    window.petApi?.reportTelemetry("recovery_succeeded", {
      source: "webgl_context_restored",
      renderer: isUsingLive2D ? "live2d" : "placeholder",
      recoveryCount
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    window.petApi?.reportTelemetry("recovery_failed", {
      source: "webgl_context_restored",
      recoveryCount,
      message
    });

    if (!gl.isContextLost()) {
      disposeLive2DRenderer();
      drawFallbackPet();
      reportRenderHealth("placeholder", message);
    }
  } finally {
    isRecoveringContext = false;
  }
}

const removeWebGLContextRecovery = registerWebGLContextRecovery(canvas, {
  onLost: handleWebGLContextLost,
  onRestored: () => {
    void handleWebGLContextRestored();
  }
});

function injectWebGLContextLoss(): void {
  if (gl.isContextLost() || isRecoveringContext) {
    console.warn("[live2d] WebGL context loss injection skipped during recovery");
    return;
  }

  const extension = gl.getExtension("WEBGL_lose_context");

  if (!extension) {
    console.warn("[live2d] WEBGL_lose_context extension is not available");
    return;
  }

  console.warn("[live2d] injecting WebGL context loss");
  extension.loseContext();

  window.setTimeout(() => {
    if (gl.isContextLost()) {
      extension.restoreContext();
    }
  }, 250);
}

const removeInjectWebGLContextLossListener = window.petApi?.onInjectWebGLContextLoss(() => {
  injectWebGLContextLoss();
}) ?? null;
const removeDialogueModeChangedListener = window.petApi?.onDialogueModeChanged((modeId) => {
  currentDialogueModeId = modeId;
}) ?? null;
const removePresenceModeChangedListener = window.petApi?.onPresenceModeChanged((modeId) => {
  currentPresenceModeId = modeId;
  live2DRenderer?.setPresenceMode(modeId);
  if (modeId === "sleep") {
    clearProactiveSpeechBubble();
  }
}) ?? null;
const removeActionTriggerListener = window.petApi?.onActionTrigger((trigger) => {
  if (trigger.reason === "chat_opened" || trigger.reason === "chat_input_focus") {
    clearProactiveSpeechBubble();
  }

  interactionActionPlayer.playAction(
    getPetInteractionAction(getPetActionTriggerActionType(trigger.reason)),
    trigger.reason
  );
}) ?? null;
const removeProactiveSpeechBubbleListener = window.petApi?.onProactiveSpeechBubble((payload) => {
  showProactiveSpeechBubble(payload);
}) ?? null;
const removeWindowMotionFeedbackListener = window.petApi?.onWindowMotionFeedback((feedback) => {
  if (feedback.type === "shake_light_feedback") {
    interactionActionPlayer.playWindowShakeLightFeedback();
  }
}) ?? null;

void window.petApi?.getDialogueMode().then((modeId) => {
  currentDialogueModeId = modeId;
}).catch(() => {
  currentDialogueModeId = DEFAULT_DIALOGUE_MODE_ID;
});

void window.petApi?.getPresenceMode().then((modeId) => {
  currentPresenceModeId = modeId;
  live2DRenderer?.setPresenceMode(modeId);
}).catch(() => {
  currentPresenceModeId = DEFAULT_PRESENCE_MODE_ID;
});

window.addEventListener("resize", () => {
  resizeCanvas();

  if (isUsingLive2D) {
    live2DRenderer?.boostInteraction();
    live2DRenderer?.resize(canvas.width, canvas.height);
  }

  if (!isUsingLive2D) {
    drawPlaceholderPet();
  }
});

document.addEventListener("visibilitychange", () => {
  live2DRenderer?.setVisible(!document.hidden);
});

window.addEventListener("beforeunload", () => {
  removeWebGLContextRecovery();
  removePresentationIntentListener?.();
  removeInjectWebGLContextLossListener?.();
  removeDialogueModeChangedListener?.();
  removePresenceModeChangedListener?.();
  removeActionTriggerListener?.();
  removeProactiveSpeechBubbleListener?.();
  removeWindowMotionFeedbackListener?.();
  clearProactiveSpeechBubble();
  cancelClickInteractionAction();
  rapidTouchComboDetector.reset();
  interactionActionPlayer.dispose();
  live2DRenderer?.release();
  live2DRenderer = null;
  live2DModel = null;
});

void startPetRenderer();

type Model3Probe = {
  Version?: unknown;
  FileReferences?: {
    Moc?: unknown;
  };
};

async function verifyModelAssetProtocol(): Promise<void> {
  const response = await fetch("pet-model://witch/魔女.model3.json");

  if (!response.ok) {
    console.warn("[pet-model] model3 fetch failed", { status: response.status });
    return;
  }

  const model3 = await response.json() as Model3Probe;

  console.info("[pet-model] model3 fetch ok", {
    hasVersion: Object.hasOwn(model3, "Version"),
    hasMoc: typeof model3.FileReferences?.Moc === "string"
  });
}

if (import.meta.env.DEV) {
  void verifyModelAssetProtocol().catch((error: unknown) => {
    console.warn("[pet-model] model3 fetch failed", {
      message: error instanceof Error ? error.message : String(error)
    });
  });
}

type HitRect = {
  name: "head" | "body";
  left: number;
  right: number;
  top: number;
  bottom: number;
};

const HIT_RECTS: readonly HitRect[] = [
  { name: "head", left: 0.25, right: 0.75, top: 0.05, bottom: 0.33 },
  { name: "body", left: 0.22, right: 0.78, top: 0.28, bottom: 0.83 }
];

const DRAG_THRESHOLD_DIP = 4;
const scaleWheelNormalizer = createScaleWheelNormalizer();

let lastIsHit = false;
let scaleWheelModifierAccelerator = "Ctrl+Shift";
let pointerDown: { pointerId: number; x: number; y: number; hitArea: HitRect["name"] } & ScreenPoint | null = null;
let lastDragPoint: ScreenPoint | null = null;
let isDragging = false;

function setScaleWheelModifierAccelerator(accelerator: string): void {
  scaleWheelModifierAccelerator = accelerator;
  scaleWheelNormalizer.reset();
}

void window.petApi?.getScaleWheelModifier().then(setScaleWheelModifierAccelerator).catch(() => {
  setScaleWheelModifierAccelerator("Ctrl+Shift");
});

window.petApi?.onScaleWheelModifierChanged(setScaleWheelModifierAccelerator);

function getPetHitArea(clientX: number, clientY: number): HitRect["name"] | null {
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;

  const hitRect = HIT_RECTS.find((candidate) => (
    x >= candidate.left &&
    x <= candidate.right &&
    y >= candidate.top &&
    y <= candidate.bottom
  ));

  return hitRect?.name ?? null;
}

function isPetHit(clientX: number, clientY: number): boolean {
  return getPetHitArea(clientX, clientY) !== null;
}

canvas.addEventListener("wheel", (event) => {
  if (shouldSuppressScaleWheelDuringDrag({ pointerDown: pointerDown !== null, isDragging })) {
    scaleWheelNormalizer.reset();
    return;
  }

  if (!hasScaleWheelModifiers(event, scaleWheelModifierAccelerator) || !isPetHit(event.clientX, event.clientY)) {
    scaleWheelNormalizer.reset();
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const step = scaleWheelNormalizer.push({
    deltaY: event.deltaY,
    deltaMode: event.deltaMode,
    viewportHeight: canvas.clientHeight,
    timestamp: event.timeStamp
  });

  if (step !== 0) {
    window.petApi?.adjustScale({ steps: step });
  }
}, { passive: false });

function updatePointerHit(event: PointerEvent): boolean {
  const nextIsHit = isPetHit(event.clientX, event.clientY);

  if (nextIsHit !== lastIsHit) {
    lastIsHit = nextIsHit;
    window.petApi?.setPointerHit(nextIsHit);
  }

  return nextIsHit;
}

function trySetPointerCapture(pointerId: number): void {
  try {
    canvas.setPointerCapture(pointerId);
  } catch {
    // Synthetic pointer events used by UI acceptance do not always create an active pointer.
  }
}

function tryReleasePointerCapture(pointerId: number): void {
  try {
    if (canvas.hasPointerCapture(pointerId)) {
      canvas.releasePointerCapture(pointerId);
    }
  } catch {
    // The pointer may already be gone after cancellation or synthetic input.
  }
}

type PendingClickAction = {
  action: PetInteractionAction;
  reason: InteractionActionReason;
  strategy?: InteractionActionStrategy;
};

function createBodyClickAction(): PendingClickAction {
  const modeActions = getPresenceFilteredPetInteractionActions(
    getRandomPetInteractionActionsForMode(currentDialogueModeId),
    currentPresenceModeId
  );

  return {
    action: selectRandomPetInteractionAction(Math.random, modeActions),
    reason: "click_body",
    strategy: {
      modeId: currentDialogueModeId,
      presenceModeId: currentPresenceModeId,
      candidateActionTypes: modeActions.map((action) => action.type)
    }
  };
}

let pendingClickAction: PendingClickAction | null = null;

function triggerPendingClickInteractionAction(): void {
  const pending = pendingClickAction ?? createBodyClickAction();
  pendingClickAction = null;
  interactionActionPlayer.playAction(pending.action, pending.reason, pending.strategy);
}

const petClickActionScheduler = createClickActionScheduler({
  delayMs: 220,
  trigger: triggerPendingClickInteractionAction,
  setTimeoutFn: window.setTimeout.bind(window),
  clearTimeoutFn: window.clearTimeout.bind(window)
});
const rapidTouchComboDetector = createRapidTouchComboDetector();

function scheduleClickInteractionAction(hitArea: HitRect["name"]): void {
  pendingClickAction = hitArea === "head"
    ? { action: getPetInteractionAction("headPat"), reason: "click_head" }
    : createBodyClickAction();
  petClickActionScheduler.schedule();
}

function cancelClickInteractionAction(): void {
  pendingClickAction = null;
  petClickActionScheduler.cancel();
}

function endDrag(): void {
  if (isDragging) {
    window.petApi?.endDrag();
    live2DModel?.endDragPhysics();
  }

  pointerDown = null;
  lastDragPoint = null;
  isDragging = false;
  live2DModel?.setLookPaused(false);
}

canvas.addEventListener("pointermove", (event) => {
  if (!isDragging) {
    updatePointerHit(event);
  }

  if (!pointerDown || pointerDown.pointerId !== event.pointerId) {
    return;
  }

  const totalDeltaX = event.clientX - pointerDown.x;
  const totalDeltaY = event.clientY - pointerDown.y;

  if (!isDragging) {
    const distance = Math.hypot(totalDeltaX, totalDeltaY);

    if (distance <= DRAG_THRESHOLD_DIP) {
      return;
    }

    isDragging = true;
    live2DRenderer?.boostInteraction();
    live2DModel?.setLookPaused(true);
    live2DModel?.startDragPhysics();
    const nextDragPoint = { screenX: event.screenX, screenY: event.screenY };
    const delta = getScreenDragDelta(pointerDown, nextDragPoint);
    live2DModel?.sampleDragPhysics(delta.deltaX, delta.deltaY, event.timeStamp);
    lastDragPoint = nextDragPoint;
    window.petApi?.startDrag();

    if (delta.deltaX !== 0 || delta.deltaY !== 0) {
      window.petApi?.moveDrag(delta);
    }
    return;
  }

  if (!lastDragPoint) {
    lastDragPoint = { screenX: event.screenX, screenY: event.screenY };
    return;
  }

  const nextDragPoint = { screenX: event.screenX, screenY: event.screenY };
  const delta = getScreenDragDelta(lastDragPoint, nextDragPoint);
  lastDragPoint = nextDragPoint;

  if (delta.deltaX !== 0 || delta.deltaY !== 0) {
    live2DRenderer?.boostInteraction();
    window.petApi?.moveDrag(delta);
    live2DModel?.sampleDragPhysics(delta.deltaX, delta.deltaY, event.timeStamp);
  }
});

canvas.addEventListener("pointerdown", (event) => {
  if (event.detail > 1) {
    cancelClickInteractionAction();
  }

  const hitArea = getPetHitArea(event.clientX, event.clientY);
  updatePointerHit(event);

  if (!hitArea) {
    return;
  }

  pointerDown = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    hitArea,
    screenX: event.screenX,
    screenY: event.screenY
  };
  lastDragPoint = null;
  isDragging = false;
  trySetPointerCapture(event.pointerId);
});

canvas.addEventListener("pointerup", (event) => {
  const wasDragging = isDragging;
  const isHit = updatePointerHit(event);

  if (!pointerDown || pointerDown.pointerId !== event.pointerId) {
    return;
  }

  const hitArea = pointerDown.hitArea;
  endDrag();
  tryReleasePointerCapture(event.pointerId);

  if (isHit && !wasDragging && hitArea) {
    if (currentPresenceModeId !== "sleep" && rapidTouchComboDetector.record(event.timeStamp)) {
      cancelClickInteractionAction();
      interactionActionPlayer.playAction(getPetInteractionAction("flusteredGlance"), "rapid_touch_combo");
      return;
    }

    scheduleClickInteractionAction(hitArea);
  }
});

canvas.addEventListener("dblclick", (event) => {
  if (!isPetHit(event.clientX, event.clientY)) {
    return;
  }

  cancelClickInteractionAction();
  live2DRenderer?.boostInteraction();
  window.petApi?.openChat();
});

canvas.addEventListener("pointercancel", (event) => {
  if (pointerDown?.pointerId === event.pointerId) {
    endDrag();
    tryReleasePointerCapture(event.pointerId);
  }
});

const EXPRESSION_SHORTCUTS: Readonly<Record<string, EmotionTag>> = {
  "1": "neutral",
  "2": "happy",
  "3": "sad",
  "4": "angry",
  "5": "surprised",
  "6": "confused"
};

window.addEventListener("keydown", (event) => {
  if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) {
    return;
  }

  const emotion = EXPRESSION_SHORTCUTS[event.key];

  if (!emotion || !live2DModel) {
    return;
  }

  applyBasePresentation(selectEmotionPresentation({
    emotion,
    intensity: emotion === "neutral" ? "low" : "high"
  }), lastAccessoryPresetId);
  live2DRenderer?.boostInteraction();
});

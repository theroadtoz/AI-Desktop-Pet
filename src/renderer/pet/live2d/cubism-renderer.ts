import { CUBISM_SHADER_BASE_URL } from "./cubism-assets";
import { calculateCubismFitLayout, calculateCubismModelBounds, getProjectionViewSize } from "./cubism-layout";
import { getCubismRenderBudget, type CubismRenderMode } from "./cubism-render-budget";
import { CubismMatrix44 } from "./vendor/framework/math/cubismmatrix44";
import type { Live2DUpdateSample, LoadedLive2DModel, Live2DFrameSample, Live2DRenderer } from "./types";
import { DEFAULT_PRESENCE_MODE_ID, type PresenceModeId } from "../../../shared/presence-mode";

function resizeCanvas(canvas: HTMLCanvasElement): void {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function updateModelMatrix(model: LoadedLive2DModel, canvas: HTMLCanvasElement, shouldLogLayout: boolean): void {
  const userModel = model.userModel;
  const renderer = userModel.getRenderer();
  const cubismModel = userModel.getModel();
  const modelMatrix = userModel.getModelMatrix();
  const bounds = calculateCubismModelBounds(cubismModel);
  const fit = calculateCubismFitLayout(bounds, canvas.width, canvas.height);
  const visibleArea = getProjectionViewSize(canvas.width, canvas.height);

  modelMatrix.loadIdentity();
  modelMatrix.scale(fit.scale, fit.scale);
  modelMatrix.translate(fit.translateX, fit.translateY);

  const projection = new CubismMatrix44();

  if (canvas.width > canvas.height) {
    const ratio = canvas.width / canvas.height;
    projection.scale(1 / ratio, 1);
  } else {
    const ratio = canvas.width / canvas.height;
    projection.scale(1, ratio);
  }

  projection.multiplyByMatrix(modelMatrix);
  renderer.setMvpMatrix(projection);
  renderer.setRenderTargetSize(canvas.width, canvas.height);

  if (shouldLogLayout && import.meta.env.DEV) {
    const modelAspect = bounds.width / bounds.height;
    const fittedAspect = (bounds.width * fit.scale) / (bounds.height * fit.scale);

    console.info("[pet-live2d-layout] visibleArea", {
      width: visibleArea.width,
      height: visibleArea.height,
      aspect: visibleArea.width / visibleArea.height
    });
    console.info("[pet-live2d-layout] bounds", bounds);
    console.info("[pet-live2d-layout] fit", fit);
    console.info("[pet-live2d-layout] aspectCheck", {
      modelAspect,
      fittedAspect
    });
  }
}

export type Live2DPerformanceSample = {
  mode: CubismRenderMode;
  presenceModeId: PresenceModeId;
  targetFramesPerSecond: number;
  rafCallbacks: number;
  renderedFrames: number;
  skippedFrames: number;
  live2DUpdates: number;
  physicsUpdates: number;
  breathUpdates: number;
  rafFramesPerSecond: number;
  renderedFramesPerSecond: number;
  skippedFramesPerSecond: number;
  live2DUpdatesPerSecond: number;
  physicsUpdatesPerSecond: number;
  breathUpdatesPerSecond: number;
};

export function createLive2DRenderer(
  canvas: HTMLCanvasElement,
  gl: WebGL2RenderingContext,
  model: LoadedLive2DModel,
  onFirstFrameSample?: (sample: Live2DFrameSample) => void,
  onPerformanceSample?: (sample: Live2DPerformanceSample) => void
): Live2DRenderer {
  let animationFrameId = 0;
  let lastFrameTime = performance.now();
  let lastRenderTime = 0;
  let interactionBoostUntilMs = performance.now() + 2_000;
  let isVisible = true;
  let disposed = false;
  let didSampleFirstFrame = false;
  let lastCanvasWidth = 0;
  let lastCanvasHeight = 0;
  let didLogLayout = false;
  let currentMode: CubismRenderMode = "active";
  let currentPresenceModeId: PresenceModeId = DEFAULT_PRESENCE_MODE_ID;
  let sampleWindowStartMs = performance.now();
  let rafCallbacks = 0;
  let renderedFrames = 0;
  let skippedFrames = 0;
  let live2DUpdates = 0;
  let physicsUpdates = 0;
  let breathUpdates = 0;

  const resetPerformanceCounters = (nowMs: number): void => {
    sampleWindowStartMs = nowMs;
    rafCallbacks = 0;
    renderedFrames = 0;
    skippedFrames = 0;
    live2DUpdates = 0;
    physicsUpdates = 0;
    breathUpdates = 0;
  };

  const maybeReportPerformanceSample = (nowMs: number, targetFramesPerSecond: number): void => {
    if (!onPerformanceSample || nowMs - sampleWindowStartMs < 5_000) {
      return;
    }

    const durationSeconds = (nowMs - sampleWindowStartMs) / 1000;

    onPerformanceSample({
      mode: currentMode,
      presenceModeId: currentPresenceModeId,
      targetFramesPerSecond,
      rafCallbacks,
      renderedFrames,
      skippedFrames,
      live2DUpdates,
      physicsUpdates,
      breathUpdates,
      rafFramesPerSecond: Math.round((rafCallbacks / durationSeconds) * 10) / 10,
      renderedFramesPerSecond: Math.round((renderedFrames / durationSeconds) * 10) / 10,
      skippedFramesPerSecond: Math.round((skippedFrames / durationSeconds) * 10) / 10,
      live2DUpdatesPerSecond: Math.round((live2DUpdates / durationSeconds) * 10) / 10,
      physicsUpdatesPerSecond: Math.round((physicsUpdates / durationSeconds) * 10) / 10,
      breathUpdatesPerSecond: Math.round((breathUpdates / durationSeconds) * 10) / 10
    });
    resetPerformanceCounters(nowMs);
  };

  const syncCanvasLayout = (): void => {
    resizeCanvas(canvas);

    if (canvas.width === lastCanvasWidth && canvas.height === lastCanvasHeight) {
      return;
    }

    lastCanvasWidth = canvas.width;
    lastCanvasHeight = canvas.height;
    updateModelMatrix(model, canvas, !didLogLayout);
    didLogLayout = true;
  };

  const renderFrame = (frameTime: number): void => {
    if (disposed) {
      return;
    }

    rafCallbacks += 1;

    const budget = getCubismRenderBudget({
      nowMs: frameTime,
      lastRenderMs: lastRenderTime,
      isVisible,
      interactionBoostUntilMs,
      presenceModeId: currentPresenceModeId
    });
    currentMode = budget.mode;

    if (!budget.shouldRender) {
      skippedFrames += 1;
      maybeReportPerformanceSample(frameTime, budget.targetFramesPerSecond);
      animationFrameId = window.requestAnimationFrame(renderFrame);
      return;
    }

    syncCanvasLayout();

    const deltaSeconds = Math.min((frameTime - lastFrameTime) / 1000, 1 / 15);
    lastFrameTime = frameTime;
    lastRenderTime = frameTime;

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const updateSample: Live2DUpdateSample = model.update(deltaSeconds);
    live2DUpdates += updateSample.live2DUpdates;
    physicsUpdates += updateSample.physicsUpdates;
    breathUpdates += updateSample.breathUpdates;
    renderedFrames += 1;
    model.userModel.getRenderer().setRenderState(null as unknown as WebGLFramebuffer, [0, 0, canvas.width, canvas.height]);
    model.userModel.getRenderer().drawModel(CUBISM_SHADER_BASE_URL);

    if (!didSampleFirstFrame && onFirstFrameSample) {
      didSampleFirstFrame = true;
      onFirstFrameSample(sampleFramePixels(gl, canvas.width, canvas.height));
    }

    maybeReportPerformanceSample(frameTime, budget.targetFramesPerSecond);
    animationFrameId = window.requestAnimationFrame(renderFrame);
  };

  return {
    start(): void {
      if (animationFrameId === 0) {
        lastFrameTime = performance.now();
        lastRenderTime = 0;
        resetPerformanceCounters(lastFrameTime);
        syncCanvasLayout();
        animationFrameId = window.requestAnimationFrame(renderFrame);
      }
    },
    resize(width: number, height: number): void {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      syncCanvasLayout();
      this.boostInteraction();
    },
    boostInteraction(durationMs = 2_000): void {
      interactionBoostUntilMs = Math.max(interactionBoostUntilMs, performance.now() + durationMs);
    },
    setVisible(nextIsVisible: boolean): void {
      isVisible = nextIsVisible;
      if (nextIsVisible) {
        this.boostInteraction();
      }
    },
    setPresenceMode(modeId: PresenceModeId): void {
      currentPresenceModeId = modeId;
    },
    stop(): void {
      if (animationFrameId !== 0) {
        window.cancelAnimationFrame(animationFrameId);
        animationFrameId = 0;
      }
    },
    release(): void {
      disposed = true;
      this.stop();
      model.release();
    }
  };
}

function sampleFramePixels(
  gl: WebGL2RenderingContext,
  canvasWidth: number,
  canvasHeight: number
): Live2DFrameSample {
  const pixels = new Uint8Array(canvasWidth * canvasHeight * 4);
  let nonTransparentPixels = 0;
  let opaqueBlackPixels = 0;

  gl.readPixels(0, 0, canvasWidth, canvasHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index] ?? 0;
    const green = pixels[index + 1] ?? 0;
    const blue = pixels[index + 2] ?? 0;
    const alpha = pixels[index + 3] ?? 0;

    if (alpha > 8) {
      nonTransparentPixels += 1;
    }

    if (alpha > 240 && red < 5 && green < 5 && blue < 5) {
      opaqueBlackPixels += 1;
    }
  }

  return {
    canvasWidth,
    canvasHeight,
    nonTransparentPixels,
    opaqueBlackPixels
  };
}

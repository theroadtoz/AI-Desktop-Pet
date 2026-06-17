import { CUBISM_SHADER_BASE_URL } from "./cubism-assets";
import { CubismMatrix44 } from "./vendor/framework/math/cubismmatrix44";
import type { LoadedLive2DModel, Live2DFrameSample, Live2DRenderer } from "./types";

function resizeCanvas(canvas: HTMLCanvasElement): void {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function updateModelMatrix(model: LoadedLive2DModel, canvas: HTMLCanvasElement): void {
  const userModel = model.userModel;
  const renderer = userModel.getRenderer();
  const cubismModel = userModel.getModel();
  const modelMatrix = userModel.getModelMatrix();
  const canvasAspect = canvas.width / canvas.height;
  const modelAspect = cubismModel.getCanvasWidth() / cubismModel.getCanvasHeight();
  const width = modelAspect > canvasAspect ? 1.85 : 1.85 * modelAspect / canvasAspect;

  modelMatrix.loadIdentity();
  modelMatrix.setWidth(width);
  modelMatrix.setCenterPosition(0, -0.08);

  const projection = new CubismMatrix44();

  if (canvas.width > canvas.height) {
    const ratio = canvas.width / canvas.height;
    projection.scale(1 / ratio, 1);
  } else {
    const ratio = canvas.height / canvas.width;
    projection.scale(1, ratio);
  }

  projection.multiplyByMatrix(modelMatrix);
  renderer.setMvpMatrix(projection);
  renderer.setRenderTargetSize(canvas.width, canvas.height);
}

export function createLive2DRenderer(
  canvas: HTMLCanvasElement,
  gl: WebGL2RenderingContext,
  model: LoadedLive2DModel,
  onFirstFrameSample?: (sample: Live2DFrameSample) => void
): Live2DRenderer {
  let animationFrameId = 0;
  let lastFrameTime = performance.now();
  let disposed = false;
  let didSampleFirstFrame = false;

  const renderFrame = (frameTime: number): void => {
    if (disposed) {
      return;
    }

    resizeCanvas(canvas);
    updateModelMatrix(model, canvas);

    const deltaSeconds = Math.min((frameTime - lastFrameTime) / 1000, 1 / 15);
    lastFrameTime = frameTime;

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    model.update(deltaSeconds);
    model.userModel.getRenderer().setRenderState(null as unknown as WebGLFramebuffer, [0, 0, canvas.width, canvas.height]);
    model.userModel.getRenderer().drawModel(CUBISM_SHADER_BASE_URL);

    if (!didSampleFirstFrame && onFirstFrameSample) {
      didSampleFirstFrame = true;
      onFirstFrameSample(sampleFramePixels(gl, canvas.width, canvas.height));
    }

    animationFrameId = window.requestAnimationFrame(renderFrame);
  };

  return {
    start(): void {
      if (animationFrameId === 0) {
        lastFrameTime = performance.now();
        animationFrameId = window.requestAnimationFrame(renderFrame);
      }
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

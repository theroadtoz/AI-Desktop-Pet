import "./styles.css";
import { initializeCubismRuntime } from "./live2d/cubism-runtime";
import { loadWitchLive2DModel } from "./live2d/cubism-model";
import { createLive2DRenderer } from "./live2d/cubism-renderer";
import { registerWebGLContextRecovery } from "./live2d/context-recovery";
import type { LoadedLive2DModel, Live2DRenderer } from "./live2d/types";
import type { EmotionTag } from "../../shared/emotion";

const foundCanvas = document.querySelector<HTMLCanvasElement>("#pet-canvas");

if (!foundCanvas) {
  throw new Error("pet canvas missing");
}

const canvas: HTMLCanvasElement = foundCanvas;
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
let pendingEmotion: EmotionTag | null = null;
let lastEmotion: EmotionTag = "neutral";
let isStartingPetRenderer = false;
let isRecoveringContext = false;

function applyEmotionToModel(emotion: EmotionTag): void {
  if (!live2DModel) {
    pendingEmotion = emotion;
    return;
  }

  pendingEmotion = null;

  if (emotion === "neutral") {
    live2DModel.clearExpression();
    console.info("[pet-expression] neutral");
    return;
  }

  void live2DModel.setExpression(emotion).then(() => {
    console.info(`[pet-expression] ${emotion}`);
  });
}

function applyEmotion(emotion: EmotionTag): void {
  lastEmotion = emotion;
  applyEmotionToModel(emotion);
}

const removeApplyEmotionListener = window.petApi?.onApplyEmotion((emotion) => {
  applyEmotion(emotion);
}) ?? null;

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
    ...(message ? { message } : {})
  });
}

async function startPetRenderer(): Promise<void> {
  if (isStartingPetRenderer) {
    return;
  }

  isStartingPetRenderer = true;

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
      window.petApi?.reportRenderHealth({
        framesPerSecond: 0,
        isContextLost: gl.isContextLost(),
        timestamp: Date.now(),
        renderer: "live2d",
        ...sample
      });
    });
    isUsingLive2D = true;
    live2DModel.setLookTarget(0, 0);
    live2DRenderer.start();
    if (pendingEmotion) {
      applyEmotionToModel(pendingEmotion);
    } else if (lastEmotion !== "neutral") {
      applyEmotionToModel(lastEmotion);
    }
    reportRenderHealth("live2d");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[live2d] failed to start Live2D renderer; using placeholder", {
      message
    });
    drawFallbackPet();
    reportRenderHealth("placeholder", message);
  } finally {
    isStartingPetRenderer = false;
    window.petApi?.reportFirstFrame();
  }
}

function handleWebGLContextLost(): void {
  const renderer = isUsingLive2D ? "live2d" : "placeholder";

  isRecoveringContext = true;
  live2DRenderer?.stop();
  live2DRenderer = null;
  live2DModel = null;
  isUsingLive2D = false;
  pendingEmotion = lastEmotion;
  invalidatePlaceholderResources();
  endDrag();
  reportRenderHealth(renderer, "WebGL context lost");
}

async function handleWebGLContextRestored(): Promise<void> {
  invalidatePlaceholderResources();

  try {
    await startPetRenderer();
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

window.addEventListener("resize", () => {
  resizeCanvas();

  if (isUsingLive2D) {
    live2DRenderer?.resize(canvas.width, canvas.height);
  }

  if (!isUsingLive2D) {
    drawPlaceholderPet();
  }
});

window.addEventListener("beforeunload", () => {
  removeWebGLContextRecovery();
  removeApplyEmotionListener?.();
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
  left: number;
  right: number;
  top: number;
  bottom: number;
};

const HIT_RECTS: readonly HitRect[] = [
  { left: 0.25, right: 0.75, top: 0.05, bottom: 0.33 },
  { left: 0.22, right: 0.78, top: 0.28, bottom: 0.83 }
];

const DRAG_THRESHOLD_DIP = 4;

let lastIsHit = false;
let pointerDown: { pointerId: number; x: number; y: number } | null = null;
let lastDragPoint: { x: number; y: number } | null = null;
let isDragging = false;

function isPetHit(clientX: number, clientY: number): boolean {
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;

  return HIT_RECTS.some((hitRect) => (
    x >= hitRect.left &&
    x <= hitRect.right &&
    y >= hitRect.top &&
    y <= hitRect.bottom
  ));
}

function updatePointerHit(event: PointerEvent): boolean {
  const nextIsHit = isPetHit(event.clientX, event.clientY);

  if (nextIsHit !== lastIsHit) {
    lastIsHit = nextIsHit;
    window.petApi?.setPointerHit(nextIsHit);
  }

  return nextIsHit;
}

function updateLookTarget(event: PointerEvent): void {
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);

  live2DModel?.setLookTarget(x, y);
}

function endDrag(): void {
  if (isDragging) {
    window.petApi?.endDrag();
  }

  pointerDown = null;
  lastDragPoint = null;
  isDragging = false;
  live2DModel?.setLookPaused(false);
}

canvas.addEventListener("pointermove", (event) => {
  updateLookTarget(event);
  updatePointerHit(event);

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
    live2DModel?.setLookPaused(true);
    lastDragPoint = { x: event.screenX, y: event.screenY };
    window.petApi?.startDrag();
    return;
  }

  if (!lastDragPoint) {
    lastDragPoint = { x: event.screenX, y: event.screenY };
    return;
  }

  const deltaX = event.screenX - lastDragPoint.x;
  const deltaY = event.screenY - lastDragPoint.y;
  lastDragPoint = { x: event.screenX, y: event.screenY };

  if (deltaX !== 0 || deltaY !== 0) {
    window.petApi?.moveDrag({ deltaX, deltaY });
  }
});

canvas.addEventListener("pointerdown", (event) => {
  if (!updatePointerHit(event)) {
    return;
  }

  pointerDown = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  lastDragPoint = null;
  isDragging = false;
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointerup", (event) => {
  const wasDragging = isDragging;
  const isHit = updatePointerHit(event);

  if (pointerDown?.pointerId === event.pointerId) {
    endDrag();
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }

  if (isHit && !wasDragging) {
    window.petApi?.openChat();
  }
});

canvas.addEventListener("pointercancel", (event) => {
  if (pointerDown?.pointerId === event.pointerId) {
    endDrag();
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
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

  if (import.meta.env.DEV && event.key.toLowerCase() === "l") {
    injectWebGLContextLoss();
    return;
  }

  const emotion = EXPRESSION_SHORTCUTS[event.key];

  if (!emotion || !live2DModel) {
    return;
  }

  applyEmotion(emotion);
});

export type WebGLContextRecoveryHandlers = {
  onLost(event: Event): void;
  onRestored(event: Event): void;
};

export function registerWebGLContextRecovery(
  canvas: HTMLCanvasElement,
  handlers: WebGLContextRecoveryHandlers
): () => void {
  const handleLost = (event: Event): void => {
    event.preventDefault();
    console.warn("[live2d] WebGL context lost");
    handlers.onLost(event);
  };

  const handleRestored = (event: Event): void => {
    console.warn("[live2d] WebGL context restored");
    handlers.onRestored(event);
  };

  canvas.addEventListener("webglcontextlost", handleLost);
  canvas.addEventListener("webglcontextrestored", handleRestored);

  return () => {
    canvas.removeEventListener("webglcontextlost", handleLost);
    canvas.removeEventListener("webglcontextrestored", handleRestored);
  };
}

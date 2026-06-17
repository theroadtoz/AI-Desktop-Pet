export function registerWebGLContextRecoveryLogging(canvas: HTMLCanvasElement): void {
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    console.warn("[live2d] WebGL context lost");
  });

  canvas.addEventListener("webglcontextrestored", () => {
    console.warn("[live2d] WebGL context restored; full Live2D recovery is deferred");
  });
}

import type { CubismModel } from "./vendor/framework/model/cubismmodel";

type CubismFrameModel = Pick<CubismModel, "loadParameters" | "saveParameters" | "update">;

export type CubismFrameLayers = Partial<{
  applyMotion(deltaSeconds: number): void;
  applyPhysicsInputs(deltaSeconds: number): void;
  evaluatePhysics(deltaSeconds: number): void;
  applyExpression(deltaSeconds: number): void;
  applyMicroExpression(deltaSeconds: number): void;
  applyBreath(deltaSeconds: number): void;
}>;

/**
 * Applies the model's parameter layers in their fixed per-frame order.
 *
 * Saving immediately after physics inputs makes those inputs the next frame's
 * base state while leaving physics, expressions, and breathing as overlays.
 */
export function updateCubismFrame(
  model: CubismFrameModel,
  deltaSeconds: number,
  layers: CubismFrameLayers
): void {
  model.loadParameters();
  layers.applyMotion?.(deltaSeconds);
  layers.applyPhysicsInputs?.(deltaSeconds);
  model.saveParameters();
  layers.evaluatePhysics?.(deltaSeconds);
  layers.applyExpression?.(deltaSeconds);
  layers.applyMicroExpression?.(deltaSeconds);
  layers.applyBreath?.(deltaSeconds);
  model.update();
}

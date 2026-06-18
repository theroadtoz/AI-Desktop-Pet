import * as modelManifestJson from "../../../../resources/models/witch/model-manifest.json";
import type { EmotionTag } from "../../../shared/emotion";
import type { ModelManifest } from "../../../shared/model-manifest";
import type { CubismModel } from "./vendor/framework/model/cubismmodel";
import type { CubismExpressionMotion } from "./vendor/framework/motion/cubismexpressionmotion";
import type { CubismExpressionMotionManager } from "./vendor/framework/motion/cubismexpressionmotionmanager";

const modelManifest = modelManifestJson as ModelManifest;

function resolveModelAssetUrl(relativePath: string): string {
  return `pet-model://witch/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`failed to fetch ${url}: ${response.status}`);
  }

  return await response.arrayBuffer();
}

export class CubismExpressionController {
  private readonly manager: CubismExpressionMotionManager;
  private readonly motionCache = new Map<string, CubismExpressionMotion>();

  public constructor(manager: CubismExpressionMotionManager) {
    this.manager = manager;
  }

  public getAvailableExpressions(): string[] {
    return Object.entries(modelManifest.emotionMap)
      .filter(([, expressionName]) => expressionName === null || this.resolveExpressionPath(expressionName))
      .map(([emotion]) => emotion);
  }

  public async setExpression(emotion: EmotionTag): Promise<void> {
    const expressionName = modelManifest.emotionMap[emotion];

    if (!expressionName) {
      this.clearExpression();
      return;
    }

    const expressionPath = this.resolveExpressionPath(expressionName);

    if (!expressionPath) {
      console.warn("[pet-expression] missing expression mapping", { emotion, expressionName });
      return;
    }

    try {
      const motion = await this.loadExpressionMotion(expressionPath);
      this.manager.startMotion(motion, false);
    } catch (error: unknown) {
      console.warn("[pet-expression] failed to load expression", {
        emotion,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  public clearExpression(): void {
    const entries = this.manager.getCubismMotionQueueEntries();

    while (entries.length > 0) {
      entries.pop()?.release();
    }
  }

  public update(model: CubismModel, deltaSeconds: number): void {
    try {
      this.manager.updateMotion(model, deltaSeconds);
    } catch (error: unknown) {
      console.warn("[pet-expression] failed to apply expression", {
        message: error instanceof Error ? error.message : String(error)
      });
      this.clearExpression();
    }
  }

  public release(): void {
    this.clearExpression();
    this.manager.release();
    this.motionCache.clear();
  }

  private resolveExpressionPath(expressionName: string): string | null {
    return modelManifest.expressions[expressionName] ?? null;
  }

  private async loadExpressionMotion(expressionPath: string): Promise<CubismExpressionMotion> {
    const cached = this.motionCache.get(expressionPath);

    if (cached) {
      return cached;
    }

    const { CubismExpressionMotion } = await import("./vendor/framework/motion/cubismexpressionmotion");
    const buffer = await fetchArrayBuffer(resolveModelAssetUrl(expressionPath));
    const motion = CubismExpressionMotion.create(buffer, buffer.byteLength);
    this.motionCache.set(expressionPath, motion);

    return motion;
  }
}

export async function createCubismExpressionController(): Promise<CubismExpressionController> {
  const { CubismExpressionMotionManager } = await import("./vendor/framework/motion/cubismexpressionmotionmanager");

  return new CubismExpressionController(new CubismExpressionMotionManager());
}

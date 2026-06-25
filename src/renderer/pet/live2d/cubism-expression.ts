import * as modelManifestJson from "../../../../resources/models/witch/model-manifest.json";
import { emotionTags, type EmotionTag } from "../../../shared/emotion";
import type { ModelManifest } from "../../../shared/model-manifest";
import {
  ExpressionIntentCoordinator,
  type ExpressionLoadRequest
} from "./cubism-expression-state";
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

function getSafeErrorType(error: unknown): string {
  return error instanceof Error && error.name ? error.name : typeof error;
}

export class CubismExpressionController {
  private readonly manager: CubismExpressionMotionManager;
  private readonly motionCache = new Map<string, CubismExpressionMotion>();
  private readonly motionLoads = new Map<string, Promise<CubismExpressionMotion>>();
  private readonly intent = new ExpressionIntentCoordinator();

  public constructor(manager: CubismExpressionMotionManager) {
    this.manager = manager;
  }

  public getAvailableExpressions(): string[] {
    return emotionTags.filter((emotion) => {
      if (emotion === "neutral") {
        return true;
      }

      const expressionName = modelManifest.emotionMap[emotion];
      return Boolean(expressionName && this.resolveExpressionPath(expressionName));
    });
  }

  public async setExpression(emotion: EmotionTag): Promise<void> {
    const action = this.intent.request(emotion);

    if (action.type === "none") {
      return;
    }

    if (action.type === "clear") {
      this.clearExpressionQueue();
      return;
    }

    const { request } = action;
    const expressionName = modelManifest.emotionMap[emotion];

    if (!expressionName) {
      this.failLoad(request, "missing-mapping");
      return;
    }

    const expressionPath = this.resolveExpressionPath(expressionName);

    if (!expressionPath) {
      this.failLoad(request, "missing-resource");
      return;
    }

    let hasAppliedLoad = false;

    try {
      const motion = await this.loadExpressionMotion(expressionPath);
      if (!this.intent.completeLoad(request)) {
        return;
      }

      hasAppliedLoad = true;
      this.manager.startMotion(motion, false);
    } catch (error: unknown) {
      if (hasAppliedLoad) {
        this.failApply(request.emotion, getSafeErrorType(error));
      } else {
        this.failLoad(request, getSafeErrorType(error));
      }
    }
  }

  public async setExpressionAsset(expressionName: string): Promise<void> {
    const expressionPath = this.resolveExpressionPath(expressionName);

    if (!expressionPath) {
      console.warn("[pet-expression] failed to load expression asset", {
        expressionName,
        errorType: "missing-resource"
      });
      this.clearExpressionQueue();
      return;
    }

    try {
      const motion = await this.loadExpressionMotion(expressionPath);

      if (this.intent.getState().isReleased) {
        return;
      }

      this.clearExpressionQueue();
      this.manager.startMotion(motion, false);
    } catch (error: unknown) {
      console.warn("[pet-expression] failed to apply expression asset", {
        expressionName,
        errorType: getSafeErrorType(error)
      });
      this.clearExpressionQueue();
    }
  }

  public clearExpression(): void {
    this.intent.clear();
    this.clearExpressionQueue();
  }

  public update(model: CubismModel, deltaSeconds: number): void {
    if (this.intent.getState().isReleased) {
      return;
    }

    try {
      this.manager.updateMotion(model, deltaSeconds);
    } catch (error: unknown) {
      this.failApply(this.intent.getState().intent, getSafeErrorType(error));
    }
  }

  public release(): void {
    this.intent.release();
    this.clearExpressionQueue();
    this.manager.release();
    this.motionCache.clear();
    this.motionLoads.clear();
  }

  private clearExpressionQueue(): void {
    const entries = this.manager.getCubismMotionQueueEntries();

    while (entries.length > 0) {
      entries.pop()?.release();
    }
  }

  private failLoad(request: ExpressionLoadRequest, errorType: string): void {
    if (!this.intent.failLoad(request)) {
      return;
    }

    console.warn("[pet-expression] failed to load expression", {
      emotion: request.emotion,
      errorType
    });
    this.clearExpressionQueue();
  }

  private failApply(emotion: EmotionTag, errorType: string): void {
    console.warn("[pet-expression] failed to apply expression", { emotion, errorType });
    this.intent.failApply();
    this.clearExpressionQueue();
  }

  private resolveExpressionPath(expressionName: string): string | null {
    return modelManifest.expressions[expressionName] ?? null;
  }

  private async loadExpressionMotion(expressionPath: string): Promise<CubismExpressionMotion> {
    const cached = this.motionCache.get(expressionPath);

    if (cached) {
      return cached;
    }

    const pending = this.motionLoads.get(expressionPath);

    if (pending) {
      return await pending;
    }

    const load = (async () => {
      const { CubismExpressionMotion } = await import("./vendor/framework/motion/cubismexpressionmotion");
      const buffer = await fetchArrayBuffer(resolveModelAssetUrl(expressionPath));
      const motion = CubismExpressionMotion.create(buffer, buffer.byteLength);

      if (!this.intent.getState().isReleased) {
        this.motionCache.set(expressionPath, motion);
      }

      return motion;
    })();
    this.motionLoads.set(expressionPath, load);

    try {
      return await load;
    } finally {
      this.motionLoads.delete(expressionPath);
    }
  }
}

export async function createCubismExpressionController(): Promise<CubismExpressionController> {
  const { CubismExpressionMotionManager } = await import("./vendor/framework/motion/cubismexpressionmotionmanager");

  return new CubismExpressionController(new CubismExpressionMotionManager());
}

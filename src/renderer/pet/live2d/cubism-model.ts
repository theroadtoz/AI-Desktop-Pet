import { CUBISM_SHADER_BASE_URL } from "./cubism-assets";
import { createCubismBreathController, type CubismBreathController } from "./cubism-breath";
import {
  createCubismAccessoryController,
  type CubismAccessoryController
} from "./cubism-accessory-controller";
import { createCubismExpressionController } from "./cubism-expression";
import {
  createCubismMicroExpressionController,
  type CubismMicroExpressionController
} from "./cubism-micro-expression";
import {
  createDragPhysicsController,
  readPhysicsSourceParameterIds,
  type DragPhysicsController
} from "./cubism-drag-physics";
import { updateCubismFrame } from "./cubism-frame-pipeline";
import { CubismLookController } from "./cubism-look";
import { createCubismMotionController, type CubismMotionController } from "./cubism-motion";
import { CubismPoseTargetController, type CubismPoseTarget } from "./cubism-pose-target";
import { WITCH_MODEL3_URL, type Live2DUpdateSample, type LoadedLive2DModel, type Model3Json } from "./types";
import { CubismFramework } from "./vendor/framework/live2dcubismframework";

const EMPTY_NATIVE_MOTION_PARAMETER_IDS: ReadonlySet<string> = new Set();

async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`failed to fetch ${url}: ${response.status}`);
  }

  return await response.arrayBuffer();
}

function resolveModelAssetUrl(relativePath: string): string {
  return `pet-model://witch/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

function parseModel3(buffer: ArrayBuffer): Model3Json {
  const text = new TextDecoder().decode(buffer);
  return JSON.parse(text) as Model3Json;
}

function assertFileReference(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing model3 file reference: ${label}`);
  }

  return value;
}

async function loadTexture(gl: WebGL2RenderingContext, url: string): Promise<WebGLTexture> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`failed to fetch texture ${url}: ${response.status}`);
  }

  const bitmap = await createImageBitmap(await response.blob(), {
    premultiplyAlpha: "premultiply"
  });

  const texture = gl.createTexture();

  if (!texture) {
    bitmap.close();
    throw new Error("failed to create Live2D texture");
  }

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
  bitmap.close();

  return texture;
}

export async function loadWitchLive2DModel(
  gl: WebGL2RenderingContext,
  width: number,
  height: number
): Promise<LoadedLive2DModel> {
  const [{ CubismUserModel }, { CubismModelSettingJson }] = await Promise.all([
    import("./vendor/framework/model/cubismusermodel"),
    import("./vendor/framework/cubismmodelsettingjson")
  ]);
  const expressionController = await createCubismExpressionController();
  let lookController: CubismLookController | null = null;
  let poseTargetController: CubismPoseTargetController | null = null;
  let breathController: CubismBreathController | null = null;
  let microExpressionController: CubismMicroExpressionController | null = null;
  let motionController: CubismMotionController | null = null;
  let dragPhysicsController: DragPhysicsController | null = null;
  let accessoryController: CubismAccessoryController | null = null;
  let temporaryPartOpacitySnapshot: Map<number, number> | null = null;

  class PetCubismUserModel extends CubismUserModel {
    public updateFrame(deltaSeconds: number): Live2DUpdateSample {
      const model = this.getModel();
      const sample: Live2DUpdateSample = {
        live2DUpdates: 1,
        physicsUpdates: this.hasPhysics() ? 1 : 0,
        breathUpdates: breathController ? 1 : 0
      };

      updateCubismFrame(model, deltaSeconds, {
        applyMotion: () => (
          motionController?.update(model, deltaSeconds) ?? EMPTY_NATIVE_MOTION_PARAMETER_IDS
        ),
        applyLook: () => lookController?.update(model, deltaSeconds),
        applyPose: () => poseTargetController?.update(model, deltaSeconds),
        applyDrag: () => dragPhysicsController?.advance(deltaSeconds),
        applyPhysicsInputs: () => {
          dragPhysicsController?.apply(model);
        },
        evaluatePhysics: () => this._physics?.evaluate(model, deltaSeconds),
        applyExpression: () => expressionController.update(model, deltaSeconds),
        applyMicroExpression: () => microExpressionController?.update(model, deltaSeconds),
        applyBreath: () => breathController?.update(model, deltaSeconds),
        applyAccessory: () => accessoryController?.update(model)
      });

      return sample;
    }

    public hasPhysics(): boolean {
      return Boolean(this._physics);
    }
  }

  const model3Buffer = await fetchArrayBuffer(WITCH_MODEL3_URL);
  const model3 = parseModel3(model3Buffer);
  const setting = new CubismModelSettingJson(model3Buffer, model3Buffer.byteLength);
  const mocPath = assertFileReference(model3.FileReferences?.Moc, "Moc");
  const texturePaths = model3.FileReferences?.Textures;

  if (!Array.isArray(texturePaths) || texturePaths.length === 0) {
    throw new Error("missing model3 file reference: Textures");
  }

  const userModel = new PetCubismUserModel();
  const mocBuffer = await fetchArrayBuffer(resolveModelAssetUrl(mocPath));
  userModel.loadModel(mocBuffer);

  if (!userModel.getModel()) {
    throw new Error("failed to load Live2D moc3");
  }

  lookController = new CubismLookController(userModel.getModel());
  accessoryController = createCubismAccessoryController(userModel.getModel());
  poseTargetController = new CubismPoseTargetController(userModel.getModel());
  breathController = await createCubismBreathController(userModel.getModel());
  microExpressionController = createCubismMicroExpressionController(userModel.getModel());
  motionController = await createCubismMotionController();

  const physicsPath = model3.FileReferences?.Physics;

  if (physicsPath) {
    const physicsBuffer = await fetchArrayBuffer(resolveModelAssetUrl(physicsPath));
    userModel.loadPhysics(physicsBuffer, physicsBuffer.byteLength);
    dragPhysicsController = createDragPhysicsController(
      userModel.getModel(),
      readPhysicsSourceParameterIds(physicsBuffer)
    );
  }

  userModel.createRenderer(width, height);

  const renderer = userModel.getRenderer();
  renderer.startUp(gl);
  renderer.loadShaders(CUBISM_SHADER_BASE_URL);
  renderer.setIsPremultipliedAlpha(true);

  await Promise.all(texturePaths.map(async (texturePath, textureIndex) => {
    const texture = await loadTexture(gl, resolveModelAssetUrl(texturePath));
    renderer.bindTexture(textureIndex, texture);
  }));

  setting.release();

  function restoreTemporaryPartOpacities(): void {
    if (!temporaryPartOpacitySnapshot) {
      return;
    }

    const model = userModel.getModel();

    for (const [partIndex, opacity] of temporaryPartOpacitySnapshot) {
      if (partIndex >= 0 && partIndex < model.getPartCount()) {
        model.setPartOpacityByIndex(partIndex, opacity);
      }
    }

    temporaryPartOpacitySnapshot = null;
  }

  function applyTemporaryPartOpacities(partIds: readonly string[], opacity: number): void {
    restoreTemporaryPartOpacities();

    if (partIds.length === 0) {
      return;
    }

    const model = userModel.getModel();
    const snapshot = new Map<number, number>();
    const idManager = CubismFramework.getIdManager();
    const clampedOpacity = Math.min(Math.max(opacity, 0), 1);

    for (const partId of partIds) {
      const partIndex = model.getPartIndex(idManager.getId(partId));

      if (partIndex < 0 || partIndex >= model.getPartCount() || snapshot.has(partIndex)) {
        continue;
      }

      snapshot.set(partIndex, model.getPartOpacityByIndex(partIndex));
      model.setPartOpacityByIndex(partIndex, clampedOpacity);
    }

    temporaryPartOpacitySnapshot = snapshot.size > 0 ? snapshot : null;
  }

  return {
    userModel,
    update(deltaSeconds: number): Live2DUpdateSample {
      return userModel.updateFrame(deltaSeconds);
    },
    setEmotionPresentation(presentation): Promise<void> {
      if (presentation.mode === "micro") {
        microExpressionController?.setEmotion(presentation.emotion, presentation.intensity);
      } else {
        microExpressionController?.clear(presentation.mode === "emphasis");
      }

      return expressionController.setExpression(
        presentation.mode === "emphasis" ? presentation.emotion : "neutral"
      );
    },
    setExpression(name): Promise<void> {
      microExpressionController?.clear(true);
      return expressionController.setExpressionAsset(name);
    },
    clearExpression(): void {
      expressionController.clearExpression();
    },
    getAvailableExpressions(): string[] {
      return expressionController.getAvailableExpressions();
    },
    setAccessorySelection(selection): void {
      accessoryController?.setResolvedSelection(selection);
    },
    setTemporaryAccessory(accessoryId): void {
      accessoryController?.setTemporaryAccessory(accessoryId);
    },
    restoreTemporaryAccessory(): void {
      accessoryController?.restoreResolvedSelection();
    },
    playMotionPreset(motionPresetId) {
      return motionController?.playMotionPreset(motionPresetId) ?? Promise.resolve({
        status: "skipped",
        skipReason: "no_semantic_motion_presets"
      });
    },
    stopMotion(reason): void {
      motionController?.stop(reason);
    },
    applyTemporaryPartOpacities,
    restoreTemporaryPartOpacities,
    setLookTarget(x: number, y: number): void {
      lookController?.setTarget(x, y);
    },
    setTemporaryPoseTarget(target: CubismPoseTarget): void {
      poseTargetController?.setTarget(target);
    },
    resetTemporaryPoseTarget(): void {
      poseTargetController?.reset();
    },
    setLookPaused(paused: boolean): void {
      lookController?.setPaused(paused);
    },
    startDragPhysics(): void {
      dragPhysicsController?.start();
    },
    sampleDragPhysics(deltaX: number, deltaY: number, timestampMs: number): void {
      dragPhysicsController?.sample(deltaX, deltaY, timestampMs);
    },
    endDragPhysics(): void {
      dragPhysicsController?.end();
    },
    release(): void {
      restoreTemporaryPartOpacities();
      poseTargetController?.reset();
      expressionController.release();
      motionController?.release();
      motionController = null;
      accessoryController = null;
      microExpressionController?.release();
      microExpressionController = null;
      breathController?.release();
      breathController = null;
      userModel.release();
    }
  };
}

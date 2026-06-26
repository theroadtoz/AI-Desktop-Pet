import { contextBridge, ipcRenderer } from "electron";
import type { PetApi, RenderHealth, PetDragDelta, PetFirstFrameInfo } from "../shared/ipc-contract";
import type { PetPresentationIntent, PetRoleState } from "../shared/pet-role-state";
import type { PetScaleAdjustmentIntent } from "../shared/pet-presentation";

const petRoleStates = [
  "idle",
  "listening",
  "thinking",
  "replying",
  "interrupted",
  "error"
] as const;
const emotionTags = ["neutral", "happy", "sad", "surprised", "confused", "angry"] as const;
const emotionIntensities = ["low", "medium", "high"] as const;
const petAccessoryPresetIds = ["none", "glasses"] as const;
const scaleWheelModifierPattern = /^(Ctrl|Alt|Shift|Meta)(\+(Ctrl|Alt|Shift|Meta))*$/;

function isRequestVersion(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isEmotionPresentation(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const expression = value as {
    emotion?: unknown;
    intensity?: unknown;
    mode?: unknown;
  };
  const isEmotion = typeof expression.emotion === "string" && emotionTags.includes(expression.emotion as typeof emotionTags[number]);
  const isIntensity = typeof expression.intensity === "string" &&
    emotionIntensities.includes(expression.intensity as typeof emotionIntensities[number]);
  const emotion = typeof expression.emotion === "string" ? expression.emotion : "";
  const expectedMode = expression.emotion === "neutral"
    ? "neutral"
    : expression.intensity === "high" && ["happy", "sad", "angry", "surprised"].includes(emotion)
      ? "emphasis"
      : "micro";

  return isEmotion && isIntensity && expression.mode === expectedMode;
}

function isPetAccessoryPresetId(value: unknown): boolean {
  return typeof value === "string" && petAccessoryPresetIds.includes(value as (typeof petAccessoryPresetIds)[number]);
}

function isPetPresentationIntent(value: unknown): value is PetPresentationIntent {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const intent = value as Partial<PetPresentationIntent>;
  const requestVersion = intent.requestVersion;

  return Boolean(
    typeof intent.state === "string" &&
    petRoleStates.includes(intent.state as PetRoleState) &&
    (requestVersion === null || (typeof requestVersion === "number" && isRequestVersion(requestVersion))) &&
    (intent.gaze === "ambient" || intent.gaze === "attentive") &&
    (intent.workStatus === "idle" || intent.workStatus === "thinking") &&
    isEmotionPresentation(intent.expression) &&
    isPetAccessoryPresetId(intent.accessoryPresetId) &&
    typeof intent.allowMicroExpression === "boolean" &&
    typeof intent.allowEmphasisExpression === "boolean" &&
    (intent.recovery === "normal" || intent.recovery === "safe-neutral") &&
    (intent.recovery !== "safe-neutral" || intent.expression?.emotion === "neutral")
  );
}

function isScaleWheelModifierAccelerator(value: unknown): value is string {
  if (typeof value !== "string" || !scaleWheelModifierPattern.test(value)) {
    return false;
  }

  const parts = value.split("+");
  return new Set(parts).size === parts.length;
}

const api: PetApi = {
  reportFirstFrame(info: PetFirstFrameInfo) {
    ipcRenderer.send("pet:first-frame", info);
  },
  reportRenderHealth(state: RenderHealth) {
    ipcRenderer.send("pet:health", state);
  },
  reportTelemetry(type: string, payload?: Record<string, unknown>) {
    ipcRenderer.send("pet:telemetry", { type, payload });
  },
  setPointerHit(isHit: boolean) {
    ipcRenderer.send("pet:pointer-hit-change", { isHit });
  },
  presentationReady() {
    ipcRenderer.send("pet:presentation-ready");
  },
  onPresentationIntent(handler) {
    const listener = (_event: Electron.IpcRendererEvent, intent: unknown): void => {
      if (isPetPresentationIntent(intent)) {
        handler(intent);
      }
    };

    ipcRenderer.on("pet:apply-presentation", listener);

    return () => {
      ipcRenderer.removeListener("pet:apply-presentation", listener);
    };
  },
  onInjectWebGLContextLoss(handler: () => void) {
    const listener = (): void => {
      handler();
    };

    ipcRenderer.on("pet:inject-webgl-context-loss", listener);

    return () => {
      ipcRenderer.removeListener("pet:inject-webgl-context-loss", listener);
    };
  },
  openChat() {
    void ipcRenderer.invoke("pet:open-chat");
  },
  startDrag() {
    ipcRenderer.send("pet:drag-start");
  },
  moveDrag(delta: PetDragDelta) {
    ipcRenderer.send("pet:drag-move", delta);
  },
  endDrag() {
    ipcRenderer.send("pet:drag-end");
  },
  adjustScale(intent: PetScaleAdjustmentIntent) {
    if (intent.steps !== -1 && intent.steps !== 1) {
      return;
    }

    ipcRenderer.send("pet:adjust-scale", intent);
  },
  async getScaleWheelModifier() {
    const accelerator = await ipcRenderer.invoke("shortcuts:get-scale-wheel-modifier");

    if (!isScaleWheelModifierAccelerator(accelerator)) {
      throw new Error("Invalid scale wheel modifier response");
    }

    return accelerator;
  },
  onScaleWheelModifierChanged(handler) {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      if (isScaleWheelModifierAccelerator(value)) {
        handler(value);
      }
    };

    ipcRenderer.on("shortcuts:scale-wheel-modifier-changed", listener);
    return () => {
      ipcRenderer.removeListener("shortcuts:scale-wheel-modifier-changed", listener);
    };
  }
};

contextBridge.exposeInMainWorld("petApi", api);

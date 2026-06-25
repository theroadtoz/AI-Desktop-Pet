import type { EmotionTag } from "../../../shared/emotion";

type ExpressionEmotion = Exclude<EmotionTag, "neutral">;

export type ExpressionLoadRequest = Readonly<{
  emotion: ExpressionEmotion;
  version: number;
}>;

export type ExpressionRequestAction =
  | Readonly<{ type: "load"; request: ExpressionLoadRequest }>
  | Readonly<{ type: "clear" }>
  | Readonly<{ type: "none" }>;

export type ExpressionIntentState = Readonly<{
  intent: EmotionTag;
  applied: EmotionTag;
  loading: ExpressionLoadRequest | null;
  isRestoringNeutral: boolean;
  isReleased: boolean;
}>;

/**
 * Coordinates expression intent independently from Cubism loading and playback.
 * A load may only apply if its request version is still the latest intent.
 */
export class ExpressionIntentCoordinator {
  private intent: EmotionTag = "neutral";
  private applied: EmotionTag = "neutral";
  private loading: ExpressionLoadRequest | null = null;
  private isRestoringNeutral = false;
  private isReleased = false;
  private version = 0;

  public request(emotion: EmotionTag): ExpressionRequestAction {
    if (this.isReleased || emotion === this.intent) {
      return { type: "none" };
    }

    this.version += 1;
    this.intent = emotion;

    if (emotion === "neutral") {
      this.loading = null;
      this.applied = "neutral";
      this.isRestoringNeutral = true;
      return { type: "clear" };
    }

    const request = { emotion, version: this.version };
    this.loading = request;
    this.isRestoringNeutral = false;
    return { type: "load", request };
  }

  public completeLoad(request: ExpressionLoadRequest): boolean {
    if (!this.isCurrent(request)) {
      return false;
    }

    this.loading = null;
    this.applied = request.emotion;
    return true;
  }

  public failLoad(request: ExpressionLoadRequest): boolean {
    if (!this.isCurrent(request)) {
      return false;
    }

    this.restoreNeutral();
    return true;
  }

  public failApply(): void {
    if (!this.isReleased) {
      this.restoreNeutral();
    }
  }

  public clear(): void {
    if (!this.isReleased) {
      this.restoreNeutral();
    }
  }

  public release(): void {
    if (this.isReleased) {
      return;
    }

    this.restoreNeutral();
    this.isReleased = true;
  }

  public getState(): ExpressionIntentState {
    return {
      intent: this.intent,
      applied: this.applied,
      loading: this.loading,
      isRestoringNeutral: this.isRestoringNeutral,
      isReleased: this.isReleased
    };
  }

  private isCurrent(request: ExpressionLoadRequest): boolean {
    return !this.isReleased
      && this.intent === request.emotion
      && this.loading?.version === request.version;
  }

  private restoreNeutral(): void {
    this.version += 1;
    this.intent = "neutral";
    this.applied = "neutral";
    this.loading = null;
    this.isRestoringNeutral = true;
  }
}

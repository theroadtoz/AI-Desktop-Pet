import type { EmotionPresentation } from "./emotion-presentation.ts";
import {
  isPetAccessoryResolution,
  resolvePetAccessorySelection,
  type PetAccessoryResolution
} from "./pet-accessory.ts";

export const petRoleStates = [
  "idle",
  "listening",
  "thinking",
  "replying",
  "interrupted",
  "error"
] as const;

export type PetRoleState = (typeof petRoleStates)[number];

export type PetPresentationIntent = Readonly<{
  state: PetRoleState;
  requestVersion: number | null;
  gaze: "ambient" | "attentive";
  workStatus: "idle" | "thinking";
  expression: EmotionPresentation;
  accessorySelection: PetAccessoryResolution;
  allowMicroExpression: boolean;
  allowEmphasisExpression: boolean;
  recovery: "normal" | "safe-neutral";
}>;

export type PetRoleSnapshot = Readonly<{
  state: PetRoleState;
  chatOpen: boolean;
  activeRequestVersion: number | null;
  latestRequestVersion: number;
}>;

export type PetRoleEvent =
  | { type: "chat:opened" }
  | { type: "chat:closed" }
  | { type: "chat:interaction"; active: boolean }
  | { type: "request:started"; requestVersion: number }
  | { type: "reply:delta"; requestVersion: number }
  | { type: "reply:completed"; requestVersion: number; expression: EmotionPresentation }
  | { type: "request:cancelled"; requestVersion: number }
  | { type: "request:failed"; requestVersion: number }
  | { type: "interruption:settled" }
  | { type: "renderer:recovered" }
  | { type: "renderer:failed" };

export type PetRoleTransition = Readonly<{
  accepted: boolean;
  snapshot: PetRoleSnapshot;
  intent: PetPresentationIntent;
}>;

const NEUTRAL_EXPRESSION: EmotionPresentation = {
  emotion: "neutral",
  intensity: "low",
  mode: "neutral"
};

const DEFAULT_ACCESSORY_SELECTION = resolvePetAccessorySelection({ userAccessoryIds: [] });

export const INITIAL_PET_ROLE_SNAPSHOT: PetRoleSnapshot = {
  state: "idle",
  chatOpen: false,
  activeRequestVersion: null,
  latestRequestVersion: 0
};

function isRequestVersion(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isEmotionPresentation(value: unknown): value is EmotionPresentation {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const expression = value as Partial<EmotionPresentation>;
  const isEmotion = typeof expression.emotion === "string" && [
    "neutral", "happy", "sad", "surprised", "confused", "angry"
  ].includes(expression.emotion);
  const isIntensity = typeof expression.intensity === "string" && ["low", "medium", "high"].includes(expression.intensity);
  const expectedMode = expression.emotion === "neutral"
    ? "neutral"
    : expression.intensity === "high" && ["happy", "sad", "angry", "surprised"].includes(expression.emotion ?? "")
      ? "emphasis"
      : "micro";

  return isEmotion && isIntensity && expression.mode === expectedMode;
}

export function createPetPresentationIntent(
  snapshot: PetRoleSnapshot,
  expression: EmotionPresentation = NEUTRAL_EXPRESSION,
  accessorySelection: PetAccessoryResolution = DEFAULT_ACCESSORY_SELECTION
): PetPresentationIntent {
  const recovery = snapshot.state === "error" ? "safe-neutral" : "normal";
  const neutralExpression = recovery === "safe-neutral" ? NEUTRAL_EXPRESSION : expression;
  const hasReplyExpression = neutralExpression.emotion !== "neutral";

  return {
    state: snapshot.state,
    requestVersion: snapshot.activeRequestVersion,
    gaze: snapshot.state === "idle" ? "ambient" : "attentive",
    workStatus: snapshot.state === "thinking" ? "thinking" : "idle",
    expression: neutralExpression,
    accessorySelection,
    allowMicroExpression: snapshot.state === "idle" || snapshot.state === "replying" || hasReplyExpression,
    allowEmphasisExpression: snapshot.state === "idle" || snapshot.state === "replying" || hasReplyExpression,
    recovery
  };
}

function unchanged(snapshot: PetRoleSnapshot): PetRoleTransition {
  return { accepted: false, snapshot, intent: createPetPresentationIntent(snapshot) };
}

function settledState(snapshot: PetRoleSnapshot): PetRoleState {
  return snapshot.chatOpen ? "listening" : "idle";
}

export function isPetPresentationIntent(value: unknown): value is PetPresentationIntent {
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
    isPetAccessoryResolution(intent.accessorySelection) &&
    typeof intent.allowMicroExpression === "boolean" &&
    typeof intent.allowEmphasisExpression === "boolean" &&
    (intent.recovery === "normal" || intent.recovery === "safe-neutral") &&
    (intent.recovery !== "safe-neutral" || intent.expression.emotion === "neutral")
  );
}

export function reducePetRoleState(
  snapshot: PetRoleSnapshot,
  event: PetRoleEvent
): PetRoleTransition {
  if (event.type === "chat:opened") {
    const next: PetRoleSnapshot = {
      ...snapshot,
      chatOpen: true,
      state: snapshot.activeRequestVersion || snapshot.state === "error" ? snapshot.state : "listening"
    };
    return { accepted: true, snapshot: next, intent: createPetPresentationIntent(next) };
  }

  if (event.type === "chat:closed") {
    const next: PetRoleSnapshot = {
      ...snapshot,
      chatOpen: false,
      state: snapshot.activeRequestVersion ? "interrupted" as const : snapshot.state === "error" ? "error" : "idle",
      activeRequestVersion: snapshot.activeRequestVersion ? null : snapshot.activeRequestVersion
    };
    return { accepted: true, snapshot: next, intent: createPetPresentationIntent(next) };
  }

  if (event.type === "chat:interaction") {
    if (snapshot.activeRequestVersion || snapshot.state === "error") {
      return unchanged(snapshot);
    }

    const next = { ...snapshot, state: event.active ? "listening" as const : settledState(snapshot) };
    return { accepted: true, snapshot: next, intent: createPetPresentationIntent(next) };
  }

  if (event.type === "request:started") {
    if (!isRequestVersion(event.requestVersion) || event.requestVersion <= snapshot.latestRequestVersion) {
      return unchanged(snapshot);
    }

    const next: PetRoleSnapshot = {
      ...snapshot,
      state: "thinking",
      activeRequestVersion: event.requestVersion,
      latestRequestVersion: event.requestVersion
    };
    return { accepted: true, snapshot: next, intent: createPetPresentationIntent(next) };
  }

  if (event.type === "reply:delta") {
    if (event.requestVersion !== snapshot.activeRequestVersion) {
      return unchanged(snapshot);
    }

    const next = { ...snapshot, state: "replying" as const };
    return { accepted: true, snapshot: next, intent: createPetPresentationIntent(next) };
  }

  if (event.type === "reply:completed") {
    if (event.requestVersion !== snapshot.activeRequestVersion || !isEmotionPresentation(event.expression)) {
      return unchanged(snapshot);
    }

    const next = { ...snapshot, state: settledState(snapshot), activeRequestVersion: null };
    return { accepted: true, snapshot: next, intent: createPetPresentationIntent(next, event.expression) };
  }

  if (event.type === "request:cancelled") {
    if (event.requestVersion !== snapshot.activeRequestVersion) {
      return unchanged(snapshot);
    }

    const next = { ...snapshot, state: "interrupted" as const, activeRequestVersion: null };
    return { accepted: true, snapshot: next, intent: createPetPresentationIntent(next) };
  }

  if (event.type === "request:failed") {
    if (event.requestVersion !== snapshot.activeRequestVersion) {
      return unchanged(snapshot);
    }

    const next = { ...snapshot, state: "error" as const, activeRequestVersion: null };
    return { accepted: true, snapshot: next, intent: createPetPresentationIntent(next) };
  }

  if (event.type === "interruption:settled") {
    if (snapshot.state !== "interrupted") {
      return unchanged(snapshot);
    }

    const next = { ...snapshot, state: settledState(snapshot) };
    return { accepted: true, snapshot: next, intent: createPetPresentationIntent(next) };
  }

  if (event.type === "renderer:recovered") {
    if (snapshot.state !== "error") {
      return unchanged(snapshot);
    }

    const next = { ...snapshot, state: settledState(snapshot) };
    return { accepted: true, snapshot: next, intent: createPetPresentationIntent(next) };
  }

  const next = { ...snapshot, state: "error" as const, activeRequestVersion: null };
  return { accepted: true, snapshot: next, intent: createPetPresentationIntent(next) };
}

import {
  XITA_AFFECT_INTENSITIES,
  XITA_AFFECT_STATES,
  type XitaAffectIntensity,
  type XitaAffectState
} from "../../../shared/companion-affect.ts";
import type {
  EmotionIntensity,
  EmotionPresentation,
  EmotionTag
} from "../../../shared/emotion.ts";
import type { PetActionTriggerReason } from "../../../shared/pet-action-trigger.ts";
import type { PetPresentationIntent } from "../../../shared/pet-role-state.ts";
import type { AffectDialoguePresentationResolution } from "./affect-dialogue-presentation-resolver.ts";

export const affectDialogueStates = XITA_AFFECT_STATES;
export const affectDialogueIntensities = XITA_AFFECT_INTENSITIES;

export type AffectPresentationReachability =
  | "reachable"
  | "environment-conditional"
  | "intentional-fallback";

export function getEmotionPresentationReachability(
  emotion: EmotionTag,
  intensity: EmotionIntensity
): AffectPresentationReachability {
  return emotion !== "neutral" || intensity === "low" ? "reachable" : "intentional-fallback";
}

export function getXitaPresentationReachability(
  state: XitaAffectState,
  intensity: XitaAffectIntensity
): AffectPresentationReachability {
  if (state === "calm") {
    return intensity !== "high" ? "reachable" : "intentional-fallback";
  }
  if (state === "happy" || state === "concerned" || state === "serious") {
    return intensity !== "high" ? "reachable" : "intentional-fallback";
  }
  if (state === "sleepy") {
    return intensity !== "high" ? "environment-conditional" : "intentional-fallback";
  }
  return "intentional-fallback";
}

export type AffectPresentationCrosswalkInput = Readonly<{
  acceptedAction: Readonly<{ reason: PetActionTriggerReason }> | null;
  actionPending?: boolean;
  emotion: EmotionPresentation;
  xita: AffectDialoguePresentationResolution | null;
}>;

export type AffectPresentationCrosswalkResult =
  | Readonly<{ kind: "action"; reason: PetActionTriggerReason }>
  | Readonly<{
    kind: "expression";
    source: "emotion-tag" | "xita-affect";
    expression: EmotionPresentation;
  }>
  | Readonly<{ kind: "none" }>;

export function selectAffectPresentationCrosswalk(
  input: AffectPresentationCrosswalkInput
): AffectPresentationCrosswalkResult {
  if (input.acceptedAction) {
    return { kind: "action", reason: input.acceptedAction.reason };
  }

  if (input.actionPending) {
    return { kind: "none" };
  }

  if (input.emotion.mode !== "neutral") {
    return {
      kind: "expression",
      source: "emotion-tag",
      expression: input.emotion
    };
  }

  if (input.xita && input.xita.expression.mode !== "neutral") {
    return {
      kind: "expression",
      source: "xita-affect",
      expression: input.xita.expression
    };
  }

  return {
    kind: "expression",
    source: input.xita ? "xita-affect" : "emotion-tag",
    expression: input.xita?.expression ?? input.emotion
  };
}

const NEUTRAL_TERMINAL_EXPRESSION: EmotionPresentation = {
  emotion: "neutral",
  intensity: "low",
  mode: "neutral"
};

export function resolveAffectTerminalPresentationIntent(
  plan: AffectPresentationCrosswalkResult,
  terminalIntent: PetPresentationIntent
): PetPresentationIntent {
  return {
    ...terminalIntent,
    expression: plan.kind === "expression" ? plan.expression : NEUTRAL_TERMINAL_EXPRESSION
  };
}

export function publishAffectTerminalPresentation(
  plan: AffectPresentationCrosswalkResult,
  terminalIntent: PetPresentationIntent,
  publish: (intent: PetPresentationIntent) => void
): PetPresentationIntent {
  const intent = resolveAffectTerminalPresentationIntent(plan, terminalIntent);
  publish(intent);
  return intent;
}

export function isAttentionMicroCueRolloutEnabled(value: string | undefined): boolean {
  return value === undefined || value === "1";
}

export function canStartAttentionMicroCue(input: Readonly<{
  rolloutEnabled: boolean;
  affectEnabled: boolean;
  petReady: boolean;
  petVisible: boolean;
  presentationBusy: boolean;
}>): boolean {
  return input.rolloutEnabled &&
    input.affectEnabled &&
    input.petReady &&
    input.petVisible &&
    !input.presentationBusy;
}

export function canStartAttentionMicroCueSafely(
  readInput: () => Parameters<typeof canStartAttentionMicroCue>[0]
): boolean {
  try {
    return canStartAttentionMicroCue(readInput());
  } catch {
    return false;
  }
}

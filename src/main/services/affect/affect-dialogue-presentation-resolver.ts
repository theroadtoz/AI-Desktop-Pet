import type { EmotionPresentation } from "../../../shared/emotion.ts";
import type { PetActionTriggerReason } from "../../../shared/pet-action-trigger.ts";
import type {
  AffectDialogueContextId,
  XitaAffectIntensity,
  XitaAffectState
} from "../../../shared/companion-affect.ts";

export type AffectDialogueState = XitaAffectState;
export type AffectDialogueIntensity = XitaAffectIntensity;

export type AffectDialoguePresentationInput = Readonly<{
  state: AffectDialogueState;
  intensity: AffectDialogueIntensity;
  hasExplicitEvidence?: boolean;
  isDefaultPresence?: boolean;
  isSleepEligible?: boolean;
}>;

export type AffectDialoguePresentationResolution = Readonly<{
  dialogueContextId?: AffectDialogueContextId;
  expression: EmotionPresentation;
  action: Readonly<{ reason: PetActionTriggerReason }> | null;
  replyAction: "generic" | "affect" | "suppressed";
}>;

const NEUTRAL_EXPRESSION: EmotionPresentation = {
  emotion: "neutral",
  intensity: "low",
  mode: "neutral"
};

const LIGHT_HAPPY_EXPRESSION: EmotionPresentation = {
  emotion: "happy",
  intensity: "low",
  mode: "micro"
};

export function resolveAffectDialoguePresentation(
  input: AffectDialoguePresentationInput
): AffectDialoguePresentationResolution {
  if (input.intensity === "high") {
    return withDialogueContextId(createDialogueContextId(input.state), {
      expression: NEUTRAL_EXPRESSION,
      action: null,
      replyAction: "suppressed"
    });
  }

  if (input.state === "calm") {
    return { expression: NEUTRAL_EXPRESSION, action: null, replyAction: "generic" };
  }

  if (input.state === "happy") {
    const isMedium = input.intensity === "medium";
    return {
      dialogueContextId: createDialogueContextId(input.state)!,
      expression: LIGHT_HAPPY_EXPRESSION,
      action: isMedium ? { reason: "state_idle" } : null,
      replyAction: isMedium ? "affect" : "suppressed"
    };
  }

  if (input.state === "concerned") {
    return {
      dialogueContextId: createDialogueContextId(input.state)!,
      expression: NEUTRAL_EXPRESSION,
      action: { reason: "state_listen" },
      replyAction: "affect"
    };
  }

  if (input.state === "serious") {
    return {
      dialogueContextId: createDialogueContextId(input.state)!,
      expression: NEUTRAL_EXPRESSION,
      action: { reason: "state_think" },
      replyAction: "affect"
    };
  }

  return { expression: NEUTRAL_EXPRESSION, action: null, replyAction: "suppressed" };
}

function withDialogueContextId(
  dialogueContextId: AffectDialogueContextId | undefined,
  presentation: Omit<AffectDialoguePresentationResolution, "dialogueContextId">
): AffectDialoguePresentationResolution {
  return dialogueContextId ? { dialogueContextId, ...presentation } : presentation;
}

function createDialogueContextId(state: AffectDialogueState): AffectDialogueContextId | undefined {
  if (state === "happy") {
    return "warm-positive";
  }

  if (state === "concerned") {
    return "quiet-support";
  }

  if (state === "serious") {
    return "steady-serious";
  }

  return undefined;
}

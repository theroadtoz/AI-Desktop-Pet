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

const LIGHT_CURIOUS_EXPRESSION: EmotionPresentation = {
  emotion: "confused",
  intensity: "low",
  mode: "micro"
};

export function resolveAffectDialoguePresentation(
  input: AffectDialoguePresentationInput
): AffectDialoguePresentationResolution {
  if (input.intensity === "high") {
    return withDialogueContextId(createDialogueContextId(input.state), {
      expression: NEUTRAL_EXPRESSION,
      action: null
    });
  }

  if (input.state === "calm") {
    return { expression: NEUTRAL_EXPRESSION, action: null };
  }

  if (input.state === "happy") {
    return {
      dialogueContextId: createDialogueContextId(input.state)!,
      expression: LIGHT_HAPPY_EXPRESSION,
      action: null
    };
  }

  if (input.state === "curious") {
    return {
      dialogueContextId: createDialogueContextId(input.state)!,
      expression: LIGHT_CURIOUS_EXPRESSION,
      action: { reason: "state_listen" }
    };
  }

  if (input.state === "concerned") {
    return {
      dialogueContextId: createDialogueContextId(input.state)!,
      expression: NEUTRAL_EXPRESSION,
      action: { reason: "state_listen" }
    };
  }

  if (input.state === "serious") {
    return {
      dialogueContextId: createDialogueContextId(input.state)!,
      expression: NEUTRAL_EXPRESSION,
      action: { reason: "state_think" }
    };
  }

  if (input.state === "sleepy") {
    return input.isSleepEligible
      ? {
          dialogueContextId: createDialogueContextId(input.state)!,
          expression: NEUTRAL_EXPRESSION,
          action: { reason: "state_sleep" }
        }
      : { expression: NEUTRAL_EXPRESSION, action: null };
  }

  const isPlayfulOrEmbarrassedActionAllowed = input.hasExplicitEvidence && input.isDefaultPresence;
  return withDialogueContextId(createDialogueContextId(input.state), {
    expression: isPlayfulOrEmbarrassedActionAllowed ? LIGHT_HAPPY_EXPRESSION : NEUTRAL_EXPRESSION,
    action: isPlayfulOrEmbarrassedActionAllowed ? { reason: "state_flustered" } : null
  });
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

  if (state === "curious") {
    return "gentle-curious";
  }

  if (state === "concerned") {
    return "quiet-support";
  }

  if (state === "serious") {
    return "steady-serious";
  }

  if (state === "playful") {
    return "light-playful";
  }

  if (state === "embarrassed") {
    return "gentle-embarrassed";
  }

  if (state === "sleepy") {
    return "slow-sleepy";
  }

  return undefined;
}

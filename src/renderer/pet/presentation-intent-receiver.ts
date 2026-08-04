import type { EmotionPresentation } from "../../shared/emotion-presentation";
import type { PetAccessoryResolution } from "../../shared/pet-accessory";
import type { PetPresentationIntent } from "../../shared/pet-role-state";

export type PetPresentationIntentReceiverDependencies = {
  dataset: DOMStringMap;
  reportAppliedIntent(payload: Record<string, unknown>): void;
  setPersistentAccessorySelection(accessorySelection: PetAccessoryResolution): void;
  setPersistentPresentation(presentation: EmotionPresentation): void;
  getPersistentPresentation(): EmotionPresentation;
  getPersistentAccessorySelection(): PetAccessoryResolution;
  isInteractionActionActive(): boolean;
  applyPresentation(presentation: EmotionPresentation, accessorySelection: PetAccessoryResolution): void;
  boostInteraction(): void;
};

export function applyPetPresentationIntent(
  intent: PetPresentationIntent,
  dependencies: PetPresentationIntentReceiverDependencies
): void {
  const expressionAllowed = intent.expression.mode === "emphasis"
    ? intent.allowEmphasisExpression
    : intent.expression.mode === "micro"
      ? intent.allowMicroExpression
      : true;

  dependencies.dataset.roleState = intent.state;
  dependencies.dataset.workStatus = intent.workStatus;
  dependencies.dataset.expressionEmotion = intent.expression.emotion;
  dependencies.dataset.expressionIntensity = intent.expression.intensity;
  dependencies.dataset.expressionMode = intent.expression.mode;
  dependencies.reportAppliedIntent({
    state: intent.state,
    requestVersion: intent.requestVersion,
    emotion: intent.expression.emotion,
    intensity: intent.expression.intensity,
    mode: intent.expression.mode,
    allowMicroExpression: intent.allowMicroExpression,
    allowEmphasisExpression: intent.allowEmphasisExpression,
    recovery: intent.recovery
  });
  dependencies.setPersistentAccessorySelection(intent.accessorySelection);

  if (expressionAllowed) {
    dependencies.setPersistentPresentation(intent.expression);
  }

  if (!dependencies.isInteractionActionActive()) {
    dependencies.applyPresentation(
      dependencies.getPersistentPresentation(),
      dependencies.getPersistentAccessorySelection()
    );
  }

  dependencies.boostInteraction();
}

import type {
  UserAffectClassifier,
  UserAffectClassifierResult
} from "./perceived-user-affect.ts";

export type UserAffectClassificationIdentity = Readonly<{
  requestVersion: number;
  conversationId: string;
  epoch: number;
}>;

export type BackgroundUserAffectClassificationRunner = {
  beginRequest(requestVersion: number, conversationId: string): UserAffectClassificationIdentity;
  start(input: {
    identity: UserAffectClassificationIdentity;
    text: string;
    onResult(result: UserAffectClassifierResult): void;
    onFailure?(): void;
  }): boolean;
  invalidate(): void;
};

export function createBackgroundUserAffectClassificationRunner({
  classifier
}: {
  classifier: UserAffectClassifier;
}): BackgroundUserAffectClassificationRunner {
  let epoch = 0;
  let active: {
    identity: UserAffectClassificationIdentity;
    controller: AbortController;
  } | null = null;

  function invalidate(): void {
    epoch += 1;
    active?.controller.abort();
    active = null;
  }

  function isActive(
    identity: UserAffectClassificationIdentity,
    controller: AbortController
  ): boolean {
    return !controller.signal.aborted &&
      epoch === identity.epoch &&
      active?.identity.epoch === identity.epoch &&
      active.identity.requestVersion === identity.requestVersion &&
      active.identity.conversationId === identity.conversationId &&
      active.controller === controller;
  }

  return {
    beginRequest(requestVersion, conversationId) {
      invalidate();
      return { requestVersion, conversationId, epoch };
    },
    start({ identity, text, onResult, onFailure }) {
      if (
        identity.epoch !== epoch ||
        !Number.isSafeInteger(identity.requestVersion) ||
        typeof identity.conversationId !== "string" ||
        identity.conversationId.length === 0 ||
        active !== null
      ) {
        return false;
      }

      const controller = new AbortController();
      active = { identity, controller };
      void Promise.resolve()
        .then(() => {
          if (!isActive(identity, controller)) {
            return null;
          }
          return classifier.classify({ text, signal: controller.signal });
        })
        .then((result) => {
          if (result && isActive(identity, controller)) {
            onResult(result);
          }
        })
        .catch(() => {
          if (isActive(identity, controller)) {
            onFailure?.();
          }
        })
        .finally(() => {
          if (isActive(identity, controller)) {
            active = null;
          }
        });
      return true;
    },
    invalidate
  };
}

import type {
  PetActionTriggerReason,
  PetActionTriggerSupersessionPolicy,
  PetActionTriggerPayload
} from "../../shared/pet-action-trigger.ts";

const DEFAULT_TTL_MS = 30_000;
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;
const RECENT_REQUEST_ID_LIMIT = 256;

export type PetActionDispatchTrigger = PetActionTriggerPayload & { requestId: string };

export type PetActionDispatchPolicy = {
  ttlMs?: number;
  supersessionPolicy?: PetActionTriggerSupersessionPolicy;
};

export type PetActionDispatchDependencies = {
  send(trigger: PetActionDispatchTrigger): void;
  now(): number;
  createRequestId(): string;
};

export type PetActionDispatchResult =
  | { accepted: true; requestId: string }
  | {
      accepted: false;
      reason:
        | "busy"
        | "invalid_policy"
        | "unsafe_request_id"
        | "duplicate_request_id"
        | "request_id_failed"
        | "send_failed";
    };

export type PetActionLifecycle = {
  status: "started" | "finished" | "skipped";
  reason: string;
  requestId?: string;
  actionInstanceId?: string;
};

export type PetActionLifecycleResult =
  | "main_started"
  | "main_terminal"
  | "local_started"
  | "local_terminal"
  | "ignored";

export type PetActionDispatchCoordinator = {
  dispatch(reason: PetActionTriggerReason, policy?: PetActionDispatchPolicy): PetActionDispatchResult;
  onLifecycle(lifecycle: PetActionLifecycle): PetActionLifecycleResult;
  getState(): PetActionDispatchState;
  isBusy(): boolean;
  cancel(requestId: string): boolean;
  cancelActive(): boolean;
  reset(): boolean;
  expire(requestId?: string): boolean;
};

type MainRequest = {
  requestId: string;
  reason: PetActionTriggerReason;
  expiresAtMs: number;
};

export type PetActionDispatchState = {
  activeMainRequest: Readonly<Pick<MainRequest, "requestId" | "reason">> | null;
  localBusyReason: string | null;
  busy: boolean;
};

type LocalAction = {
  actionInstanceId: string;
  reason: string;
};

export function createPetActionDispatchCoordinator(
  dependencies: PetActionDispatchDependencies
): PetActionDispatchCoordinator {
  let activeRequest: MainRequest | null = null;
  let localAction: LocalAction | null = null;
  const knownRequestIds = new Set<string>();
  const knownRequestIdOrder: string[] = [];

  function currentNow(): number {
    const timestampMs = dependencies.now();
    return Number.isFinite(timestampMs) ? timestampMs : 0;
  }

  function clearExpiredRequest(): boolean {
    if (!activeRequest || currentNow() < activeRequest.expiresAtMs) {
      return false;
    }

    activeRequest = null;
    return true;
  }

  function rememberRequestId(requestId: string): void {
    knownRequestIds.add(requestId);
    knownRequestIdOrder.push(requestId);
    while (knownRequestIdOrder.length > RECENT_REQUEST_ID_LIMIT) {
      const expiredRequestId = knownRequestIdOrder.shift();
      if (expiredRequestId !== undefined) {
        knownRequestIds.delete(expiredRequestId);
      }
    }
  }

  function expire(requestId?: string): boolean {
    if (requestId !== undefined) {
      if (!activeRequest || activeRequest.requestId !== requestId) {
        return false;
      }
      activeRequest = null;
      return true;
    }

    return clearExpiredRequest();
  }

  function cancelActive(): boolean {
    const hadActiveAction = activeRequest !== null || localAction !== null;
    activeRequest = null;
    localAction = null;
    return hadActiveAction;
  }

  function dispatch(reason: PetActionTriggerReason, policy: PetActionDispatchPolicy = {}): PetActionDispatchResult {
    const ttlMs = policy.ttlMs ?? DEFAULT_TTL_MS;
    if (
      !Number.isFinite(ttlMs) ||
      ttlMs <= 0 ||
      (policy.supersessionPolicy !== undefined &&
        (reason !== "chat_opened" || policy.supersessionPolicy !== "replace_active"))
    ) {
      return { accepted: false, reason: "invalid_policy" };
    }

    clearExpiredRequest();
    if (activeRequest || localAction !== null) {
      return { accepted: false, reason: "busy" };
    }

    let requestId: string;
    try {
      requestId = dependencies.createRequestId();
    } catch {
      return { accepted: false, reason: "request_id_failed" };
    }
    if (typeof requestId !== "string" || !SAFE_REQUEST_ID.test(requestId)) {
      return { accepted: false, reason: "unsafe_request_id" };
    }
    if (knownRequestIds.has(requestId)) {
      return { accepted: false, reason: "duplicate_request_id" };
    }

    const request: MainRequest = {
      requestId,
      reason,
      expiresAtMs: currentNow() + ttlMs
    };
    rememberRequestId(requestId);
    activeRequest = request;
    try {
      dependencies.send({
        reason,
        requestId,
        ...(policy.supersessionPolicy ? { supersessionPolicy: policy.supersessionPolicy } : {})
      });
    } catch {
      activeRequest = null;
      return { accepted: false, reason: "send_failed" };
    }

    return { accepted: true, requestId };
  }

  function getState(): PetActionDispatchState {
    clearExpiredRequest();
    return {
      activeMainRequest: activeRequest
        ? { requestId: activeRequest.requestId, reason: activeRequest.reason }
        : null,
      localBusyReason: localAction?.reason ?? null,
      busy: activeRequest !== null || localAction !== null
    };
  }

  function onLifecycle(lifecycle: PetActionLifecycle): PetActionLifecycleResult {
    clearExpiredRequest();
    if (lifecycle.requestId === undefined) {
      if (lifecycle.actionInstanceId === undefined) {
        return "ignored";
      }
      if (lifecycle.status === "started") {
        localAction = {
          actionInstanceId: lifecycle.actionInstanceId,
          reason: lifecycle.reason
        };
        return "local_started";
      }

      if (
        lifecycle.status === "finished" &&
        localAction?.reason === lifecycle.reason &&
        localAction.actionInstanceId === lifecycle.actionInstanceId
      ) {
        localAction = null;
        return "local_terminal";
      }

      return "ignored";
    }

    if (
      !activeRequest ||
      activeRequest.requestId !== lifecycle.requestId ||
      activeRequest.reason !== lifecycle.reason
    ) {
      return "ignored";
    }

    if (lifecycle.status === "started") {
      return "main_started";
    }

    activeRequest = null;
    return "main_terminal";
  }

  return {
    dispatch,
    onLifecycle,
    getState,
    isBusy() {
      return getState().busy;
    },
    cancel(requestId) {
      clearExpiredRequest();
      if (!activeRequest || activeRequest.requestId !== requestId) {
        return false;
      }
      activeRequest = null;
      return true;
    },
    cancelActive,
    reset: cancelActive,
    expire
  };
}

import assert from "node:assert/strict";
import test from "node:test";
import {
  createPetActionDispatchCoordinator,
  type PetActionDispatchTrigger
} from "../src/main/services/pet-action-dispatch-coordinator.ts";

function createHarness(options: { createRequestId?: () => string } = {}) {
  let nowMs = 1_000;
  let sequence = 0;
  const sent: PetActionDispatchTrigger[] = [];
  const coordinator = createPetActionDispatchCoordinator({
    send(trigger) {
      sent.push(trigger);
    },
    now: () => nowMs,
    createRequestId: options.createRequestId ?? (() => `request_${++sequence}`)
  });

  return {
    coordinator,
    sent,
    setNow(value: number) {
      nowMs = value;
    }
  };
}

test("consecutive requests with the same reason cannot cross-wire lifecycle", () => {
  const { coordinator, sent } = createHarness();
  const first = coordinator.dispatch("chat_opened");
  assert.equal(first.accepted, true);
  if (!first.accepted) return;

  assert.equal(coordinator.onLifecycle({ status: "started", reason: "chat_opened", requestId: first.requestId }), "main_started");
  const secondWhileBusy = coordinator.dispatch("chat_opened");
  assert.deepEqual(secondWhileBusy, { accepted: false, reason: "busy" });

  assert.equal(coordinator.onLifecycle({ status: "finished", reason: "chat_opened", requestId: first.requestId }), "main_terminal");
  assert.equal(coordinator.isBusy(), false);
  const second = coordinator.dispatch("chat_opened");
  assert.equal(second.accepted, true);
  if (!second.accepted) return;
  assert.deepEqual(sent.map(({ reason, requestId }) => ({ reason, requestId })), [
    { reason: "chat_opened", requestId: first.requestId },
    { reason: "chat_opened", requestId: second.requestId }
  ]);
});

test("stale lifecycle is ignored after cancellation and a new request", () => {
  const { coordinator } = createHarness();
  const first = coordinator.dispatch("state_think");
  assert.equal(first.accepted, true);
  if (!first.accepted) return;
  assert.equal(coordinator.cancel(first.requestId), true);

  const second = coordinator.dispatch("state_think");
  assert.equal(second.accepted, true);
  if (!second.accepted) return;
  assert.equal(coordinator.onLifecycle({ status: "finished", reason: "state_think", requestId: first.requestId }), "ignored");
  assert.equal(coordinator.isBusy(), true);
  assert.equal(coordinator.onLifecycle({ status: "finished", reason: "state_think", requestId: second.requestId }), "main_terminal");
});

test("renderer-local lifecycle only changes local busy and never completes a main request", () => {
  const { coordinator } = createHarness();
  assert.equal(coordinator.onLifecycle({ status: "started", reason: "state_greet", actionInstanceId: "local_1" }), "local_started");
  assert.deepEqual(coordinator.dispatch("state_work"), { accepted: false, reason: "busy" });
  assert.equal(coordinator.onLifecycle({ status: "finished", reason: "state_greet", actionInstanceId: "local_1" }), "local_terminal");

  const mainRequest = coordinator.dispatch("chat_reply_waiting");
  assert.equal(mainRequest.accepted, true);
  if (!mainRequest.accepted) return;

  assert.equal(coordinator.onLifecycle({ status: "started", reason: "state_greet", actionInstanceId: "local_2" }), "local_started");
  assert.equal(coordinator.isBusy(), true);
  assert.equal(coordinator.onLifecycle({ status: "finished", reason: "state_greet", actionInstanceId: "local_2" }), "local_terminal");
  assert.equal(coordinator.isBusy(), true);
  assert.equal(coordinator.onLifecycle({ status: "finished", reason: "chat_reply_waiting", requestId: mainRequest.requestId }), "main_terminal");
  assert.equal(coordinator.isBusy(), false);
});

test("stale renderer-local terminal from a different reason does not clear local busy", () => {
  const { coordinator } = createHarness();

  assert.equal(coordinator.onLifecycle({ status: "started", reason: "state_work", actionInstanceId: "local_work" }), "local_started");
  assert.equal(coordinator.isBusy(), true);
  assert.equal(coordinator.onLifecycle({ status: "finished", reason: "state_greet", actionInstanceId: "local_other" }), "ignored");
  assert.equal(coordinator.isBusy(), true);
  assert.equal(coordinator.onLifecycle({ status: "finished", reason: "state_work", actionInstanceId: "local_work" }), "local_terminal");
  assert.equal(coordinator.isBusy(), false);
});

test("renderer-local skipped attempt with the same reason cannot clear the active local instance", () => {
  const { coordinator } = createHarness();

  assert.equal(coordinator.onLifecycle({
    status: "started",
    reason: "click_body",
    actionInstanceId: "local_active"
  }), "local_started");
  assert.equal(coordinator.onLifecycle({
    status: "skipped",
    reason: "click_body",
    actionInstanceId: "local_skipped"
  }), "ignored");
  assert.equal(coordinator.isBusy(), true);
  assert.equal(coordinator.onLifecycle({
    status: "finished",
    reason: "click_body",
    actionInstanceId: "local_active"
  }), "local_terminal");
  assert.equal(coordinator.isBusy(), false);
});

test("cancel and TTL expiration release main busy", () => {
  const { coordinator, setNow } = createHarness();
  const cancelled = coordinator.dispatch("state_work");
  assert.equal(cancelled.accepted, true);
  if (!cancelled.accepted) return;
  assert.equal(coordinator.cancel(cancelled.requestId), true);
  assert.equal(coordinator.isBusy(), false);

  const expiring = coordinator.dispatch("state_read", { ttlMs: 50 });
  assert.equal(expiring.accepted, true);
  if (!expiring.accepted) return;
  setNow(1_050);
  assert.deepEqual(coordinator.getState(), {
    activeMainRequest: null,
    localBusyReason: null,
    busy: false
  });
  assert.equal(coordinator.expire(), false);
  assert.equal(coordinator.onLifecycle({ status: "finished", reason: "state_read", requestId: expiring.requestId }), "ignored");
});

test("chat supersession is a closed policy and is forwarded only for chat open", () => {
  const { coordinator, sent } = createHarness();

  assert.deepEqual(
    coordinator.dispatch("state_work", { supersessionPolicy: "replace_active" }),
    { accepted: false, reason: "invalid_policy" }
  );
  const chatOpened = coordinator.dispatch("chat_opened", { supersessionPolicy: "replace_active" });
  assert.equal(chatOpened.accepted, true);
  if (!chatOpened.accepted) return;
  assert.deepEqual(sent, [{
    reason: "chat_opened",
    requestId: chatOpened.requestId,
    supersessionPolicy: "replace_active"
  }]);
});

test("recent request id tombstones stay bounded", () => {
  let nextRequestId = "request_1";
  const { coordinator } = createHarness({ createRequestId: () => nextRequestId });

  for (let index = 1; index <= 257; index += 1) {
    nextRequestId = `request_${index}`;
    const result = coordinator.dispatch("state_idle");
    assert.equal(result.accepted, true);
    if (!result.accepted) return;
    assert.equal(coordinator.cancel(result.requestId), true);
  }

  nextRequestId = "request_257";
  assert.deepEqual(coordinator.dispatch("state_idle"), {
    accepted: false,
    reason: "duplicate_request_id"
  });
  nextRequestId = "request_1";
  assert.equal(coordinator.dispatch("state_idle").accepted, true);
});

test("reset clears main and local busy so stale terminals cannot block a new request", () => {
  const { coordinator } = createHarness();
  const first = coordinator.dispatch("state_work");
  assert.equal(first.accepted, true);
  if (!first.accepted) return;

  assert.equal(coordinator.onLifecycle({ status: "started", reason: "click_head", actionInstanceId: "local_click_1" }), "local_started");
  assert.equal(coordinator.reset(), true);
  assert.equal(coordinator.isBusy(), false);
  assert.equal(coordinator.onLifecycle({ status: "finished", reason: "state_work", requestId: first.requestId }), "ignored");
  assert.equal(coordinator.onLifecycle({ status: "finished", reason: "click_head", actionInstanceId: "local_click_1" }), "ignored");

  const replacement = coordinator.dispatch("state_greet");
  assert.equal(replacement.accepted, true);
  assert.equal(coordinator.cancelActive(), true);
  assert.equal(coordinator.isBusy(), false);
});

test("chat open reset ignores stale lifecycle while the replacement request remains active", () => {
  const { coordinator } = createHarness();
  const displaced = coordinator.dispatch("state_work");
  assert.equal(displaced.accepted, true);
  if (!displaced.accepted) return;

  assert.equal(coordinator.onLifecycle({ status: "started", reason: "click_head", actionInstanceId: "local_click_2" }), "local_started");
  assert.equal(coordinator.reset(), true);

  const chatOpened = coordinator.dispatch("chat_opened");
  assert.equal(chatOpened.accepted, true);
  if (!chatOpened.accepted) return;

  assert.equal(
    coordinator.onLifecycle({ status: "finished", reason: "state_work", requestId: displaced.requestId }),
    "ignored"
  );
  assert.equal(coordinator.onLifecycle({ status: "finished", reason: "click_head", actionInstanceId: "local_click_2" }), "ignored");
  assert.equal(coordinator.isBusy(), true);
  assert.equal(
    coordinator.onLifecycle({ status: "finished", reason: "chat_opened", requestId: chatOpened.requestId }),
    "main_terminal"
  );
  assert.equal(coordinator.isBusy(), false);
});

test("send runs once for an accepted request and not for a busy rejection", () => {
  const { coordinator, sent } = createHarness();
  const accepted = coordinator.dispatch("state_idle");
  const rejected = coordinator.dispatch("state_greet");
  assert.equal(accepted.accepted, true);
  assert.deepEqual(rejected, { accepted: false, reason: "busy" });
  assert.equal(sent.length, 1);
});

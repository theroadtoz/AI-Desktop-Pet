import assert from "node:assert/strict";
import test from "node:test";

import { CdpClient } from "./real-ui-harness.mjs";

type SocketListener = (event: any) => void;

class FakeSocket {
  static instance: FakeSocket;

  listeners = new Map<string, Set<SocketListener>>();
  sent: string[] = [];

  constructor(_url: string) {
    FakeSocket.instance = this;
    queueMicrotask(() => this.emit("open", {}));
  }

  addEventListener(type: string, listener: SocketListener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send(serialized: string) {
    this.sent.push(serialized);
  }

  close() {
    this.emit("close", {});
  }

  emit(type: string, event: any) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

async function openClient() {
  (globalThis as any).WebSocket = FakeSocket;
  const client = new CdpClient("ws://cdp.test");
  await client.open();
  return { client, socket: FakeSocket.instance };
}

test("CdpClient dispatches CDP events to method listeners", async () => {
  const { client, socket } = await openClient();
  const received: unknown[] = [];
  client.on("Runtime.consoleAPICalled", (params) => received.push(params));

  socket.emit("message", {
    data: JSON.stringify({
      method: "Runtime.consoleAPICalled",
      params: { type: "log" }
    })
  });

  assert.deepEqual(received, [{ type: "log" }]);
  client.close();
});

test("CdpClient supports unsubscribe and off for event listeners", async () => {
  const { client, socket } = await openClient();
  let firstCalls = 0;
  let secondCalls = 0;
  const first = () => { firstCalls += 1; };
  const second = () => { secondCalls += 1; };
  const unsubscribe = client.on("Page.loadEventFired", first);
  client.on("Page.loadEventFired", second);

  unsubscribe();
  client.off("Page.loadEventFired", second);
  socket.emit("message", {
    data: JSON.stringify({ method: "Page.loadEventFired", params: { timestamp: 1 } })
  });

  assert.equal(firstCalls, 0);
  assert.equal(secondCalls, 0);
  client.close();
});

test("CdpClient does not dispatch response messages as events", async () => {
  const { client, socket } = await openClient();
  let eventCalls = 0;
  client.on("Runtime.evaluate", () => { eventCalls += 1; });

  const response = client.send("Runtime.evaluate", { expression: "1 + 1" });
  const request = JSON.parse(socket.sent[0]);
  socket.emit("message", {
    data: JSON.stringify({
      id: request.id,
      method: "Runtime.evaluate",
      params: { unexpected: true },
      result: { value: 2 }
    })
  });

  assert.deepEqual(await response, { value: 2 });
  assert.equal(eventCalls, 0);
  client.close();
});

test("CdpClient isolates listener exceptions", async () => {
  const { client, socket } = await openClient();
  let calls = 0;
  client.on("Runtime.bindingCalled", () => { throw new Error("listener failed"); });
  client.on("Runtime.bindingCalled", () => { calls += 1; });

  socket.emit("message", {
    data: JSON.stringify({ method: "Runtime.bindingCalled", params: { name: "test" } })
  });

  assert.equal(calls, 1);
  client.close();
});

test("CdpClient rejects pending sends and clears listeners when the socket closes", async () => {
  const { client, socket } = await openClient();
  let eventCalls = 0;
  client.on("Page.frameStoppedLoading", () => { eventCalls += 1; });
  const pending = client.send("Page.captureScreenshot");

  socket.emit("close", {});
  await assert.rejects(pending, /CDP socket closed/);
  socket.emit("message", {
    data: JSON.stringify({ method: "Page.frameStoppedLoading", params: {} })
  });

  assert.equal(eventCalls, 0);
});

test("CdpClient rejects pending sends and clears listeners on socket errors", async () => {
  const { client, socket } = await openClient();
  let eventCalls = 0;
  client.on("Inspector.detached", () => { eventCalls += 1; });
  const pending = client.send("Runtime.getIsolateId");

  socket.emit("error", { error: new Error("transport failed") });
  await assert.rejects(pending, /transport failed/);
  socket.emit("message", {
    data: JSON.stringify({ method: "Inspector.detached", params: {} })
  });

  assert.equal(eventCalls, 0);
});

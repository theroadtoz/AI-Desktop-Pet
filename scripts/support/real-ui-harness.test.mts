import assert from "node:assert/strict";
import test from "node:test";

import { CdpClient, CdpClientError, waitForChildExit } from "./real-ui-harness.mjs";

type SocketListener = (event: any) => void;

class FakeSocket {
  static instance: FakeSocket;
  static nextInitialEvent: "open" | "close" | "error" | "none" = "open";
  static nextSendThrows = false;

  listeners = new Map<string, Set<SocketListener>>();
  sent: string[] = [];
  closeCalls = 0;

  constructor(_url: string) {
    FakeSocket.instance = this;
    const initialEvent = FakeSocket.nextInitialEvent;
    FakeSocket.nextInitialEvent = "open";
    if (initialEvent !== "none") {
      queueMicrotask(() => this.emit(initialEvent, {}));
    }
  }

  addEventListener(type: string, listener: SocketListener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send(serialized: string) {
    if (FakeSocket.nextSendThrows) {
      FakeSocket.nextSendThrows = false;
      throw new Error("secret transport detail");
    }
    this.sent.push(serialized);
  }

  close() {
    this.closeCalls += 1;
    this.emit("close", {});
  }

  emit(type: string, event: any) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

function assertCdpError(error: unknown, code: string) {
  assert.equal(error instanceof CdpClientError, true);
  assert.equal((error as CdpClientError).code, code);
  assert.equal(JSON.stringify(error).includes("secret"), false);
}

test("CdpClient rejects open when the session closes before open", async () => {
  (globalThis as any).WebSocket = FakeSocket;
  FakeSocket.nextInitialEvent = "close";
  const client = new CdpClient("ws://cdp.test");
  await assert.rejects(client.open(), (error) => {
    assert.equal(error instanceof CdpClientError, true);
    assert.equal((error as CdpClientError).code, "session_closed");
    assert.equal(JSON.stringify(error).includes("ws://"), false);
    return true;
  });
});

test("CdpClient rejects open when transport errors before open", async () => {
  (globalThis as any).WebSocket = FakeSocket;
  FakeSocket.nextInitialEvent = "error";
  const client = new CdpClient("ws://cdp.test");
  await assert.rejects(client.open(), (error) => {
    assertCdpError(error, "transport_error");
    return true;
  });
});

test("CdpClient bounds an open with no event by its supplied deadline and closes", async () => {
  (globalThis as any).WebSocket = FakeSocket;
  FakeSocket.nextInitialEvent = "none";
  const client = new CdpClient("ws://cdp.test");
  const startedAt = Date.now();
  await assert.rejects(client.open(10), (error) => {
    assertCdpError(error, "command_timeout");
    return true;
  });
  assert.equal(Date.now() - startedAt < 1_000, true);
  assert.equal(FakeSocket.instance.closeCalls, 1);
  assert.equal(client.pending.size, 0);
});

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
  const pending = client.send("Runtime.enable");

  socket.emit("close", {});
  await assert.rejects(pending, (error) => {
    assertCdpError(error, "session_closed");
    return true;
  });
  socket.emit("message", {
    data: JSON.stringify({ method: "Page.frameStoppedLoading", params: {} })
  });

  assert.equal(eventCalls, 0);
});

test("CdpClient rejects pending sends and clears listeners on socket errors", async () => {
  const { client, socket } = await openClient();
  let eventCalls = 0;
  client.on("Inspector.detached", () => { eventCalls += 1; });
  const pending = client.send("Runtime.enable");

  socket.emit("error", { error: new Error("transport failed") });
  await assert.rejects(pending, (error) => {
    assertCdpError(error, "transport_error");
    return true;
  });
  socket.emit("message", {
    data: JSON.stringify({ method: "Inspector.detached", params: {} })
  });

  assert.equal(eventCalls, 0);
});

test("CdpClient classifies Runtime.enable protocol errors without serializing CDP text", async () => {
  const { client, socket } = await openClient();
  const pending = client.send("Runtime.enable");
  const request = JSON.parse(socket.sent[0]);
  socket.emit("message", {
    data: JSON.stringify({ id: request.id, error: { message: "Target closed: secret" } })
  });
  await assert.rejects(pending, (error) => {
    assertCdpError(error, "protocol_error");
    return true;
  });
});

test("CdpClient classifies Runtime.enable command timeouts", async () => {
  const { client, socket } = await openClient();
  client.commandTimeoutMs = 0;
  await assert.rejects(client.send("Runtime.enable"), (error) => {
    assertCdpError(error, "command_timeout");
    return true;
  });
  assert.equal(socket.closeCalls, 1);
  assert.equal(client.pending.size, 0);
  assert.equal(client.listeners.size, 0);
});

test("CdpClient uses the supplied remaining deadline for Runtime.enable", async () => {
  const { client } = await openClient();
  client.commandTimeoutMs = 500;
  const startedAt = Date.now();
  await assert.rejects(client.send("Runtime.enable", {}, 10), (error) => {
    assertCdpError(error, "command_timeout");
    return true;
  });
  assert.equal(Date.now() - startedAt < 200, true);
  assert.equal(client.pending.size, 0);
});

test("CdpClient classifies synchronous Runtime.enable send errors", async () => {
  const { client } = await openClient();
  FakeSocket.nextSendThrows = true;
  await assert.rejects(client.send("Runtime.enable"), (error) => {
    assertCdpError(error, "transport_error");
    return true;
  });
});

test("waitForChildExit waits for the owned Electron child close event", async () => {
  const listeners = new Map<string, Set<(...args: any[]) => void>>();
  const child = {
    exitCode: null,
    signalCode: null,
    once(event: string, listener: (...args: any[]) => void) {
      const eventListeners = listeners.get(event) ?? new Set();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
    }
  };

  const waiting = waitForChildExit(child, 100);
  let resolved = false;
  void waiting.then(() => { resolved = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(resolved, false);

  child.exitCode = 0;
  for (const listener of listeners.get("close") ?? []) {
    listener(0, null);
  }

  await waiting;
  assert.equal(resolved, true);
});

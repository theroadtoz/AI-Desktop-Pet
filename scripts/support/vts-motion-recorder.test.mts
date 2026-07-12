import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { join, parse } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  createNodeWebSocketAdapter,
  inspectVts,
  recordVtsMotion,
  resolveDraftOutputPath,
  VtsRecorderError,
  vtsUrl,
  writeMotionDraft,
  YAWN_SEMANTIC_GESTURE_ALLOWLIST,
  type RecorderRuntime,
  type TokenStore,
  type VtsRequestAdapter,
  type VtsResponse
} from "./vts-motion-recorder.mts";
import { parseMotion3Segments } from "./motion3-canonicalizer.mts";

function parameters(sample = 0) {
  return [
    ...YAWN_SEMANTIC_GESTURE_ALLOWLIST.map((name, index) => ({
      name,
      value: Math.min(1, sample * 0.01 * (index + 1)),
      min: -1,
      max: 1,
      defaultValue: 0
    })),
    { name: "ParamPhysicsOutput", value: 0.75, min: 0, max: 1, defaultValue: 0 }
  ];
}

class FakeVts implements VtsRequestAdapter {
  readonly mode: "ok" | "auth-denied" | "no-model" | "model-switch" | "timeout";
  inFlight = 0;
  maxInFlight = 0;
  parameterRequestCount = 0;
  readonly requests: Array<{ messageType: string; data?: Record<string, unknown>; timeoutMs?: number }> = [];
  timestamp = 1_000;

  constructor(mode: "ok" | "auth-denied" | "no-model" | "model-switch" | "timeout" = "ok") {
    this.mode = mode;
  }

  async request(messageType: string, data?: Record<string, unknown>, timeoutMs?: number): Promise<VtsResponse> {
    this.requests.push({ messageType, data, timeoutMs });
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      await Promise.resolve();
      if (this.mode === "timeout" && messageType === "Live2DParameterListRequest" && this.parameterRequestCount > 0) {
        throw new VtsRecorderError("request-timeout");
      }
      const responseData = this.responseData(messageType, data);
      return {
        requestID: `fake-${this.timestamp}`,
        messageType: messageType.replace(/Request$/, "Response"),
        timestamp: this.timestamp++,
        data: responseData
      };
    } finally {
      this.inFlight -= 1;
    }
  }

  private responseData(messageType: string, data?: Record<string, unknown>): Record<string, unknown> {
    if (messageType === "APIStateRequest") return { active: true, currentSessionAuthenticated: false };
    if (messageType === "AuthenticationTokenRequest") return { authenticationToken: "secret-test-token" };
    if (messageType === "AuthenticationRequest") {
      return {
        authenticated: this.mode !== "auth-denied" && data?.authenticationToken === "secret-test-token"
      };
    }
    if (messageType === "CurrentModelRequest") {
      return this.mode === "no-model" ? { modelLoaded: false, modelID: "" } : { modelLoaded: true, modelID: "model-a" };
    }
    if (messageType === "Live2DParameterListRequest") {
      const sample = this.parameterRequestCount++;
      return {
        modelLoaded: true,
        modelID: this.mode === "model-switch" && sample > 0 ? "model-b" : "model-a",
        parameters: parameters(sample)
      };
    }
    throw new Error(`unexpected request: ${messageType}`);
  }
}

function tokenStore(backing: { token?: string }, operations: string[] = []): TokenStore {
  return {
    async load() {
      operations.push("load");
      return backing.token;
    },
    async save(token: string) {
      operations.push("save");
      backing.token = token;
    },
    async remove() {
      operations.push("remove");
      delete backing.token;
    }
  };
}

function instantRuntime(): RecorderRuntime {
  let now = 0;
  return {
    now: () => now,
    sleep: async (milliseconds) => { now += milliseconds; },
    confirmStart: async () => true
  };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof VtsRecorderError && error.code === code);
}

test("inspect follows API state, token, auth, current-model, and parameter-list flow", async () => {
  const fake = new FakeVts();
  assert.deepEqual(await inspectVts(fake), {
    apiActive: true,
    authenticated: true,
    modelLoaded: true,
    parameterCount: 10,
    semanticParameterCount: 9
  });
  assert.deepEqual(fake.requests.map(({ messageType }) => messageType), [
    "APIStateRequest",
    "AuthenticationTokenRequest",
    "AuthenticationRequest",
    "CurrentModelRequest",
    "Live2DParameterListRequest"
  ]);
  assert.deepEqual(fake.requests.map(({ timeoutMs }) => timeoutMs), [
    3_000,
    180_000,
    3_000,
    3_000,
    3_000
  ]);
  const authenticationRequests = fake.requests.filter(({ messageType }) =>
    messageType === "AuthenticationTokenRequest" || messageType === "AuthenticationRequest"
  );
  assert.equal(authenticationRequests.length, 2);
  assert.equal(authenticationRequests.every(({ data }) =>
    data?.pluginName === "AI Desktop Pet Motion Recorder v3" &&
    data?.pluginDeveloper === "AI Desktop Pet"
  ), true);
});

test("inspect maps request timeouts to the session stage without waiting", async () => {
  const sensitiveTimeoutMessage = "request-timeout token=secret data=values path=C:\\private\\token";
  const stages = [
    ["APIStateRequest", "api-state-timeout"],
    ["AuthenticationTokenRequest", "authentication-token-timeout"],
    ["AuthenticationRequest", "authentication-timeout"],
    ["CurrentModelRequest", "current-model-timeout"],
    ["Live2DParameterListRequest", "parameter-list-timeout"]
  ] as const;

  for (const [timedOutRequest, expectedCode] of stages) {
    const fake = new FakeVts();
    const request = fake.request.bind(fake);
    fake.request = async (messageType, data, timeoutMs) => {
      if (messageType === timedOutRequest) {
        throw new VtsRecorderError("request-timeout", sensitiveTimeoutMessage);
      }
      return await request(messageType, data, timeoutMs);
    };

    await assert.rejects(inspectVts(fake), (error: unknown) => {
      assert.equal(error instanceof VtsRecorderError && error.code, expectedCode);
      assert.equal(error instanceof Error && error.message, expectedCode);
      assert.equal(String(error).includes("secret"), false);
      assert.equal(String(error).includes("C:\\private"), false);
      return true;
    });
  }
});

test("authorization rejection and missing model block before recording", async () => {
  await expectCode(inspectVts(new FakeVts("auth-denied")), "authentication-denied");
  await expectCode(inspectVts(new FakeVts("no-model")), "no-model-loaded");
});

test("first authorization saves the token before authenticating", async () => {
  const fake = new FakeVts();
  const backing: { token?: string } = {};
  const operations: string[] = [];
  const store = tokenStore(backing, operations);
  const save = store.save.bind(store);
  store.save = async (token: string) => {
    assert.equal(fake.requests.some(({ messageType }) => messageType === "AuthenticationRequest"), false);
    await save(token);
  };

  await inspectVts(fake, { tokenStore: store });

  assert.equal(backing.token, "secret-test-token");
  assert.deepEqual(operations, ["load", "save"]);
});

test("a second process reuses the persisted token without requesting another", async () => {
  const backing: { token?: string } = {};
  const first = new FakeVts();
  const second = new FakeVts();
  await inspectVts(first, { tokenStore: tokenStore(backing) });
  await inspectVts(second, { tokenStore: tokenStore(backing) });
  assert.equal(first.requests.filter(({ messageType }) => messageType === "AuthenticationTokenRequest").length, 1);
  assert.equal(second.requests.filter(({ messageType }) => messageType === "AuthenticationTokenRequest").length, 0);
});

test("a revoked cached token is removed and re-requested only once", async () => {
  const backing = { token: "revoked-token" };
  const operations: string[] = [];
  const fake = new FakeVts();

  await inspectVts(fake, { tokenStore: tokenStore(backing, operations) });

  assert.deepEqual(fake.requests.map(({ messageType }) => messageType), [
    "APIStateRequest",
    "AuthenticationRequest",
    "AuthenticationTokenRequest",
    "AuthenticationRequest",
    "CurrentModelRequest",
    "Live2DParameterListRequest"
  ]);
  assert.equal(fake.requests.filter(({ messageType }) => messageType === "AuthenticationTokenRequest").length, 1);
  assert.equal(backing.token, "secret-test-token");
  assert.deepEqual(operations, ["load", "remove", "save"]);
});

test("token-store failures fall back without exposing their messages", async () => {
  const secret = "token-from-store-error";
  const fake = new FakeVts();
  const failingStore: TokenStore = {
    load: async () => { throw new Error(secret); },
    save: async () => { throw new Error(secret); },
    remove: async () => { throw new Error(secret); }
  };

  await inspectVts(fake, { tokenStore: failingStore });
  assert.equal(fake.requests.filter(({ messageType }) => messageType === "AuthenticationTokenRequest").length, 1);
});

test("recording countdown and start cue share a controlled sampling clock", async () => {
  await expectCode(recordVtsMotion(new FakeVts(), {
    durationSeconds: 0.1,
    runtime: { ...instantRuntime(), confirmStart: async () => false }
  }), "recording-not-confirmed");

  let now = 0;
  const events: Array<{ event: number | string; at: number }> = [];
  const sleeps: number[] = [];
  const runtime: RecorderRuntime = {
    now: () => now,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      now += milliseconds;
    },
    confirmStart: async () => true,
    onCountdown: (cue) => events.push({ event: cue, at: now }),
    onRecordingStart: () => events.push({ event: "recording-start", at: now })
  };
  const fake = new FakeVts();
  const request = fake.request.bind(fake);
  fake.request = async (messageType, data, timeoutMs) => {
    if (messageType === "Live2DParameterListRequest" && fake.parameterRequestCount > 0) {
      events.push({ event: "sample", at: now });
    }
    return await request(messageType, data, timeoutMs);
  };
  await recordVtsMotion(fake, { durationSeconds: 0.05, runtime });
  assert.deepEqual(events.slice(0, 6), [
    { event: 3, at: 0 },
    { event: 2, at: 1_000 },
    { event: 1, at: 2_000 },
    { event: "开始", at: 3_000 },
    { event: "recording-start", at: 3_000 },
    { event: "sample", at: 3_000 }
  ]);
  assert.deepEqual(sleeps.slice(0, 3), [1_000, 1_000, 1_000]);
  assert.equal(sleeps.includes(500), false);
});

test("model switching and request timeout abort recording", async () => {
  await expectCode(recordVtsMotion(new FakeVts("model-switch"), {
    durationSeconds: 0.1,
    runtime: instantRuntime()
  }), "model-changed");
  await expectCode(recordVtsMotion(new FakeVts("timeout"), {
    durationSeconds: 0.1,
    runtime: instantRuntime()
  }), "request-timeout");
});

test("default 30 Hz recording keeps one request in flight and emits strict linear Version 3", async () => {
  const fake = new FakeVts();
  const result = await recordVtsMotion(fake, { durationSeconds: 0.1, runtime: instantRuntime() });

  assert.equal(result.summary.fps, 30);
  assert.equal(result.summary.sampleCount, 4);
  assert.equal(fake.maxInFlight, 1);
  assert.equal(result.motion.Version, 3);
  assert.equal(result.motion.Meta.Loop, false);
  assert.equal(result.motion.Meta.Duration, 0.7);
  assert.equal(result.motion.Meta.CurveCount, 9);
  assert.equal(result.motion.Meta.UserDataCount, 0);
  assert.equal(result.motion.Meta.TotalUserDataSize, 0);
  assert.deepEqual(result.motion.UserData, []);
  assert.equal(result.motion.Curves.some(({ Id }) => Id === "ParamPhysicsOutput"), false);
  assert.equal(result.motion.Meta.TotalSegmentCount, result.motion.Curves.reduce((total, curve) => (
    total + parseMotion3Segments(curve.Segments, result.motion.Meta.Duration).segmentCount
  ), 0));
  assert.equal(result.motion.Curves.every(({ Segments }) => Segments.filter((_, index) => index >= 2 && (index - 2) % 3 === 0).every((type) => type === 0)), true);
});

test("recording rejects fps above 30 until stability probing exists", async () => {
  await expectCode(recordVtsMotion(new FakeVts(), {
    durationSeconds: 0.1,
    fps: 31,
    runtime: instantRuntime()
  }), "invalid-fps");
});

test("finite out-of-range parameter values remain unchanged in generated motion", async () => {
  const fake = new FakeVts();
  const baseRequest = fake.request.bind(fake);
  fake.request = async (messageType: string, data?: Record<string, unknown>) => {
    const response = await baseRequest(messageType, data);
    if (messageType === "Live2DParameterListRequest") {
      const parameter = (response.data.parameters as any[])[0];
      parameter.value = 2 + fake.parameterRequestCount;
      parameter.defaultValue = -2;
    }
    return response;
  };

  const result = await recordVtsMotion(fake, { durationSeconds: 0.05, runtime: instantRuntime() });
  const curve = result.motion.Curves.find(({ Id }) => Id === "ParamAngleX");

  assert.ok(curve);
  assert.deepEqual(curve.Segments.filter((_, index) => index === 1 || index >= 4 && (index - 4) % 3 === 0), [4, 4, 5, 6, 6]);
});

test("non-finite values, invalid parameter metadata, out-of-order samples, and parameter-set changes block samples", async () => {
  for (const [code, mutate] of [
    ["invalid-parameter-sample", (response: VtsResponse) => { (response.data.parameters as any[])[0].value = Number.NaN; }],
    ["invalid-parameter-sample", (response: VtsResponse) => { (response.data.parameters as any[])[0].defaultValue = Number.POSITIVE_INFINITY; }],
    ["invalid-parameter-sample", (response: VtsResponse) => { (response.data.parameters as any[])[0].name = ""; }],
    ["invalid-parameter-sample", (response: VtsResponse) => { (response.data.parameters as any[])[0].name = (response.data.parameters as any[])[1].name; }],
    ["invalid-parameter-sample", (response: VtsResponse) => { (response.data.parameters as any[])[0].min = 2; }],
    ["out-of-order-sample", (response: VtsResponse) => { response.timestamp = 1; }],
    ["parameter-set-changed", (response: VtsResponse) => { (response.data.parameters as any[]).pop(); }]
  ] as const) {
    const fake = new FakeVts();
    const baseRequest = fake.request.bind(fake);
    fake.request = async (messageType: string, data?: Record<string, unknown>) => {
      const response = await baseRequest(messageType, data);
      if (messageType === "Live2DParameterListRequest" && fake.parameterRequestCount > 1) mutate(response);
      return response;
    };
    await expectCode(recordVtsMotion(fake, { durationSeconds: 0.05, runtime: instantRuntime() }), code);
  }
});

test("draft writer is confined to its allowed storage root and preserves strict Meta", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "p2-63b-"));
  const projectRoot = join(temporary, "project");
  try {
    await mkdir(projectRoot, { recursive: true });
    const fake = new FakeVts();
    const result = await recordVtsMotion(fake, { durationSeconds: 0.05, runtime: instantRuntime() });
    const allowedDraftRoot = join(projectRoot, ".tmp");
    const draftRoot = join(allowedDraftRoot, "vts-drafts");
    const output = await writeMotionDraft(draftRoot, "yawn-draft", result.motion, allowedDraftRoot);
    const written = JSON.parse(await readFile(output, "utf8"));
    assert.equal(written.Meta.CurveCount, written.Curves.length);
    assert.equal(written.Meta.TotalSegmentCount, result.motion.Meta.TotalSegmentCount);
    assert.match(output, /[\\\/]\.tmp[\\\/]/);

    const userDataAllowedRoot = join(temporary, "user-data", "motion-drafts");
    const userDataDraftRoot = join(userDataAllowedRoot, "vts-drafts");
    const userDataOutput = await resolveDraftOutputPath(userDataDraftRoot, "yawn-user-data", userDataAllowedRoot);
    assert.equal(userDataOutput, join(userDataDraftRoot, "yawn-user-data.motion3.json"));

    await expectCode(resolveDraftOutputPath(join(temporary, ".tmp", "outside"), "escape", allowedDraftRoot), "invalid-draft-root");
    await expectCode(resolveDraftOutputPath(join(projectRoot, "drafts"), "escape", allowedDraftRoot), "invalid-draft-root");
    await expectCode(resolveDraftOutputPath(parse(projectRoot).root, "escape", allowedDraftRoot), "invalid-draft-root");
    await expectCode(resolveDraftOutputPath(join(parse(projectRoot).root, "vts-drafts"), "escape", parse(projectRoot).root), "invalid-draft-root");
    await expectCode(resolveDraftOutputPath(draftRoot, "../escape", allowedDraftRoot), "invalid-draft-name");
    for (const forbidden of ["model", "manifest", "catalog", "resources"]) {
      await expectCode(resolveDraftOutputPath(join(temporary, forbidden, "vts-drafts"), "escape", join(temporary, forbidden)), "invalid-draft-root");
      await expectCode(resolveDraftOutputPath(join(allowedDraftRoot, forbidden), "escape", allowedDraftRoot), "invalid-draft-root");
      await expectCode(resolveDraftOutputPath(draftRoot, forbidden, allowedDraftRoot), "draft-path-escape");
    }

    const outside = join(temporary, "junction-target");
    const junction = join(projectRoot, ".tmp", "junction-drafts");
    await mkdir(outside, { recursive: true });
    await symlink(outside, junction, "junction");
    await expectCode(resolveDraftOutputPath(join(junction, "nested"), "escape", allowedDraftRoot), "invalid-draft-root");
    await assert.rejects(access(join(outside, "nested")));

    const linkedAllowedRoot = join(projectRoot, "linked-drafts");
    await symlink(outside, linkedAllowedRoot, "junction");
    await expectCode(resolveDraftOutputPath(join(linkedAllowedRoot, "vts-drafts"), "escape", linkedAllowedRoot), "invalid-draft-root");
    await assert.rejects(access(join(outside, "vts-drafts")));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("Node WebSocket adapter ignores VTS empty frames and rejects concurrent requests", async () => {
  let connectedUrl = "";
  class FakeSocket {
    readyState = 1;
    listeners = new Map<string, Set<(event: any) => void>>();

    constructor(url: string) {
      connectedUrl = url;
      queueMicrotask(() => this.emit("open", {}));
    }

    addEventListener(type: string, listener: (event: any) => void) {
      const listeners = this.listeners.get(type) ?? new Set();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    }

    removeEventListener(type: string, listener: (event: any) => void) {
      this.listeners.get(type)?.delete(listener);
    }

    send(serialized: string) {
      const request = JSON.parse(serialized);
      queueMicrotask(() => this.emit("message", { data: "" }));
      setTimeout(() => this.emit("message", { data: JSON.stringify({
        requestID: request.requestID,
        messageType: request.messageType.replace(/Request$/, "Response"),
        timestamp: Date.now(),
        data: { active: true }
      }) }), 5);
    }

    close() {}

    emit(type: string, event: any) {
      for (const listener of this.listeners.get(type) ?? []) listener(event);
    }
  }

  assert.equal(vtsUrl(9001), "ws://127.0.0.1:9001");
  const adapter = await createNodeWebSocketAdapter(9001, FakeSocket);
  const first = adapter.request("APIStateRequest");
  await expectCode(adapter.request("APIStateRequest"), "request-already-in-flight");
  assert.equal((await first).messageType, "APIStateResponse");
  assert.equal(connectedUrl, "ws://127.0.0.1:9001");
  await adapter.close?.();
});

test("Node WebSocket adapter rejects a non-empty malformed JSON frame", async () => {
  class MalformedSocket {
    readyState = 1;
    listeners = new Map<string, Set<(event: any) => void>>();

    constructor(_url: string) {
      queueMicrotask(() => this.emit("open", {}));
    }

    addEventListener(type: string, listener: (event: any) => void) {
      const listeners = this.listeners.get(type) ?? new Set();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    }

    removeEventListener(type: string, listener: (event: any) => void) {
      this.listeners.get(type)?.delete(listener);
    }

    send() {
      queueMicrotask(() => this.emit("message", { data: "{malformed" }));
    }

    close() {}

    emit(type: string, event: any) {
      for (const listener of this.listeners.get(type) ?? []) listener(event);
    }
  }

  const adapter = await createNodeWebSocketAdapter(8001, MalformedSocket);
  await expectCode(adapter.request("APIStateRequest"), "invalid-vts-response");
  await adapter.close?.();
});

test("Node WebSocket connect timeout and error close the socket and close again on late open", async () => {
  for (const failure of ["timeout", "error"] as const) {
    let closeCount = 0;
    class FailedSocket {
      readyState = 0;
      listeners = new Map<string, Set<(event: any) => void>>();

      constructor(_url: string) {
        if (failure === "error") queueMicrotask(() => this.emit("error", {}));
        setTimeout(() => this.emit("open", {}), 15);
      }

      addEventListener(type: string, listener: (event: any) => void) {
        const listeners = this.listeners.get(type) ?? new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
      }

      removeEventListener(type: string, listener: (event: any) => void) {
        this.listeners.get(type)?.delete(listener);
      }

      send() {}
      close() { closeCount += 1; }

      emit(type: string, event: any) {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
      }
    }

    await expectCode(createNodeWebSocketAdapter(8001, FailedSocket, 5),
      failure === "timeout" ? "connection-timeout" : "connection-failed");
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    assert.equal(closeCount >= 2, true);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  createCubismMotionController,
  parseControlledParameterIds
} from "../src/renderer/pet/live2d/cubism-motion.ts";

const PRESET = {
  id: "test-motion",
  path: "motions/test.motion3.json",
  semanticKind: "reaction",
  loop: false,
  fadeInSeconds: 0.2,
  fadeOutSeconds: 0.3,
  durationHintSeconds: 1.25,
  priority: 3,
  cooldownMs: 0,
  restorePolicy: "restore-current-state",
  allowedStates: [],
  allowedPresenceModes: [],
  allowedDialogueModes: [],
  visualRisk: "low",
  assetLicenseStatus: "project-owned"
} as const;

function motionBuffer(parameterIds: string[] = ["ParamAngleY"]): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify({
    Version: 3,
    Curves: [
      ...parameterIds.map((Id) => ({ Target: "Parameter", Id })),
      { Target: "Model", Id: "EyeBlink" },
      { Target: "PartOpacity", Id: "PartArm" },
      { Target: "Parameter", Id: "" }
    ]
  })).buffer;
}

class FakeMotion {
  releaseCount = 0;
  readonly effectIdCalls: Array<[unknown[], unknown[]]> = [];
  private readonly events: string[];

  constructor(events: string[] = []) {
    this.events = events;
  }

  setEffectIds(eyeBlinkIds: unknown[], lipSyncIds: unknown[]): void {
    this.effectIdCalls.push([eyeBlinkIds, lipSyncIds]);
    this.events.push("setEffectIds");
  }
  setFadeInTime(): void {}
  setFadeOutTime(): void {}
  setLoop(): void {}
  release(): void {
    this.releaseCount += 1;
  }
}

class FakeManager {
  readonly handles: object[] = [];
  readonly started = new Set<object>();
  readonly finished = new Set<object>();
  startReturnsInvalidHandle = false;
  stopCount = 0;
  releaseCount = 0;
  parameterWriteCount = 0;
  motionQueueActive = false;
  onUpdate: (() => void) | null = null;
  onStop: (() => void) | null = null;
  updateError: Error | null = null;

  startMotionPriority(): object | -1 {
    if (this.startReturnsInvalidHandle) {
      return -1;
    }

    const handle = {};
    this.handles.push(handle);
    this.motionQueueActive = true;
    return handle;
  }

  updateMotion(): boolean {
    if (this.motionQueueActive) {
      this.parameterWriteCount += 1;
    }
    if (this.updateError) {
      throw this.updateError;
    }
    this.onUpdate?.();
    return true;
  }

  getCubismMotionQueueEntry(handle: object): { isStarted(): boolean } | null {
    if (this.finished.has(handle)) {
      return null;
    }
    return { isStarted: () => this.started.has(handle) };
  }

  isFinishedByHandle(handle: object): boolean {
    return this.finished.has(handle);
  }

  stopAllMotions(): void {
    this.stopCount += 1;
    this.onStop?.();
    this.motionQueueActive = false;
  }

  release(): void {
    this.releaseCount += 1;
  }
}

async function makeController(options: {
  manager?: FakeManager;
  buffer?: ArrayBuffer;
  fetchArrayBuffer?: () => Promise<ArrayBuffer>;
  createMotion?: () => FakeMotion | null;
} = {}) {
  const manager = options.manager ?? new FakeManager();
  const motion = new FakeMotion();
  let fetchCount = 0;
  let createCount = 0;
  const controller = await createCubismMotionController({
    motionPresets: [PRESET],
    getMotionPreset: (id) => id === PRESET.id ? PRESET : null,
    fetchArrayBuffer: async () => {
      fetchCount += 1;
      return options.fetchArrayBuffer ? options.fetchArrayBuffer() : options.buffer ?? motionBuffer();
    },
    createMotion: () => {
      createCount += 1;
      return options.createMotion ? options.createMotion() as never : motion as never;
    },
    manager: manager as never
  });

  return {
    controller,
    manager,
    motion,
    counts: {
      get fetch() { return fetchCount; },
      get create() { return createCount; }
    }
  };
}

test("extracts only unique non-empty Parameter curve IDs", () => {
  assert.deepEqual(
    [...parseControlledParameterIds(motionBuffer(["ParamAngleY", "ParamAngleY", "ParamBodyAngleX"]))],
    ["ParamAngleY", "ParamBodyAngleX"]
  );
});

test("invalid JSON and invalid Curves structure fail loading instead of becoming empty ownership", async () => {
  for (const buffer of [
    new TextEncoder().encode("not-json").buffer,
    new TextEncoder().encode(JSON.stringify({ Version: 3 })).buffer
  ]) {
    const { controller, counts } = await makeController({ buffer });
    assert.deepEqual(await controller.playMotionPreset(PRESET.id), {
      status: "skipped",
      skipReason: "motion_load_failed",
      motionPresetId: PRESET.id
    });
    assert.equal(counts.create, 0);
  }
});

test("initializes empty effect IDs before a created motion is started", async () => {
  const events: string[] = [];
  const manager = new FakeManager();
  const motion = new FakeMotion(events);
  const originalStart = manager.startMotionPriority.bind(manager);
  manager.startMotionPriority = () => {
    events.push("start");
    return originalStart();
  };
  const { controller } = await makeController({
    manager,
    createMotion: () => motion
  });

  const result = await controller.playMotionPreset(PRESET.id);

  assert.equal(result.status, "started");
  assert.deepEqual(motion.effectIdCalls, [[[], []]]);
  assert.deepEqual(events, ["setEffectIds", "start"]);
});

test("a null motion factory result remains a load failure without effect initialization", async () => {
  const { controller, manager } = await makeController({ createMotion: () => null });

  assert.deepEqual(await controller.playMotionPreset(PRESET.id), {
    status: "skipped",
    skipReason: "motion_load_failed",
    motionPresetId: PRESET.id
  });
  assert.equal(manager.handles.length, 0);
});

test("a throwing motion factory remains a load failure without effect initialization", async () => {
  const { controller, manager } = await makeController({
    createMotion: () => {
      throw new Error("create failed");
    }
  });

  assert.deepEqual(await controller.playMotionPreset(PRESET.id), {
    status: "skipped",
    skipReason: "motion_load_failed",
    motionPresetId: PRESET.id
  });
  assert.equal(manager.handles.length, 0);
});

test("tracks queued, started, and completed while retaining ownership on the finishing frame", async () => {
  const { controller, manager, counts } = await makeController();
  const result = await controller.playMotionPreset(PRESET.id);
  assert.equal(result.status, "started");
  if (result.status !== "started") return;

  const states: string[] = [];
  const terminals: string[] = [];
  result.playback.onStateChange((state) => states.push(state));
  result.playback.onTerminal((terminal) => terminals.push(terminal.status));
  assert.equal(result.playback.state, "queued");

  const handle = manager.handles[0];
  manager.onUpdate = () => manager.started.add(handle);
  assert.deepEqual([...controller.update({} as never, 0.016)], ["ParamAngleY"]);
  assert.equal(result.playback.state, "started");

  manager.onUpdate = () => manager.finished.add(handle);
  assert.deepEqual([...controller.update({} as never, 0.016)], ["ParamAngleY"]);
  assert.deepEqual(await result.playback.terminal, {
    status: "completed",
    motionPresetId: PRESET.id
  });
  assert.deepEqual(states, ["queued", "started", "completed"]);
  assert.deepEqual(terminals, ["completed"]);
  result.playback.onTerminal((terminal) => terminals.push(`late:${terminal.status}`));
  assert.deepEqual(terminals, ["completed", "late:completed"]);
  assert.deepEqual([...controller.update({} as never, 0.016)], []);

  await controller.playMotionPreset(PRESET.id);
  assert.equal(counts.fetch, 1);
  assert.equal(counts.create, 1);
});

test("unions ownership across active handles and interrupts the superseded lifecycle", async () => {
  const manager = new FakeManager();
  const buffers = [motionBuffer(["ParamAngleY"]), motionBuffer(["ParamBodyAngleX"])];
  let fetchIndex = 0;
  const controller = await createCubismMotionController({
    motionPresets: [PRESET, { ...PRESET, id: "second-motion" }],
    getMotionPreset: (id) => id === PRESET.id
      ? PRESET
      : id === "second-motion" ? { ...PRESET, id: "second-motion" } : null,
    fetchArrayBuffer: async () => buffers[fetchIndex++],
    createMotion: () => new FakeMotion() as never,
    manager: manager as never
  });

  const first = await controller.playMotionPreset(PRESET.id);
  const second = await controller.playMotionPreset("second-motion");
  assert.equal(first.status, "started");
  assert.equal(second.status, "started");
  if (first.status !== "started" || second.status !== "started") return;

  assert.deepEqual(await first.playback.terminal, {
    status: "interrupted",
    motionPresetId: PRESET.id
  });
  assert.deepEqual(
    [...controller.update({} as never, 0.016)].sort(),
    ["ParamAngleY", "ParamBodyAngleX"].sort()
  );

  manager.finished.add(manager.handles[0]);
  controller.update({} as never, 0.016);
  assert.deepEqual([...controller.update({} as never, 0.016)], ["ParamBodyAngleX"]);
});

test("invalid handles do not create ownership or lifecycle records", async () => {
  const manager = new FakeManager();
  manager.startReturnsInvalidHandle = true;
  const { controller } = await makeController({ manager });

  assert.deepEqual(await controller.playMotionPreset(PRESET.id), {
    status: "skipped",
    skipReason: "motion_start_failed",
    motionPresetId: PRESET.id
  });
  assert.deepEqual([...controller.update({} as never, 0.016)], []);
});

test("a handle that finishes before started was observed settles as failed", async () => {
  const { controller, manager } = await makeController();
  const result = await controller.playMotionPreset(PRESET.id);
  assert.equal(result.status, "started");
  if (result.status !== "started") return;

  manager.finished.add(manager.handles[0]);
  assert.deepEqual([...controller.update({} as never, 0.016)], ["ParamAngleY"]);
  assert.deepEqual(await result.playback.terminal, {
    status: "failed",
    motionPresetId: PRESET.id
  });
  assert.deepEqual([...controller.update({} as never, 0.016)], []);
});

test("stop carries timed_out to an observed started playback terminal exactly once", async () => {
  const { controller, manager, motion } = await makeController();
  const result = await controller.playMotionPreset(PRESET.id);
  assert.equal(result.status, "started");
  if (result.status !== "started") return;

  manager.started.add(manager.handles[0]);
  controller.update({} as never, 0.016);
  assert.equal(result.playback.state, "started");

  controller.stop("timed_out");
  controller.stop("interrupted");
  assert.deepEqual(await result.playback.terminal, {
    status: "timed_out",
    motionPresetId: PRESET.id
  });
  assert.deepEqual([...controller.update({} as never, 0.016)], []);

  controller.release();
  assert.equal(manager.stopCount, 3);
  assert.equal(manager.releaseCount, 1);
  assert.equal(motion.releaseCount, 1);
});

test("timed_out stop interrupts queued playback so its player can finish", async () => {
  const { controller } = await makeController();
  const result = await controller.playMotionPreset(PRESET.id);
  assert.equal(result.status, "started");
  if (result.status !== "started") return;

  assert.equal(result.playback.state, "queued");
  controller.stop("timed_out");
  assert.deepEqual(await result.playback.terminal, {
    status: "interrupted",
    motionPresetId: PRESET.id
  });
  assert.deepEqual([...controller.update({} as never, 0.016)], []);
});

test("update failures settle, stop the manager queue, and clear ownership", async () => {
  const { controller, manager } = await makeController();
  const result = await controller.playMotionPreset(PRESET.id);
  assert.equal(result.status, "started");
  if (result.status !== "started") return;

  const cleanupOrder: string[] = [];
  result.playback.onTerminal(() => cleanupOrder.push("failed"));
  manager.onStop = () => cleanupOrder.push("stop");
  manager.updateError = new Error("update failed");
  assert.throws(() => controller.update({} as never, 0.016), /update failed/);
  assert.deepEqual(await result.playback.terminal, {
    status: "failed",
    motionPresetId: PRESET.id
  });
  assert.equal(manager.stopCount, 1);
  assert.equal(manager.motionQueueActive, false);
  assert.deepEqual(cleanupOrder, ["failed", "stop"]);

  const writesBeforeRetry = manager.parameterWriteCount;
  manager.updateError = null;
  assert.deepEqual([...controller.update({} as never, 0.016)], []);
  assert.equal(manager.parameterWriteCount, writesBeforeRetry);
});

test("stop cancels a late load before it can create a queue handle", async () => {
  let resolveBuffer: (buffer: ArrayBuffer) => void = () => undefined;
  const pendingBuffer = new Promise<ArrayBuffer>((resolve) => {
    resolveBuffer = resolve;
  });
  const { controller, manager } = await makeController({
    fetchArrayBuffer: () => pendingBuffer
  });
  const pendingPlay = controller.playMotionPreset(PRESET.id);

  controller.stop("interrupted");
  resolveBuffer(motionBuffer());

  assert.deepEqual(await pendingPlay, {
    status: "skipped",
    skipReason: "motion_start_cancelled",
    motionPresetId: PRESET.id
  });
  assert.equal(manager.handles.length, 0);
});

test("release prevents a late load from creating or caching a motion", async () => {
  let resolveBuffer: (buffer: ArrayBuffer) => void = () => undefined;
  const pendingBuffer = new Promise<ArrayBuffer>((resolve) => {
    resolveBuffer = resolve;
  });
  let createCount = 0;
  const { controller, manager } = await makeController({
    fetchArrayBuffer: () => pendingBuffer,
    createMotion: () => {
      createCount += 1;
      return new FakeMotion();
    }
  });
  const pendingPlay = controller.playMotionPreset(PRESET.id);

  controller.release();
  resolveBuffer(motionBuffer());

  assert.deepEqual(await pendingPlay, {
    status: "skipped",
    skipReason: "motion_start_cancelled",
    motionPresetId: PRESET.id
  });
  assert.equal(createCount, 0);
  assert.equal(manager.handles.length, 0);
});

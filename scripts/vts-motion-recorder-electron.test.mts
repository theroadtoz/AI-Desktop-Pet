import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createCountdownOverlayController,
  createSafeStorageTokenStore,
  runElectronVtsMotionRecorder
} from "./vts-motion-recorder-electron.mjs";

const TOKEN_FILE = join("secrets", "vts-motion-recorder-token.json");

function workingSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (token: string) => Buffer.from(`protected:${token}`, "utf8"),
    decryptString: (encrypted: Buffer) => {
      const value = encrypted.toString("utf8");
      if (!value.startsWith("protected:")) throw new Error("decrypt-failed");
      return value.slice("protected:".length);
    }
  };
}

test("safeStorage token store writes only strict encrypted base64 and supports another process", async () => {
  const userData = await mkdtemp(join(tmpdir(), "vts-token-store-"));
  const token = "secret-token-never-plaintext";
  try {
    const firstProcess = createSafeStorageTokenStore(userData, workingSafeStorage());
    await firstProcess.save(token);

    const serialized = await readFile(join(userData, TOKEN_FILE), "utf8");
    const parsed = JSON.parse(serialized);
    assert.deepEqual(Object.keys(parsed).sort(), ["encryptedToken", "version"]);
    assert.equal(parsed.version, 1);
    assert.equal(typeof parsed.encryptedToken, "string");
    assert.equal(serialized.includes(token), false);
    assert.deepEqual(await readdir(join(userData, "secrets")), ["vts-motion-recorder-token.json"]);

    const secondProcess = createSafeStorageTokenStore(userData, workingSafeStorage());
    assert.equal(await secondProcess.load(), token);
  } finally {
    await rm(userData, { recursive: true, force: true });
  }
});

test("unavailable safeStorage keeps the token only in process memory", async () => {
  const userData = await mkdtemp(join(tmpdir(), "vts-token-memory-"));
  try {
    const store = createSafeStorageTokenStore(userData, {
      isEncryptionAvailable: () => false,
      encryptString: () => { throw new Error("must-not-encrypt"); },
      decryptString: () => { throw new Error("must-not-decrypt"); }
    });
    await store.save("memory-only-token");
    assert.equal(await store.load(), "memory-only-token");
    await assert.rejects(access(join(userData, TOKEN_FILE)));
  } finally {
    await rm(userData, { recursive: true, force: true });
  }
});

test("corrupt schema and decryption failures are removed without leaking", async () => {
  for (const serialized of [
    JSON.stringify({ version: 1, encryptedToken: "not base64!", plaintext: "forbidden" }),
    JSON.stringify({ version: 1, encryptedToken: Buffer.from("broken").toString("base64") })
  ]) {
    const userData = await mkdtemp(join(tmpdir(), "vts-token-corrupt-"));
    const tokenPath = join(userData, TOKEN_FILE);
    try {
      await mkdir(join(userData, "secrets"), { recursive: true });
      await writeFile(tokenPath, serialized, "utf8");
      const store = createSafeStorageTokenStore(userData, {
        ...workingSafeStorage(),
        decryptString: () => { throw new Error("secret-token-in-decrypt-error"); }
      });
      assert.equal(await store.load(), undefined);
      await assert.rejects(access(tokenPath));
    } finally {
      await rm(userData, { recursive: true, force: true });
    }
  }
});

test("encryption failure preserves only memory and removes stale disk state", async () => {
  const userData = await mkdtemp(join(tmpdir(), "vts-token-encrypt-fail-"));
  const tokenPath = join(userData, TOKEN_FILE);
  try {
    const workingStore = createSafeStorageTokenStore(userData, workingSafeStorage());
    await workingStore.save("stale-token");

    const failingStore = createSafeStorageTokenStore(userData, {
      isEncryptionAvailable: () => true,
      encryptString: () => { throw new Error("fresh-secret-in-error"); },
      decryptString: workingSafeStorage().decryptString
    });
    await failingStore.save("fresh-memory-token");
    assert.equal(await failingStore.load(), "fresh-memory-token");
    await assert.rejects(access(tokenPath));
  } finally {
    await rm(userData, { recursive: true, force: true });
  }
});

test("Electron wrapper injects stable userData draft defaults across independent runs and always quits", async () => {
  const events: string[] = [];
  const userData = join(tmpdir(), "electron-vts-user-data");
  const app = {
    whenReady: async () => { events.push("ready"); },
    getPath: (name: string) => {
      assert.equal(name, "userData");
      events.push("getPath");
      return userData;
    },
    quit: () => { events.push("quit"); }
  };

  const code = await runElectronVtsMotionRecorder(["inspect"], {
    app,
    safeStorage: { isEncryptionAvailable: () => false },
    exit: (exitCode: number) => { events.push(`exit=${exitCode}`); },
    runCli: async (argv: string[], dependencies: {
      tokenStore: unknown;
      defaultDraftRoot: string;
      allowedDraftRoot: string;
    }) => {
      events.push("cli");
      assert.deepEqual(argv, ["inspect"]);
      assert.ok(dependencies.tokenStore);
      assert.equal(dependencies.allowedDraftRoot, join(userData, "motion-drafts"));
      assert.equal(dependencies.defaultDraftRoot, join(userData, "motion-drafts", "vts-drafts"));
      return 7;
    }
  });
  assert.equal(code, 7);
  assert.deepEqual(events, ["ready", "getPath", "cli", "quit", "exit=7"]);

  const failedCode = await runElectronVtsMotionRecorder([], {
    app,
    safeStorage: { isEncryptionAvailable: () => false },
    exit: (exitCode: number) => { events.push(`exit=${exitCode}`); },
    runCli: async (_argv: string[], dependencies: { defaultDraftRoot: string; allowedDraftRoot: string }) => {
      assert.equal(dependencies.allowedDraftRoot, join(userData, "motion-drafts"));
      assert.equal(dependencies.defaultDraftRoot, join(userData, "motion-drafts", "vts-drafts"));
      throw new Error("private-token-must-not-be-logged");
    }
  });
  assert.equal(failedCode, 1);
  assert.deepEqual(events.slice(-2), ["quit", "exit=1"]);
});

test("countdown overlay uses safe transparent window options and clamped primary-work-area bounds", async () => {
  const created: any[] = [];
  const timers: Array<{ callback: () => void | Promise<void>; delay: number; id: number }> = [];
  const clearedTimers: number[] = [];
  class FakeWindow {
    destroyed = false;
    calls: string[] = [];
    webContents = {
      executeJavaScript: async (source: string) => { this.calls.push(`js:${source}`); }
    };
    constructor(options: unknown) { created.push({ options, window: this }); }
    setAlwaysOnTop(flag: boolean, level: string, relativeLevel: number) {
      this.calls.push(`alwaysOnTop:${flag}:${level}:${relativeLevel}`);
    }
    setIgnoreMouseEvents(ignore: boolean, options: unknown) { this.calls.push(`mouse:${ignore}:${JSON.stringify(options)}`); }
    async loadURL(url: string) { this.calls.push(`url:${url}`); }
    moveTop() { this.calls.push("moveTop"); }
    showInactive() { this.calls.push("showInactive"); }
    hide() { this.calls.push("hide"); }
    destroy() { this.destroyed = true; this.calls.push("destroy"); }
    isDestroyed() { return this.destroyed; }
  }
  const controller = createCountdownOverlayController({
    BrowserWindow: FakeWindow,
    screen: { getPrimaryDisplay: () => ({ workArea: { x: -100, y: 20, width: 250, height: 160 } }) },
    setTimer: (callback: () => void | Promise<void>, delay: number) => {
      const id = timers.length + 1;
      timers.push({ callback, delay, id });
      return id;
    },
    clearTimer: (id: number) => { clearedTimers.push(id); }
  });

  assert.equal(created.length, 0);
  for (const cue of [3, 2, 1, "开始"] as const) await controller.showCountdown(cue);
  await controller.showRecording();
  assert.deepEqual(timers.map(({ delay }) => delay), [400]);

  assert.equal(created.length, 1);
  const { options, window } = created[0];
  assert.deepEqual({ x: options.x, y: options.y, width: options.width, height: options.height }, {
    x: -100, y: 20, width: 250, height: 160
  });
  assert.equal(options.transparent, true);
  assert.equal(options.frame, false);
  assert.equal(options.alwaysOnTop, true);
  assert.equal(options.skipTaskbar, true);
  assert.equal(options.focusable, false);
  assert.equal(options.resizable, false);
  assert.deepEqual(options.webPreferences, { nodeIntegration: false, contextIsolation: true, sandbox: true });
  assert.equal(window.calls.includes("alwaysOnTop:true:screen-saver:1"), true);
  assert.equal(window.calls.includes("mouse:true:{\"forward\":false}"), true);
  assert.equal(window.calls.filter((call: string) => call === "showInactive").length, 4);
  assert.equal(window.calls.filter((call: string) => call === "moveTop").length, 8);
  for (const showIndex of window.calls.flatMap((call: string, index: number) => call === "showInactive" ? [index] : [])) {
    assert.equal(window.calls[showIndex - 1], "moveTop");
    assert.equal(window.calls[showIndex + 1], "moveTop");
  }
  assert.deepEqual(window.calls.filter((call: string) => call.startsWith("js:")).map((call: string) => {
    const match = call.match(/window\.setCue\((.+?),/);
    return JSON.parse(match![1]);
  }), ["3", "2", "1", "开始"]);

  await timers[0].callback();
  assert.equal(window.calls.filter((call: string) => call === "showInactive").length, 5);
  assert.equal(window.calls.filter((call: string) => call === "moveTop").length, 10);
  assert.deepEqual(window.calls.filter((call: string) => call.startsWith("js:")).map((call: string) => {
    const match = call.match(/window\.setCue\((.+?),/);
    return JSON.parse(match![1]);
  }), ["3", "2", "1", "开始", "录制中"]);
  assert.deepEqual(timers.map(({ delay }) => delay), [400, 900]);
  const htmlUrl = window.calls.find((call: string) => call.startsWith("url:"));
  assert.match(htmlUrl, /^url:data:text\/html;charset=utf-8,/);
  const decodedHtml = decodeURIComponent(htmlUrl.slice("url:data:text/html;charset=utf-8,".length));
  assert.equal(decodedHtml.includes("letter-spacing:0"), true);
  assert.equal(decodedHtml.includes("http://"), false);
  assert.equal(decodedHtml.includes("https://"), false);
  assert.equal(decodedHtml.includes("camera"), false);

  controller.destroy();
  assert.equal(window.destroyed, true);
  assert.deepEqual(clearedTimers, [2]);
  await controller.showCountdown(3);
  assert.equal(created.length, 1);

  const pendingController = createCountdownOverlayController({
    BrowserWindow: FakeWindow,
    screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 800, height: 600 } }) },
    setTimer: (callback: () => void | Promise<void>, delay: number) => {
      const id = timers.length + 1;
      timers.push({ callback, delay, id });
      return id;
    },
    clearTimer: (id: number) => { clearedTimers.push(id); }
  });
  await pendingController.showCountdown("开始");
  await pendingController.showRecording();
  const pendingTimer = timers.at(-1)!;
  assert.equal(pendingTimer.delay, 400);
  pendingController.destroy();
  assert.equal(clearedTimers.includes(pendingTimer.id), true);
  const timerCountAfterDestroy = timers.length;
  await pendingController.showRecording();
  assert.equal(timers.length, timerCountAfterDestroy);

  const normalCreated: any[] = [];
  class NormalWindow extends FakeWindow {
    constructor(options: unknown) {
      super(options);
      normalCreated.push({ options });
    }
  }
  const normalController = createCountdownOverlayController({
    BrowserWindow: NormalWindow,
    screen: { getPrimaryDisplay: () => ({ workArea: { x: 1000, y: -50, width: 1920, height: 1080 } }) }
  });
  await normalController.showCountdown(3);
  assert.deepEqual({
    x: normalCreated[0].options.x,
    y: normalCreated[0].options.y,
    width: normalCreated[0].options.width,
    height: normalCreated[0].options.height
  }, { x: 1040, y: -10, width: 320, height: 190 });
  normalController.destroy();
});

test("countdown beeps before the first 3 and start without blocking cues", async () => {
  const events: string[] = [];
  let destroyed = false;
  class FakeWindow {
    webContents = {
      executeJavaScript: async (source: string) => {
        const match = source.match(/window\.setCue\((.+?),/);
        events.push(`cue:${JSON.parse(match![1])}`);
      }
    };
    setAlwaysOnTop() {}
    setIgnoreMouseEvents() {}
    async loadURL() {}
    moveTop() {}
    showInactive() {}
    destroy() { destroyed = true; }
    isDestroyed() { return destroyed; }
  }
  let beepCount = 0;
  const controller = createCountdownOverlayController({
    BrowserWindow: FakeWindow,
    screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 800, height: 600 } }) },
    beep: () => {
      beepCount += 1;
      events.push(`beep:${beepCount}`);
      if (beepCount === 1) throw new Error("beep-unavailable");
    }
  });

  await controller.showCountdown(3);
  await controller.showCountdown(3);
  await controller.showCountdown(2);
  await controller.showCountdown(1);
  await controller.showCountdown("开始");
  assert.equal(beepCount, 2);
  assert.deepEqual(events, ["beep:1", "cue:3", "cue:3", "cue:2", "cue:1", "beep:2", "cue:开始"]);

  controller.destroy();
  await controller.showCountdown("开始");
  assert.equal(beepCount, 2);
});

test("Electron inspect creates no overlay window while record failure and app quit clean it up", async () => {
  let windowCount = 0;
  let destroyCount = 0;
  let beepCount = 0;
  let beforeQuit: (() => void) | undefined;
  class FakeWindow {
    webContents = { executeJavaScript: async () => {} };
    constructor() { windowCount += 1; }
    setAlwaysOnTop() {}
    setIgnoreMouseEvents() {}
    async loadURL() {}
    moveTop() {}
    showInactive() {}
    destroy() { destroyCount += 1; }
    isDestroyed() { return false; }
  }
  const app = {
    whenReady: async () => {},
    getPath: () => tmpdir(),
    once: (event: string, listener: () => void) => { if (event === "before-quit") beforeQuit = listener; },
    removeListener: () => {},
    quit: () => {}
  };
  const base = {
    app,
    BrowserWindow: FakeWindow,
    shell: { beep: () => { beepCount += 1; } },
    safeStorage: { isEncryptionAvailable: () => false },
    screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) }
  };

  await runElectronVtsMotionRecorder(["inspect"], {
    ...base,
    runCli: async (_argv: string[], dependencies: any) => {
      assert.equal(dependencies.overlay, undefined);
      return 0;
    }
  });
  assert.equal(windowCount, 0);

  await runElectronVtsMotionRecorder(["record", "--name", "yawn", "--duration", "1"], {
    ...base,
    runCli: async (_argv: string[], dependencies: any) => {
      await dependencies.overlay.showCountdown(3);
      await dependencies.overlay.showCountdown("开始");
      beforeQuit?.();
      throw new Error("token=model-private-data");
    }
  });
  assert.equal(windowCount, 1);
  assert.equal(destroyCount >= 1, true);
  assert.equal(beepCount, 2);
});

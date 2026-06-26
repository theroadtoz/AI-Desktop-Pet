import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join(root, ".tmp", "p2-10d-5-window-shake-light-feedback-real-ui", stamp);
const appDataDir = join(runDir, "user-data");
const resultPath = join(runDir, "result.json");
const progressPath = join(runDir, "progress.log");
const port = Number(process.env.P2_10D_5_CDP_PORT || 9375);

mkdirSync(runDir, { recursive: true });

function log(message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  writeFileSync(progressPath, `${line}\n`, { flag: "a" });
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status}`);
  }
  return response.json();
}

async function waitForJson(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      return await fetchJson(url);
    } catch (error) {
      lastError = error;
      await sleep(500);
    }
  }

  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

class CdpClient {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.nextId = 1;
    this.pending = new Map();
  }

  async open() {
    this.socket = new WebSocket(this.webSocketUrl);
    this.socket.addEventListener("message", (event) => this.onMessage(event));
    await new Promise((resolveOpen, rejectOpen) => {
      this.socket.addEventListener("open", resolveOpen, { once: true });
      this.socket.addEventListener("error", rejectOpen, { once: true });
    });
  }

  onMessage(event) {
    const message = JSON.parse(String(event.data));
    if (!message.id) {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error.message));
      return;
    }
    pending.resolve(message.result ?? {});
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));

    return new Promise((resolveSend, rejectSend) => {
      this.pending.set(id, { resolve: resolveSend, reject: rejectSend });
      setTimeout(() => {
        if (!this.pending.has(id)) {
          return;
        }
        this.pending.delete(id);
        rejectSend(new Error(`CDP timeout: ${method}`));
      }, 15_000).unref();
    });
  }

  close() {
    this.socket?.close();
  }
}

async function listTargets() {
  return waitForJson(`http://127.0.0.1:${port}/json/list`, 30_000);
}

async function connectTarget(partialUrl) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const targets = await listTargets();
    const target = targets.find((entry) => entry.type === "page" && entry.url.includes(partialUrl));
    if (target) {
      const cdp = new CdpClient(target.webSocketDebuggerUrl);
      await cdp.open();
      await cdp.send("Runtime.enable");
      await cdp.send("Page.enable");
      return { target, cdp };
    }
    await sleep(500);
  }
  throw new Error(`Target not found: ${partialUrl}`);
}

async function evaluate(cdp, expression, awaitPromise = true) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true
  });

  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "Runtime.evaluate failed");
  }

  return result.result?.value;
}

function readTelemetryEvents() {
  const logDirectory = join(appDataDir, "logs");
  if (!existsSync(logDirectory)) {
    return { logDirectory, files: [], events: [] };
  }

  const files = readdirSync(logDirectory)
    .filter((name) => name.startsWith("telemetry-") && name.endsWith(".jsonl"))
    .map((name) => join(logDirectory, name))
    .sort();
  const events = [];

  for (const file of files) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      try {
        events.push(JSON.parse(line));
      } catch {
        // Ignore partial log lines from a running app.
      }
    }
  }

  return { logDirectory, files, events };
}

async function waitForFirstFrame() {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    if (readTelemetryEvents().events.some((event) => event.type === "first_frame")) {
      return;
    }
    await sleep(250);
  }

  throw new Error("Timed out waiting for first_frame telemetry");
}

async function measurePet(cdp, label) {
  return evaluate(cdp, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      const rect = canvas.getBoundingClientRect();
      return {
        label: ${JSON.stringify(label)},
        screen: {
          x: Math.round(window.screenX),
          y: Math.round(window.screenY)
        },
        viewport: {
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          outerWidth: window.outerWidth,
          outerHeight: window.outerHeight,
          devicePixelRatio: window.devicePixelRatio
        },
        canvasCss: {
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      };
    })()
  `);
}

async function dispatchPointerDown(cdp, pointerId) {
  await evaluate(cdp, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width * 0.5;
      const y = rect.top + rect.height * 0.48;
      window.__p210d4DragBase = {
        screenX: window.screenX + x,
        screenY: window.screenY + y
      };
      canvas.dispatchEvent(new PointerEvent("pointerdown", {
        pointerId: ${pointerId},
        pointerType: "mouse",
        clientX: x,
        clientY: y,
        screenX: window.__p210d4DragBase.screenX,
        screenY: window.__p210d4DragBase.screenY,
        buttons: 1,
        bubbles: true
      }));
    })()
  `);
}

async function dispatchPointerMove(cdp, pointerId, offsetX, offsetY) {
  await evaluate(cdp, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width * 0.5;
      const y = rect.top + rect.height * 0.48;
      const base = window.__p210d4DragBase ?? {
        screenX: window.screenX + x,
        screenY: window.screenY + y
      };
      canvas.dispatchEvent(new PointerEvent("pointermove", {
        pointerId: ${pointerId},
        pointerType: "mouse",
        clientX: x + ${offsetX},
        clientY: y + ${offsetY},
        screenX: base.screenX + ${offsetX},
        screenY: base.screenY + ${offsetY},
        buttons: 1,
        bubbles: true
      }));
    })()
  `);
}

async function dispatchPointerUp(cdp, pointerId, offsetX = 0, offsetY = 0) {
  await evaluate(cdp, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width * 0.5;
      const y = rect.top + rect.height * 0.48;
      const base = window.__p210d4DragBase ?? {
        screenX: window.screenX + x,
        screenY: window.screenY + y
      };
      canvas.dispatchEvent(new PointerEvent("pointerup", {
        pointerId: ${pointerId},
        pointerType: "mouse",
        clientX: x + ${offsetX},
        clientY: y + ${offsetY},
        screenX: base.screenX + ${offsetX},
        screenY: base.screenY + ${offsetY},
        bubbles: true
      }));
    })()
  `);
}

async function dragWithOffsets(cdp, pointerId, offsets, delayMs) {
  await dispatchPointerDown(cdp, pointerId);
  for (const [offsetX, offsetY] of offsets) {
    await dispatchPointerMove(cdp, pointerId, offsetX, offsetY);
    await sleep(delayMs);
  }
  const [lastX, lastY] = offsets.at(-1) ?? [0, 0];
  await dispatchPointerUp(cdp, pointerId, lastX, lastY);
  await sleep(500);
}

async function doubleClickPet(cdp) {
  await evaluate(cdp, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width * 0.5;
      const y = rect.top + rect.height * 0.48;
      canvas.dispatchEvent(new MouseEvent("dblclick", {
        clientX: x,
        clientY: y,
        screenX: window.screenX + x,
        screenY: window.screenY + y,
        bubbles: true
      }));
    })()
  `);
}

function eventsSince(index) {
  return readTelemetryEvents().events.slice(index);
}

function motionEvents(events) {
  return events.filter((event) => event.type === "pet_window_motion_detected");
}

function actionStarts(events) {
  return events.filter((event) => event.type === "pet_interaction_action_started");
}

function actionSkips(events) {
  return events.filter((event) => event.type === "pet_interaction_action_skipped");
}

function feedbackEvents(events) {
  return events.filter((event) => event.type === "pet_window_motion_feedback");
}

function latestPetWindowSnapshot(events) {
  return events
    .filter((event) => event.type === "window_snapshot" && event.payload?.petWindow)
    .at(-1)?.payload?.petWindow ?? null;
}

function hasForbiddenTelemetryKeys(event) {
  const payload = event.payload ?? {};
  const forbidden = [
    "bounds",
    "petWindow",
    "chatWindow",
    "title",
    "url",
    "path",
    "messages",
    "content",
    "apiKey",
    "request",
    "response"
  ];

  return forbidden.some((key) => Object.hasOwn(payload, key));
}

async function main() {
  log(`runDir=${runDir}`);
  log(`appDataDir=${appDataDir}`);

  const electronExe = join(root, "node_modules", "electron", "dist", "electron.exe");
  const electronCmd = existsSync(electronExe) ? electronExe : join(root, "node_modules", ".bin", "electron.cmd");
  const child = spawn(electronCmd, [".", `--remote-debugging-port=${port}`], {
    cwd: root,
    env: {
      ...process.env,
      APPDATA: appDataDir,
      AI_DESKTOP_PET_USER_DATA_PATH: appDataDir,
      AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1",
      AI_DESKTOP_PET_PROVIDER: "fake",
      AI_DESKTOP_PET_API_KEY: "",
      AI_DESKTOP_PET_BASE_URL: "",
      AI_DESKTOP_PET_MODEL: ""
    },
    windowsHide: false,
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => writeFileSync(join(runDir, "electron.stdout.log"), chunk, { flag: "a" }));
  child.stderr.on("data", (chunk) => writeFileSync(join(runDir, "electron.stderr.log"), chunk, { flag: "a" }));
  writeFileSync(join(runDir, "electron.pid"), String(child.pid ?? ""));

  const checks = [];
  let pet;
  let chat;

  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`, 30_000);
    pet = await connectTarget("renderer/pet/index.html");
    await waitForFirstFrame();
    await sleep(2_000);

    log("check:ordinary-drag");
    const ordinaryStartIndex = readTelemetryEvents().events.length;
    await dragWithOffsets(pet.cdp, 310, [[18, 4], [36, 6], [54, 8], [72, 10]], 80);
    const ordinaryEvents = eventsSince(ordinaryStartIndex);
    checks.push({
      name: "ordinaryDragDoesNotEmitShakeOrFeedback",
      ok: !motionEvents(ordinaryEvents).some((event) => event.payload?.eventType === "window_shake_candidate") &&
        !feedbackEvents(ordinaryEvents).some((event) => event.payload?.feedbackType === "shake_light_feedback") &&
        !actionStarts(ordinaryEvents).some((event) => event.payload?.reason === "window_shake_feedback"),
      detail: {
        motion: motionEvents(ordinaryEvents).map((event) => event.payload),
        feedback: feedbackEvents(ordinaryEvents).map((event) => event.payload),
        actionStarts: actionStarts(ordinaryEvents).map((event) => event.payload)
      }
    });

    log("check:fast-linear-drag");
    const fastStartIndex = readTelemetryEvents().events.length;
    const beforeFast = await measurePet(pet.cdp, "before-fast");
    await dragWithOffsets(pet.cdp, 320, [[110, 0], [220, 0], [330, 0], [440, 0], [550, 0], [660, 0], [770, 0], [880, 0]], 45);
    const afterFast = await measurePet(pet.cdp, "after-fast");
    const fastEvents = eventsSince(fastStartIndex);
    const fastMotion = motionEvents(fastEvents);
    checks.push({
      name: "fastLinearDragDoesNotEmitShakeFeedbackOrResize",
      ok: !fastMotion.some((event) => event.payload?.eventType === "window_shake_candidate") &&
        !feedbackEvents(fastEvents).some((event) => event.payload?.feedbackType === "shake_light_feedback") &&
        !actionStarts(fastEvents).some((event) => event.payload?.reason === "window_shake_feedback") &&
        Math.abs(afterFast.viewport.innerWidth - beforeFast.viewport.innerWidth) <= 2 &&
        Math.abs(afterFast.viewport.innerHeight - beforeFast.viewport.innerHeight) <= 2,
      detail: {
        beforeFast,
        afterFast,
        motion: fastMotion.map((event) => event.payload),
        feedback: feedbackEvents(fastEvents).map((event) => event.payload),
        actionStarts: actionStarts(fastEvents).map((event) => event.payload)
      }
    });

    log("check:shake-light-feedback");
    await sleep(8_200);
    const shakeStartIndex = readTelemetryEvents().events.length;
    const beforeShake = await measurePet(pet.cdp, "before-shake");
    await dragWithOffsets(pet.cdp, 330, [[60, 0], [-60, 0], [60, 0], [-60, 0], [60, 0], [-60, 0]], 60);
    await sleep(600);
    const afterShake = await measurePet(pet.cdp, "after-shake");
    const shakeEvents = eventsSince(shakeStartIndex);
    const shakeMotion = motionEvents(shakeEvents);
    const shakeFeedback = feedbackEvents(shakeEvents);
    const shakeActionStarts = actionStarts(shakeEvents).filter((event) => event.payload?.reason === "window_shake_feedback");
    checks.push({
      name: "shakeCandidateStartsOneSafeThinkingFeedback",
      ok: shakeMotion.some((event) => event.payload?.eventType === "window_shake_candidate") &&
        shakeFeedback.some((event) => (
          event.payload?.feedbackType === "shake_light_feedback" &&
          event.payload?.result === "started" &&
          event.payload?.reason === "window_shake_feedback"
        )) &&
        shakeActionStarts.length === 1 &&
        shakeActionStarts[0]?.payload?.type === "thinking" &&
        shakeActionStarts[0]?.payload?.reason === "window_shake_feedback" &&
        Math.abs(afterShake.viewport.innerWidth - beforeShake.viewport.innerWidth) <= 2 &&
        Math.abs(afterShake.viewport.innerHeight - beforeShake.viewport.innerHeight) <= 2 &&
        [...shakeMotion, ...shakeFeedback].every((event) => !hasForbiddenTelemetryKeys(event)),
      detail: {
        beforeShake,
        afterShake,
        motion: shakeMotion.map((event) => event.payload),
        feedback: shakeFeedback.map((event) => event.payload),
        actionStarts: actionStarts(shakeEvents).map((event) => event.payload)
      }
    });

    log("check:feedback-cooldown");
    await sleep(8_200);
    const cooldownStartIndex = readTelemetryEvents().events.length;
    await dragWithOffsets(pet.cdp, 331, [[60, 0], [-60, 0], [60, 0], [-60, 0], [60, 0], [-60, 0]], 60);
    await sleep(600);
    const cooldownEvents = eventsSince(cooldownStartIndex);
    const cooldownFeedback = feedbackEvents(cooldownEvents);
    checks.push({
      name: "secondShakeCandidateRespectsFeedbackCooldown",
      ok: motionEvents(cooldownEvents).some((event) => event.payload?.eventType === "window_shake_candidate") &&
        cooldownFeedback.some((event) => (
          event.payload?.feedbackType === "shake_light_feedback" &&
          event.payload?.result === "skipped" &&
          event.payload?.skipReason === "window_shake_feedback_cooldown" &&
          event.payload?.cooldownState === "cooling_down"
        )) &&
        !actionStarts(cooldownEvents).some((event) => event.payload?.reason === "window_shake_feedback"),
      detail: {
        motion: motionEvents(cooldownEvents).map((event) => event.payload),
        feedback: cooldownFeedback.map((event) => event.payload),
        actionStarts: actionStarts(cooldownEvents).map((event) => event.payload),
        actionSkips: actionSkips(cooldownEvents).map((event) => event.payload)
      }
    });

    log("check:lock-guard");
    await doubleClickPet(pet.cdp);
    chat = await connectTarget("renderer/chat/index.html");
    await sleep(700);
    await evaluate(chat.cdp, "window.petPresentationApi.setPetLocked(true)", true);
    await sleep(700);
    const lockStartIndex = readTelemetryEvents().events.length;
    const beforeLockDrag = await measurePet(pet.cdp, "before-lock-drag");
    await dragWithOffsets(pet.cdp, 340, [[80, 0], [-80, 0], [80, 0], [-80, 0], [80, 0], [-80, 0]], 60);
    const afterLockDrag = await measurePet(pet.cdp, "after-lock-drag");
    const lockEvents = eventsSince(lockStartIndex);
    const lockSnapshot = latestPetWindowSnapshot(readTelemetryEvents().events);
    checks.push({
      name: "lockedDragDoesNotMoveOrEmitMotionFeedback",
      ok: motionEvents(lockEvents).length === 0 &&
        feedbackEvents(lockEvents).length === 0 &&
        !actionStarts(lockEvents).some((event) => event.payload?.reason === "window_shake_feedback") &&
        Math.abs(afterLockDrag.screen.x - beforeLockDrag.screen.x) <= 2 &&
        Math.abs(afterLockDrag.screen.y - beforeLockDrag.screen.y) <= 2 &&
        lockSnapshot?.ignoreMouseEvents === true &&
        lockSnapshot?.isLocked === true,
      detail: {
        beforeLockDrag,
        afterLockDrag,
        latestPetWindow: lockSnapshot,
        motion: motionEvents(lockEvents).map((event) => event.payload),
        feedback: feedbackEvents(lockEvents).map((event) => event.payload),
        actionStarts: actionStarts(lockEvents).map((event) => event.payload)
      }
    });
    await evaluate(chat.cdp, "window.petPresentationApi.setPetLocked(false)", true);
    await sleep(700);

    log("check:scale-entry");
    const scaleStartIndex = readTelemetryEvents().events.length;
    const beforeScaleGuard = await measurePet(pet.cdp, "before-scale-guard");
    await dispatchPointerDown(pet.cdp, 350);
    await dispatchPointerMove(pet.cdp, 350, 18, 0);
    await evaluate(pet.cdp, `
      (() => {
        const canvas = document.querySelector("#pet-canvas");
        const rect = canvas.getBoundingClientRect();
        const x = rect.left + rect.width * 0.5;
        const y = rect.top + rect.height * 0.48;
        canvas.dispatchEvent(new WheelEvent("wheel", {
          clientX: x,
          clientY: y,
          deltaY: -120,
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true
        }));
      })()
    `);
    await dispatchPointerUp(pet.cdp, 350, 18, 0);
    await sleep(800);
    const afterScaleGuard = await measurePet(pet.cdp, "after-scale-guard");
    const scaleEvents = eventsSince(scaleStartIndex);
    checks.push({
      name: "scaleEntryRemainsSuppressedDuringPointerDown",
      ok: scaleEvents.filter((event) => event.type === "pet_scale_adjusted").length === 0 &&
        !feedbackEvents(scaleEvents).some((event) => event.payload?.feedbackType === "shake_light_feedback") &&
        !actionStarts(scaleEvents).some((event) => event.payload?.reason === "window_shake_feedback") &&
        Math.abs(afterScaleGuard.viewport.innerWidth - beforeScaleGuard.viewport.innerWidth) <= 2 &&
        Math.abs(afterScaleGuard.viewport.innerHeight - beforeScaleGuard.viewport.innerHeight) <= 2,
      detail: {
        beforeScaleGuard,
        afterScaleGuard,
        scaleAdjusted: scaleEvents.filter((event) => event.type === "pet_scale_adjusted").map((event) => event.payload),
        feedback: feedbackEvents(scaleEvents).map((event) => event.payload),
        actionStarts: actionStarts(scaleEvents).map((event) => event.payload)
      }
    });

    const telemetry = readTelemetryEvents();
    const result = {
      ok: checks.every((check) => check.ok),
      runDir,
      appDataDir,
      checks,
      telemetry: {
        logDirectory: telemetry.logDirectory,
        files: telemetry.files,
        eventCount: telemetry.events.length,
        motionEvents: motionEvents(telemetry.events).map((event) => event.payload),
        feedbackEvents: feedbackEvents(telemetry.events).map((event) => event.payload),
        windowShakeFeedbackActionStarts: actionStarts(telemetry.events)
          .filter((event) => event.payload?.reason === "window_shake_feedback")
          .map((event) => event.payload),
        rendererGoneCount: telemetry.events.filter((event) => event.type === "renderer_process_gone").length,
        childProcessGoneCount: telemetry.events.filter((event) => event.type === "child_process_gone").length,
        webglContextLostCount: telemetry.events.filter((event) => event.type === "webgl_context_lost").length
      },
      artifactNote: "This script does not capture screenshots."
    };
    writeFileSync(resultPath, JSON.stringify(result, null, 2));
    log(`result=${resultPath}`);

    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    const telemetry = readTelemetryEvents();
    writeFileSync(resultPath, JSON.stringify({
      ok: false,
      runDir,
      appDataDir,
      error: error instanceof Error ? error.stack : String(error),
      checks,
      telemetry: {
        logDirectory: telemetry.logDirectory,
        files: telemetry.files,
        eventCount: telemetry.events.length,
        motionEvents: motionEvents(telemetry.events).map((event) => event.payload),
        feedbackEvents: feedbackEvents(telemetry.events).map((event) => event.payload)
      }
    }, null, 2));
    log(`failed=${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    pet?.cdp.close();
    chat?.cdp.close();
    child.kill();
    await sleep(1_000);
  }
}

await main();

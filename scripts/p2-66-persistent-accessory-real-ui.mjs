import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanupRealUiRun,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  findScreenshotResidue,
  openAppearanceSettings,
  setDialogueMode,
  sleep,
  startElectron,
  stopElectron,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";

const RUN_NAME = "p2-66-persistent-accessory-real-ui";
const ACCESSORY_IDS = ["ghost", "bow", "glasses", "hat", "staff", "game-controller", "microphone"];
const FULL_SELECTION = ["ghost", "bow", "glasses", "hat", "staff"];
const PRIVATE_ACCESSORY_TERMS = /(?:param(?:eter)?|part|expression|path|file)/i;

export function signatureChanged(left, right) {
  return Boolean(left && right && (left.hash !== right.hash || left.length !== right.length));
}

export function matchesAccessorySelection(value, expected) {
  return Array.isArray(value) && value.length === expected.length && value.every((id, index) => id === expected[index]);
}

export function hasPrivateAccessorySurface(value) {
  const pending = [value];
  const visited = new Set();

  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === "string" && PRIVATE_ACCESSORY_TERMS.test(current)) return true;
    if (!current || typeof current !== "object" || visited.has(current)) continue;
    visited.add(current);
    for (const [key, child] of Object.entries(current)) {
      if (PRIVATE_ACCESSORY_TERMS.test(key)) return true;
      pending.push(child);
    }
  }

  return false;
}

async function captureScreenshotSignature(page) {
  const result = await page.cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false
  });
  const image = Buffer.from(result.data, "base64");
  return {
    length: image.length,
    hash: createHash("sha256").update(image).digest("hex").slice(0, 20)
  };
}

function readTelemetryEvents(context) {
  const logDirectory = join(context.appDataDir, "logs");
  if (!existsSync(logDirectory)) return [];

  const events = [];
  for (const name of readdirSync(logDirectory).filter((entry) => entry.startsWith("telemetry-") && entry.endsWith(".jsonl")).sort()) {
    for (const line of readFileSync(join(logDirectory, name), "utf8").split(/\r?\n/u)) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        // Ignore a partially written line while Electron is still appending telemetry.
      }
    }
  }
  return events.map((event, index) => ({ ...event, __index: index }));
}

function lastTelemetryIndex(context) {
  return readTelemetryEvents(context).length - 1;
}

async function waitForTelemetry(context, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const event = readTelemetryEvents(context).find(predicate);
    if (event) return event;
    await sleep(150);
  }
  throw new Error(`telemetry-timeout:${label}`);
}

async function openChat(pet) {
  await evaluate(pet, "window.petApi?.openChat()");
  return waitForWindow(pet.context, "renderer/chat/index.html", 20_000);
}

async function saveAccessorySelection(chat, selection) {
  await openAppearanceSettings(chat);
  const expected = JSON.stringify(selection);
  const visibleSelection = await evaluate(chat, `
    (() => {
      const root = document.querySelector("#pet-accessory-groups");
      if (!root) throw new Error("missing-accessory-groups");
      for (const fieldset of root.querySelectorAll("fieldset")) {
        const selected = [...fieldset.querySelectorAll("input[type=radio]")]
          .find((input) => ${expected}.includes(input.value))
          ?? fieldset.querySelector('input[type=radio][value="none"]');
        if (!selected) throw new Error("missing-accessory-radio");
        selected.checked = true;
        selected.dispatchEvent(new Event("change", { bubbles: true }));
      }
      document.querySelector("#save-pet-accessory-button")?.click();
      return [...root.querySelectorAll("input[type=radio]:checked")]
        .map((input) => input.value)
        .filter((id) => id !== "none");
    })()
  `);

  if (!matchesAccessorySelection(visibleSelection, selection)) {
    throw new Error(`chat-ui-selection-mismatch:${JSON.stringify({ visibleSelection, selection })}`);
  }

  await waitFor(
    chat,
    `window.petPresentationApi.getPreferences().then((value) => JSON.stringify(value.accessoryIds) === ${JSON.stringify(expected)})`,
    { timeoutMs: 10_000 }
  );
  await waitFor(chat, "document.querySelector('#pet-accessory-status')?.dataset.state !== 'fallback' || document.querySelector('#pet-accessory-status')?.textContent.includes('无配件')");

  return evaluate(chat, `
    (async () => ({
      preferences: await window.petPresentationApi.getPreferences(),
      status: document.querySelector("#pet-accessory-status")?.textContent ?? ""
    }))()
  `);
}

async function inspectPublicAccessorySurface(chat) {
  return evaluate(chat, `
    (async () => ({
      apiKeys: Object.keys(window.petPresentationApi ?? {}).sort(),
      preferences: await window.petPresentationApi?.getPreferences(),
      appearanceText: document.querySelector("#settings-appearance-page")?.textContent ?? "",
      radioValues: [...document.querySelectorAll("#pet-accessory-groups input[type=radio]")]
        .map((input) => ({ name: input.name, value: input.value }))
    }))()
  `);
}

async function triggerBodyAction(pet, randomValue) {
  await evaluate(pet, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      if (!canvas) throw new Error("missing-pet-canvas");
      const key = "__P2_66_ORIGINAL_RANDOM__";
      globalThis[key] ??= Math.random;
      Math.random = () => ${randomValue};
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width * 0.5;
      const y = rect.top + rect.height * 0.56;
      for (const type of ["pointerdown", "pointerup"]) {
        canvas.dispatchEvent(new PointerEvent(type, {
          pointerId: 66,
          pointerType: "mouse",
          clientX: x,
          clientY: y,
          screenX: x,
          screenY: y,
          buttons: type === "pointerdown" ? 1 : 0,
          bubbles: true
        }));
      }
      window.setTimeout(() => {
        if (globalThis[key]) Math.random = globalThis[key];
      }, 350);
    })()
  `);
}

async function runActionRestoreCase(context, pet, chat, actionType, randomValue) {
  const startIndex = lastTelemetryIndex(context);
  await triggerBodyAction(pet, randomValue);
  const started = await waitForTelemetry(
    context,
    (event) => event.__index > startIndex && event.type === "pet_interaction_action_started" &&
      event.payload?.reason === "click_body" && event.payload?.type === actionType,
    6_000,
    `${actionType}-started`
  );
  const activeFrame = await captureScreenshotSignature(pet);
  const finished = await waitForTelemetry(
    context,
    (event) => event.__index > started.__index && event.type === "pet_interaction_action_finished" &&
      event.payload?.reason === "click_body" && event.payload?.type === actionType,
    8_000,
    `${actionType}-finished`
  );
  await sleep(500);
  const restoredFrame = await captureScreenshotSignature(pet);
  const preferences = await evaluate(chat, "window.petPresentationApi.getPreferences()");

  return {
    started: { type: started.payload?.type ?? null, reason: started.payload?.reason ?? null },
    finished: { type: finished.payload?.type ?? null, reason: finished.payload?.reason ?? null },
    activeFrame,
    restoredFrame,
    visualTransitionCaptured: signatureChanged(activeFrame, restoredFrame),
    restoredLatestSelection: matchesAccessorySelection(preferences.accessoryIds, FULL_SELECTION)
  };
}

async function waitForStartupAppearance(context, afterIndex) {
  const started = await waitForTelemetry(
    context,
    (event) => event.__index > afterIndex && event.type === "pet_interaction_action_started" &&
      event.payload?.type === "appearance" && event.payload?.reason === "startup_first_visible_frame",
    12_000,
    "appearance-started"
  );
  const finished = await waitForTelemetry(
    context,
    (event) => event.__index > started.__index && event.type === "pet_interaction_action_finished" &&
      event.payload?.type === "appearance" && event.payload?.reason === "startup_first_visible_frame",
    12_000,
    "appearance-finished"
  );
  return { started: started.__index, finished: finished.__index };
}

async function waitForElectronStopped(port, pid) {
  const deadline = Date.now() + 6_000;
  while (Date.now() < deadline) {
    const debuggerClosed = await fetch(`http://127.0.0.1:${port}/json/version`)
      .then(() => false)
      .catch(() => true);
    let processStopped = true;
    if (pid) {
      try {
        process.kill(pid, 0);
        processStopped = false;
      } catch {}
    }
    if (debuggerClosed && processStopped) return true;
    await sleep(200);
  }
  return false;
}

async function main() {
  const context = createRealUiRunContext({
    runName: RUN_NAME,
    port: Number(process.env.P2_66_CDP_PORT || 9686),
    tmpResiduePatterns: [/^p2-66-persistent-accessory-real-ui/i]
  });
  const startedAt = Date.now();
  const checks = {};
  const evidence = { singleSelections: {}, heldPropSwitches: {}, actions: {} };
  const cleanup = { firstElectronStopped: false, electronStopped: false, screenshotResidue: [], tmpRemoved: false };
  let failure = null;
  let electronPid = null;

  try {
    startElectron(context);
    electronPid = context.child?.pid ?? null;
    await connectToElectron(context, 40_000);
    let pet = await waitForWindow(context, "renderer/pet/index.html", 30_000);
    pet.context = context;
    await waitFor(pet, "Boolean(window.petApi && document.querySelector('#pet-canvas'))", { timeoutMs: 20_000 });
    await waitForTelemetry(context, (event) => event.payload?.renderer === "live2d", 20_000, "live2d-renderer");
    checks.realElectronLive2DRenderer = true;

    let chat = await openChat(pet);
    chat.context = context;
    await waitFor(chat, "Boolean(document.querySelector('#chat-page') && window.petPresentationApi)");
    await openAppearanceSettings(chat);
    const publicSurface = await inspectPublicAccessorySurface(chat);
    checks.publicAccessorySurfaceOnly = !hasPrivateAccessorySurface(publicSurface) &&
      publicSurface.apiKeys.every((key) => !PRIVATE_ACCESSORY_TERMS.test(key)) &&
      publicSurface.radioValues.every((item) => !PRIVATE_ACCESSORY_TERMS.test(item.name) && !PRIVATE_ACCESSORY_TERMS.test(item.value));
    if (!checks.publicAccessorySurfaceOnly) throw new Error("private-accessory-surface-exposed");

    for (const accessoryId of ACCESSORY_IDS) {
      await saveAccessorySelection(chat, []);
      await sleep(450);
      const withoutAccessory = await captureScreenshotSignature(pet);
      const saved = await saveAccessorySelection(chat, [accessoryId]);
      await sleep(650);
      const withAccessory = await captureScreenshotSignature(pet);
      const restored = matchesAccessorySelection(saved.preferences.accessoryIds, [accessoryId]);
      const visualChanged = signatureChanged(withoutAccessory, withAccessory);
      evidence.singleSelections[accessoryId] = { restored, visualChanged, withoutAccessory, withAccessory };
      if (!restored || !visualChanged) throw new Error(`single-accessory-check-failed:${accessoryId}`);
    }
    checks.allSevenSinglesSavedAndRendered = Object.values(evidence.singleSelections)
      .every((item) => item.restored && item.visualChanged);

    for (const heldProp of ["staff", "game-controller", "microphone"]) {
      const selected = ["ghost", "bow", "glasses", "hat", heldProp];
      const saved = await saveAccessorySelection(chat, selected);
      const exact = matchesAccessorySelection(saved.preferences.accessoryIds, selected);
      evidence.heldPropSwitches[heldProp] = { exact, saved: saved.preferences.accessoryIds };
      if (!exact) throw new Error(`held-prop-switch-failed:${heldProp}`);
    }
    checks.heldPropsMutuallyExclusive = Object.values(evidence.heldPropSwitches).every((item) => item.exact);

    const workBaseline = ["ghost", "bow", "hat", "staff"];
    await saveAccessorySelection(chat, workBaseline);
    await sleep(500);
    const baselineFrame = await captureScreenshotSignature(pet);
    await setDialogueMode(chat, "work");
    await sleep(900);
    const workFrame = await captureScreenshotSignature(pet);
    const duringWorkPreferences = await evaluate(chat, "window.petPresentationApi.getPreferences()");
    await setDialogueMode(chat, "default");
    await sleep(900);
    const restoredWorkFrame = await captureScreenshotSignature(pet);
    const afterWorkPreferences = await evaluate(chat, "window.petPresentationApi.getPreferences()");
    evidence.workOverlay = {
      baselineFrame,
      workFrame,
      restoredWorkFrame,
      workChangedPixels: signatureChanged(baselineFrame, workFrame),
      restoredPixels: signatureChanged(workFrame, restoredWorkFrame),
      userBaselineUnchangedDuringWork: matchesAccessorySelection(duringWorkPreferences.accessoryIds, workBaseline),
      userBaselineUnchangedAfterWork: matchesAccessorySelection(afterWorkPreferences.accessoryIds, workBaseline)
    };
    checks.workGlassesOverlayDoesNotWriteUserBaseline = Object.values(evidence.workOverlay)
      .filter((value) => typeof value === "boolean")
      .every(Boolean);
    if (!checks.workGlassesOverlayDoesNotWriteUserBaseline) throw new Error("work-accessory-overlay-failed");

    await saveAccessorySelection(chat, FULL_SELECTION);
    const finalFirstSessionPreferences = await evaluate(chat, "window.petPresentationApi.getPreferences()");
    if (!matchesAccessorySelection(finalFirstSessionPreferences.accessoryIds, FULL_SELECTION)) {
      throw new Error("full-selection-save-failed");
    }

    await stopElectron(context);
    cleanup.firstElectronStopped = await waitForElectronStopped(context.port, electronPid);
    if (!cleanup.firstElectronStopped) throw new Error("first-electron-process-did-not-stop");
    await sleep(1_000);

    const restartIndex = lastTelemetryIndex(context);
    startElectron(context);
    electronPid = context.child?.pid ?? null;
    await connectToElectron(context, 40_000);
    pet = await waitForWindow(context, "renderer/pet/index.html", 30_000);
    pet.context = context;
    await waitFor(pet, "Boolean(window.petApi && document.querySelector('#pet-canvas'))", { timeoutMs: 20_000 });
    evidence.appearance = await waitForStartupAppearance(context, restartIndex);
    chat = await openChat(pet);
    chat.context = context;
    await waitFor(chat, "Boolean(document.querySelector('#chat-page') && window.petPresentationApi)");
    const restartedPreferences = await evaluate(chat, "window.petPresentationApi.getPreferences()");
    evidence.restart = { selection: restartedPreferences.accessoryIds };
    checks.restartRestoresLatestSelection = matchesAccessorySelection(restartedPreferences.accessoryIds, FULL_SELECTION);
    if (!checks.restartRestoresLatestSelection) throw new Error("restart-selection-not-restored");

    await setDialogueMode(chat, "default");
    await sleep(700);
    evidence.actions.greeting = await runActionRestoreCase(context, pet, chat, "greeting", 0.01);
    evidence.actions.thinking = await runActionRestoreCase(context, pet, chat, "thinking", 0.5);
    evidence.actions.playGame = await runActionRestoreCase(context, pet, chat, "playGame", 0.63);
    evidence.actions.reading = await runActionRestoreCase(context, pet, chat, "reading", 0.72);
    checks.actionsRestoreLatestSelection = Object.values(evidence.actions)
      .every((item) => item.restoredLatestSelection && item.visualTransitionCaptured);
    if (!checks.actionsRestoreLatestSelection) throw new Error("action-accessory-restoration-failed");

    checks.appearanceRestoresLatestSelection = Boolean(evidence.appearance) && checks.restartRestoresLatestSelection;
    checks.combinationSelected = matchesAccessorySelection(
      (await evaluate(chat, "window.petPresentationApi.getPreferences()")).accessoryIds,
      FULL_SELECTION
    );
  } catch (error) {
    failure = {
      name: error instanceof Error ? error.name : "Error",
      message: String(error instanceof Error ? error.message : error).slice(0, 600)
    };
  } finally {
    writeFileSync(context.resultPath, `${JSON.stringify({ checks, evidence, failure }, null, 2)}\n`, "utf8");
    await stopElectron(context);
    cleanup.electronStopped = await waitForElectronStopped(context.port, electronPid);
    cleanup.screenshotResidue = findScreenshotResidue(context)
      .filter((path) => !path.includes(context.runParentDir));
    cleanupRealUiRun(context);
    cleanup.tmpRemoved = !existsSync(context.runParentDir);
  }

  checks.noScreenshotResidue = cleanup.screenshotResidue.length === 0;
  checks.electronStopped = cleanup.firstElectronStopped && cleanup.electronStopped;
  checks.tmpRemoved = cleanup.tmpRemoved;
  const summary = {
    ok: failure === null && Object.values(checks).every(Boolean),
    fakeProvider: true,
    renderer: "electron-live2d",
    visualBoundary: "technical-rendering-only; no VTube Studio or user visual-quality verdict",
    durationMs: Date.now() - startedAt,
    checks,
    evidence,
    cleanup,
    failure
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}

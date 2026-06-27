import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  cleanupRealUiRun,
  click,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  findScreenshotResidue,
  getPageByUrlPart,
  log as logRun,
  readPrivacyCheckText,
  saveWelcomeProfile,
  sleep,
  startElectron,
  stopElectron,
  waitFor
} from "./support/real-ui-harness.mjs";

const context = createRealUiRunContext({
  runName: "p2-13g-presence-mode-budget-real-ui",
  port: Number(process.env.P2_13G_CDP_PORT || 9586)
});
const { root, runParentDir, runDir, appDataDir, resultPath, port } = context;

const forbiddenTexts = [
  "sk-",
  ".env.local",
  "provider request body",
  "system prompt",
  "complete prompt",
  "fact card body",
  "P2-13G-private"
];

function log(message) {
  logRun(context, message);
}

async function openChat() {
  startElectron(context);
  await connectToElectron(context);
  const pet = await getPageByUrlPart(context, "renderer/pet/index.html");
  await sleep(900);
  await evaluate(pet, "window.petApi?.openChat()");
  const chat = await getPageByUrlPart(context, "renderer/chat/index.html");
  await waitFor(chat, "document.querySelector('#provider-status')?.textContent.includes('Fake Provider')");
  await saveWelcomeProfile(chat, { displayName: "P2-13G", preferredName: "P2-13G" });
  return { pet, chat };
}

async function setPresenceMode(chat, modeId) {
  await click(chat, `#presence-mode-controls .mode-button[data-mode-id="${modeId}"]`);
  await waitFor(chat, `document.querySelector('#presence-mode-controls .mode-button.is-active')?.dataset.modeId === ${JSON.stringify(modeId)}`);
}

async function readUiPresenceSnapshot(chat) {
  return evaluate(chat, `
    (() => ({
      presenceButtonCount: document.querySelectorAll("#presence-mode-controls .mode-button").length,
      activePresenceModeId: document.querySelector("#presence-mode-controls .mode-button.is-active")?.dataset.modeId ?? "",
      partnerHasPresence: (document.querySelector("#partner-status")?.textContent ?? "").includes("存在："),
      settingsHasPresence: (document.querySelector("#settings-presence-mode-summary")?.textContent ?? "").includes("当前存在"),
      shelfVisible: document.querySelector("#companion-control-shelf")?.hidden === false
    }))()
  `);
}

function readTelemetryEvents() {
  const logDirectory = join(appDataDir, "logs");
  if (!existsSync(logDirectory)) {
    return [];
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
      events.push(JSON.parse(line));
    }
  }

  return events;
}

async function waitForTelemetryEvent(predicate, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const event = readTelemetryEvents().find(predicate);
    if (event) {
      return event;
    }
    await sleep(250);
  }

  return null;
}

async function waitForPerformanceSample(modeId, targetFramesPerSecond) {
  return waitForTelemetryEvent((event) => (
    event.type === "pet_performance_sample" &&
    event.payload?.presenceModeId === modeId &&
    event.payload?.mode === "idle" &&
    event.payload?.targetFramesPerSecond === targetFramesPerSecond
  ), 16_000);
}

async function clickPet(page, hitArea = "body", randomValue = 0.999) {
  await evaluate(page, `Math.random = () => ${randomValue}`);
  await evaluate(page, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width * 0.5;
      const y = rect.top + rect.height * ${hitArea === "head" ? "0.2" : "0.48"};
      canvas.dispatchEvent(new PointerEvent("pointerdown", {
        pointerId: 29,
        pointerType: "mouse",
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        buttons: 1,
        bubbles: true
      }));
      canvas.dispatchEvent(new PointerEvent("pointerup", {
        pointerId: 29,
        pointerType: "mouse",
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        bubbles: true
      }));
    })()
  `);
  await sleep(320);
}

async function clickPetUntilTelemetry(page, predicate, options = {}) {
  const attempts = options.attempts ?? 4;
  const hitArea = options.hitArea ?? "body";
  const randomValue = options.randomValue ?? 0.999;
  const pauseMs = options.pauseMs ?? 1_100;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await clickPet(page, hitArea, randomValue);
    const event = await waitForTelemetryEvent(predicate, 2_500);
    if (event) {
      return event;
    }
    await sleep(pauseMs);
  }

  return null;
}

function hasForbiddenText() {
  const text = readPrivacyCheckText(context);
  return forbiddenTexts.some((item) => text.includes(item));
}

async function main() {
  log(`runDir=${runDir}`);
  log(`appDataDir=${appDataDir}`);

  const checks = {};
  const observations = {
    budgets: {},
    quietCandidateActionTypes: [],
    sleepCandidateActionTypes: []
  };

  try {
    let handles = await openChat();
    let chat = handles.chat;
    let pet = handles.pet;

    const initialSnapshot = await readUiPresenceSnapshot(chat);
    checks.initialDefaultPresence = initialSnapshot.activePresenceModeId === "default";
    checks.presenceUiAvailable = initialSnapshot.presenceButtonCount === 4 &&
      initialSnapshot.partnerHasPresence &&
      initialSnapshot.settingsHasPresence &&
      initialSnapshot.shelfVisible;

    const expectedBudgets = {
      default: 30,
      focus: 24,
      quiet: 20,
      sleep: 12
    };

    for (const [modeId, targetFps] of Object.entries(expectedBudgets)) {
      await setPresenceMode(chat, modeId);
      const sample = await waitForPerformanceSample(modeId, targetFps);
      observations.budgets[modeId] = sample?.payload?.targetFramesPerSecond ?? null;
      checks[`budget_${modeId}`] = Boolean(sample);
    }

    const presenceChanges = readTelemetryEvents().filter((event) => event.type === "presence_mode_changed");
    checks.presenceTelemetrySafeSummary = presenceChanges.some((event) => (
      event.payload?.previousModeId === "default" &&
      event.payload?.nextModeId === "focus" &&
      event.payload?.reason === "chat_ui"
    ));

    await setPresenceMode(chat, "quiet");
    const quietAction = await clickPetUntilTelemetry(pet, (event) => (
      event.type === "pet_interaction_action_started" &&
      event.payload?.reason === "click_body" &&
      event.payload?.presenceModeId === "quiet" &&
      Array.isArray(event.payload?.candidateActionTypes) &&
      !event.payload.candidateActionTypes.includes("playGame") &&
      !event.payload.candidateActionTypes.includes("reading")
    ));
    observations.quietCandidateActionTypes = quietAction?.payload?.candidateActionTypes ?? [];
    checks.quietFiltersStrongActions = Boolean(quietAction);

    await sleep(2_400);
    await setPresenceMode(chat, "sleep");
    const sleepAction = await clickPetUntilTelemetry(pet, (event) => (
      event.type === "pet_interaction_action_started" &&
      event.payload?.reason === "click_body" &&
      event.payload?.presenceModeId === "sleep" &&
      Array.isArray(event.payload?.candidateActionTypes) &&
      !event.payload.candidateActionTypes.includes("playGame") &&
      !event.payload.candidateActionTypes.includes("reading") &&
      event.payload.candidateActionTypes.includes("thinking") &&
      event.payload.candidateActionTypes.includes("focus")
    ));
    observations.sleepCandidateActionTypes = sleepAction?.payload?.candidateActionTypes ?? [];
    checks.sleepFiltersStrongActions = Boolean(sleepAction);

    await sleep(2_400);
    const headPat = await clickPetUntilTelemetry(pet, (event) => (
      event.type === "pet_interaction_action_started" &&
      event.payload?.reason === "click_head" &&
      event.payload?.type === "headPat"
    ), { hitArea: "head", randomValue: 0.1 });
    checks.headPatStillWorks = Boolean(headPat);

    await stopElectron(context);
    handles = await openChat();
    chat = handles.chat;
    pet = handles.pet;
    void pet;
    await waitFor(chat, "document.querySelector('#presence-mode-controls .mode-button.is-active')?.dataset.modeId === 'sleep'", { timeoutMs: 10_000 });
    const restartSnapshot = await readUiPresenceSnapshot(chat);
    checks.restartRestoresPresence = restartSnapshot.activePresenceModeId === "sleep";

    checks.privacyOutput = !hasForbiddenText();
    checks.noScreenshotResidueBeforeCleanup = findScreenshotResidue(context).filter((path) => !path.includes(runParentDir)).length === 0;

    const events = readTelemetryEvents();
    const result = {
      ok: Object.values(checks).every(Boolean),
      runDir,
      appDataDir,
      port,
      provider: "fake",
      checks,
      observations,
      telemetry: {
        eventCount: events.length,
        presenceChangeCount: events.filter((event) => event.type === "presence_mode_changed").length,
        performanceSampleCount: events.filter((event) => event.type === "pet_performance_sample").length,
        containsForbiddenText: hasForbiddenText()
      },
      screenshotResidue: findScreenshotResidue(context)
    };

    writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
    log(`checks=${JSON.stringify(checks)}`);

    if (!result.ok) {
      throw new Error(`P2-13G real UI checks failed: ${JSON.stringify(checks)}`);
    }
  } catch (error) {
    writeFileSync(resultPath, `${JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      checks,
      observations
    }, null, 2)}\n`);
    throw error;
  } finally {
    await stopElectron(context);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
}).finally(() => {
  if (process.env.P2_13G_KEEP_TMP !== "1") {
    cleanupRealUiRun(context);
  }
});

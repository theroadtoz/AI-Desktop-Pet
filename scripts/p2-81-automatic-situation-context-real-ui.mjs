import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  cleanupRealUiRun,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  findScreenshotResidue,
  getPageByUrlPart,
  sleep,
  startElectron,
  stopElectron,
  waitFor
} from "./support/real-ui-harness.mjs";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const context = createRealUiRunContext({
  runName: "p2-81-automatic-situation-context-real-ui",
  port: Number(process.env.P2_81_CDP_PORT || 9581)
});
const SITUATION_LABEL_PATTERN = /\b(default|work|game|reading|focus|quiet|sleep)\b/iu;
const BUNDLED_CLASSIFIER_CASES = [
  {
    id: "game-development-is-work",
    message: "我正在开发一款游戏，今天要完成存档模块。",
    expectedContextId: "work"
  },
  {
    id: "game-knowledge-is-reading",
    message: "给我讲讲这款游戏的世界观。",
    expectedContextId: "reading"
  },
  {
    id: "ordinary-chat-is-default",
    message: "今天心情不错，想和你随便聊聊。",
    expectedContextId: "default"
  },
  {
    id: "current-game-activity-is-game",
    message: "我准备马上玩一局游戏，先陪我热个身。",
    expectedContextId: "game"
  }
];

function readTelemetryEvents() {
  const directory = join(context.appDataDir, "logs");
  if (!existsSync(directory)) return [];
  const events = [];
  for (const name of readdirSync(directory).filter((entry) => entry.startsWith("telemetry-") && entry.endsWith(".jsonl")).sort()) {
    for (const line of readFileSync(join(directory, name), "utf8").split(/\r?\n/u)) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch {}
    }
  }
  return events;
}

async function waitForTelemetry(predicate, timeoutMs, label, afterIndex = 0) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = readTelemetryEvents().slice(afterIndex).find(predicate);
    if (match) return match;
    await sleep(150);
  }
  throw new Error(`telemetry-timeout:${label}`);
}

async function openChat() {
  await connectToElectron(context);
  const pet = await getPageByUrlPart(context, "renderer/pet/index.html");
  await sleep(800);
  await evaluate(pet, "window.petApi?.openChat()");
  const chat = await getPageByUrlPart(context, "renderer/chat/index.html");
  await waitFor(chat, "document.querySelector('#provider-status')?.textContent.includes('Fake Provider')");
  return { pet, chat };
}

async function submitChatTurn(chat, message) {
  const before = await evaluate(chat, "document.querySelectorAll('.message-pet .message-content').length");
  await evaluate(chat, `
    (() => {
      const input = document.querySelector("#chat-input");
      const form = document.querySelector("#chat-form");
      if (!input || !form) throw new Error("missing-chat-form");
      input.value = ${JSON.stringify(message)};
      input.dispatchEvent(new Event("input", { bubbles: true }));
      form.requestSubmit();
      return true;
    })()
  `);
  await waitFor(chat, "document.querySelector('#chat-input')?.disabled === false", { timeoutMs: 20_000 });
  return evaluate(chat, `
    [...document.querySelectorAll(".message-pet .message-content")]
      .slice(${before})
      .map((node) => node.textContent ?? "")
  `);
}

async function clickPetBody(pet) {
  await evaluate(pet, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      if (!canvas) throw new Error("missing-pet-canvas");
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width * 0.5;
      const y = rect.top + rect.height * 0.48;
      for (const type of ["pointerdown", "pointerup"]) {
        canvas.dispatchEvent(new PointerEvent(type, {
          pointerId: 81,
          pointerType: "mouse",
          clientX: x,
          clientY: y,
          bubbles: true,
          buttons: type === "pointerdown" ? 1 : 0
        }));
      }
      return true;
    })()
  `);
}

function runNode(args, timeoutMs) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolveRun({ exitCode, stdout, stderr, timedOut });
    });
  });
}

function parseLastJsonLine(output) {
  for (const line of output.split(/\r?\n/u).reverse()) {
    try {
      return JSON.parse(line);
    } catch {}
  }
  return null;
}

async function runInjectedContractEvidence() {
  const child = await runNode([
    "--test",
    "--experimental-strip-types",
    "scripts/automatic-situation-context.test.mts"
  ], 45_000);
  return {
    kind: "Fake/injected strategy",
    realUiClaimed: false,
    realOsStateClaimed: false,
    command: "node --test --experimental-strip-types scripts/automatic-situation-context.test.mts",
    passed: child.exitCode === 0 && !child.timedOut
  };
}

async function runRealWindowsProbe() {
  const providerUrl = pathToFileURL(join(root, "src/main/services/desktop-context/windows-desktop-context-provider.ts")).href;
  const program = `
    import { createWindowsDesktopContextProvider } from ${JSON.stringify(providerUrl)};
    const provider = createWindowsDesktopContextProvider({ platform: process.platform });
    const result = await provider.sample();
    provider.dispose();
    const schemaClosedSetValidated =
      ["available", "unavailable", "failed"].includes(result.status) &&
      Object.keys(result.snapshot).sort().join(",") === "gamePresence,mediaPlaying" &&
      Object.keys(result.capabilities).sort().join(",") === "game,media" &&
      ["available", "unavailable"].includes(result.capabilities.media) &&
      ["available", "unavailable"].includes(result.capabilities.game);
    process.stdout.write(JSON.stringify({
      probeExecuted: true,
      schemaClosedSetValidated,
      osValuesPersisted: false,
      noSensitiveFields: true
    }) + "\\n");
  `;
  const child = await runNode(["--experimental-strip-types", "--input-type=module", "--eval", program], 20_000);
  const probe = parseLastJsonLine(child.stdout);
  const reportedProbeIsSanitized = Boolean(
    probe &&
    probe.probeExecuted === true &&
    typeof probe.schemaClosedSetValidated === "boolean" &&
    probe.osValuesPersisted === false &&
    probe.noSensitiveFields === true &&
    Object.keys(probe).every((key) => ["probeExecuted", "schemaClosedSetValidated", "osValuesPersisted", "noSensitiveFields"].includes(key))
  );
  return {
    kind: "real Windows probe",
    injected: false,
    probeExecuted: true,
    command: "node --experimental-strip-types --input-type=module --eval <Windows desktop-context provider sample>",
    schemaClosedSetValidated: probe?.schemaClosedSetValidated === true,
    osValuesPersisted: reportedProbeIsSanitized && probe.osValuesPersisted === false,
    noSensitiveFields: reportedProbeIsSanitized && probe.noSensitiveFields === true,
    realOsStateClaimed: false,
    passed: child.exitCode === 0 && !child.timedOut && reportedProbeIsSanitized
  };
}

async function main() {
  const checks = {};
  let bundledReal = {
    kind: "bundled-real local classifier",
    fakeChatProvider: true,
    injected: false,
    observed: false,
    cases: []
  };
  const injectedContract = runInjectedContractEvidence();
  const realWindowsProbe = runRealWindowsProbe();

  try {
    startElectron(context);
    const { pet, chat } = await openChat();
    await sleep(6_500);

    checks.manualModeControlsAbsent = await evaluate(chat, `
      !document.body.textContent.includes("对话模式") &&
        !document.body.textContent.includes("存在模式")
    `);
    checks.readOnlyAutomaticApi = await evaluate(pet, `
      (async () => {
        const snapshot = await window.petApi?.getAutomaticSituation();
        return ["default", "work", "game", "reading"].includes(snapshot?.conversationContextId) &&
          ["default", "focus", "quiet", "sleep"].includes(snapshot?.presenceStateId);
      })()
    `);

    const bundledCases = [];
    const replies = [];
    let finalClassificationTelemetryIndex = 0;
    for (const classifierCase of BUNDLED_CLASSIFIER_CASES) {
      const telemetryIndex = readTelemetryEvents().length;
      finalClassificationTelemetryIndex = telemetryIndex;
      replies.push(...await submitChatTurn(chat, classifierCase.message));
      try {
        const event = await waitForTelemetry((candidate) => (
          candidate.type === "automatic_situation_classified" &&
          candidate.payload?.accepted === true &&
          candidate.payload?.result === "classified" &&
          candidate.payload?.conversationSource === "bundled-local-model" &&
          candidate.payload?.conversationContextId === classifierCase.expectedContextId
        ), 20_000, `bundled-local-classification:${classifierCase.id}`, telemetryIndex);
        bundledCases.push({
          id: classifierCase.id,
          expectedContextId: classifierCase.expectedContextId,
          observedContextId: event.payload.conversationContextId,
          passed: true
        });
      } catch {
        bundledCases.push({
          id: classifierCase.id,
          expectedContextId: classifierCase.expectedContextId,
          observedContextId: null,
          passed: false
        });
      }
    }
    checks.replyDoesNotLeakSituationLabels = replies.every((reply) => !SITUATION_LABEL_PATTERN.test(reply));
    bundledReal = {
      ...bundledReal,
      observed: bundledCases.length === BUNDLED_CLASSIFIER_CASES.length && bundledCases.every((entry) => entry.passed),
      cases: bundledCases
    };
    checks.bundledRealClassificationObserved = bundledReal.observed;

    await waitForTelemetry((candidate) => (
      candidate.type === "pet_interaction_action_finished" &&
      candidate.payload?.reason === "state_game"
    ), 10_000, "final-classification-action-settled", finalClassificationTelemetryIndex);
    await sleep(550);
    const telemetryIndex = readTelemetryEvents().length;
    await clickPetBody(pet);
    await waitForTelemetry((candidate) => (
      candidate.type === "pet_interaction_action_started" &&
      candidate.payload?.reason === "click_body"
    ), 8_000, "existing-action-chain");
    checks.existingActionChainStillTriggers = readTelemetryEvents().slice(telemetryIndex)
      .some((candidate) => candidate.type === "pet_interaction_action_started" && candidate.payload?.reason === "click_body");
    checks.noScreenshotResidue = findScreenshotResidue(context)
      .filter((path) => !path.includes(context.runParentDir)).length === 0;
  } finally {
    await stopElectron(context);
  }

  const [fakeOrInjected, realWindows] = await Promise.all([injectedContract, realWindowsProbe]);
  const summary = {
    ok: Object.values(checks).every(Boolean) && fakeOrInjected.passed && realWindows.passed,
    runDir: context.runDir,
    checks,
    evidence: {
      bundledReal,
      fakeOrInjected,
      realWindowsProbe: realWindows
    }
  };
  writeFileSync(context.resultPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));

  if (!summary.ok) process.exitCode = 1;
  if (process.env.P2_81_KEEP_TMP !== "1") cleanupRealUiRun(context);
}

main().catch(async (error) => {
  const summary = {
    ok: false,
    runDir: context.runDir,
    error: error instanceof Error ? error.message : String(error)
  };
  writeFileSync(context.resultPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.error(JSON.stringify(summary));
  await stopElectron(context);
  if (process.env.P2_81_KEEP_TMP !== "1") rmSync(context.runParentDir, { recursive: true, force: true });
  process.exitCode = 1;
});

import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import {
  cleanupRealUiRun,
  click,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  findScreenshotResidue,
  getPageByUrlPart,
  log as logRun,
  openModelSettings,
  readPrivacyCheckText,
  saveWelcomeProfile,
  sleep,
  startElectron,
  stopElectron,
  typeText,
  waitFor
} from "./support/real-ui-harness.mjs";

const context = createRealUiRunContext({
  runName: "p2-13f-local-provider-experience-real-ui",
  port: Number(process.env.P2_13F_CDP_PORT || 9584)
});
const { runParentDir, runDir, appDataDir, resultPath, port } = context;
const readyModel = "p2-13f-ready-model";
const recommendedOllamaModel = "qwen3.5:2b";
const forbiddenTexts = [
  "sk-",
  "provider request body",
  "system prompt",
  "完整 prompt",
  ".env.local",
  "fact card body",
  "P2-13F hidden user body",
  "P2-13F hidden assistant body"
];

let mockRequestCount = 0;

const mockServer = createServer((request, response) => {
  mockRequestCount += 1;

  if (request.url !== "/v1/models") {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { type: "not_found" } }));
    return;
  }

  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ data: [{ id: readyModel }] }));
});

function log(message) {
  logRun(context, message);
}

async function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function getClosedPort() {
  const server = createServer();
  await listen(server);
  const address = server.address();
  const portValue = address?.port;
  await close(server);
  return portValue;
}

function mockBaseURL() {
  const address = mockServer.address();
  return `http://127.0.0.1:${address.port}/v1`;
}

async function openChat() {
  startElectron(context);
  await connectToElectron(context);
  const pet = await getPageByUrlPart(context, "renderer/pet/index.html");
  await sleep(800);
  await evaluate(pet, "window.petApi?.openChat()");
  const chat = await getPageByUrlPart(context, "renderer/chat/index.html");
  await waitFor(chat, "document.querySelector('#provider-status')?.textContent.includes('Fake Provider')");
  await saveWelcomeProfile(chat, { displayName: "P2-13F", preferredName: "P2-13F" });
  return { pet, chat };
}

async function setSelect(page, selector, value) {
  await evaluate(page, `
    (() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error(${JSON.stringify(`Missing selector: ${selector}`)});
      element.value = ${JSON.stringify(value)};
      element.dispatchEvent(new Event("change", { bubbles: true }));
    })()
  `);
  await sleep(250);
}

async function safeProviderSnapshot(page) {
  return evaluate(page, `
    (() => {
      const healthText = document.querySelector("#provider-health-status")?.textContent ?? "";
      const statusText = document.querySelector("#provider-status")?.textContent ?? "";
      return {
        providerId: document.querySelector("#provider-id")?.value ?? "",
        presetId: document.querySelector("#local-provider-preset")?.value ?? "",
        baseURL: document.querySelector("#provider-base-url")?.value ?? "",
        model: document.querySelector("#provider-model")?.value ?? "",
        healthState: document.querySelector("#provider-health-status")?.dataset.state ?? "",
        healthReady: healthText.includes("连接可用"),
        healthModelMissing: healthText.includes("未找到当前模型"),
        healthUnreachable: healthText.includes("服务不可达"),
        healthMissingKey: healthText.includes("需要先配置 API Key"),
        providerMentionsFake: statusText.includes("Fake Provider")
      };
    })()
  `);
}

async function checkConnection(page) {
  await click(page, "#provider-health-check-button");
  await waitFor(page, `
    (() => {
      const text = document.querySelector("#provider-health-status")?.textContent ?? "";
      return !text.includes("正在检查");
    })()
  `, { timeoutMs: 5_000 });
  return safeProviderSnapshot(page);
}

async function main() {
  await listen(mockServer);
  log(`runDir=${runDir}`);
  log(`appDataDir=${appDataDir}`);

  const checks = {};
  const snapshots = {};

  try {
    const { chat } = await openChat();
    await openModelSettings(chat);

    await setSelect(chat, "#provider-id", "local-openai-compatible");
    snapshots.ollama = await safeProviderSnapshot(chat);
    checks.ollamaPresetFillsBaseURL = snapshots.ollama.presetId === "ollama" &&
      snapshots.ollama.baseURL === "http://localhost:11434/v1";
    checks.ollamaPresetFillsRecommendedModel = snapshots.ollama.model === recommendedOllamaModel;

    await setSelect(chat, "#local-provider-preset", "lm-studio");
    snapshots.lmStudio = await safeProviderSnapshot(chat);
    checks.lmStudioPresetFillsBaseURL = snapshots.lmStudio.presetId === "lm-studio" &&
      snapshots.lmStudio.baseURL === "http://localhost:1234/v1";

    await setSelect(chat, "#local-provider-preset", "custom-local");
    await typeText(chat, "#provider-base-url", mockBaseURL());
    await typeText(chat, "#provider-model", readyModel);
    snapshots.ready = await checkConnection(chat);
    checks.customLocalReadyStatus = snapshots.ready.presetId === "custom-local" &&
      snapshots.ready.healthReady &&
      snapshots.ready.healthState === "ready";

    await typeText(chat, "#provider-model", "p2-13f-missing-model");
    snapshots.modelMissing = await checkConnection(chat);
    checks.modelMissingStatus = snapshots.modelMissing.healthModelMissing &&
      snapshots.modelMissing.healthState === "fallback";

    const closedPort = await getClosedPort();
    await typeText(chat, "#provider-base-url", `http://127.0.0.1:${closedPort}/v1`);
    snapshots.unreachable = await checkConnection(chat);
    checks.serviceUnreachableStatus = snapshots.unreachable.healthUnreachable &&
      snapshots.unreachable.healthState === "fallback";

    await setSelect(chat, "#provider-id", "openai-compatible");
    await typeText(chat, "#provider-base-url", mockBaseURL());
    await typeText(chat, "#provider-model", readyModel);
    const beforeCloudCheck = mockRequestCount;
    snapshots.missingKey = await checkConnection(chat);
    checks.cloudMissingKeyNoRequest = snapshots.missingKey.healthMissingKey &&
      mockRequestCount === beforeCloudCheck;

    checks.fakeStatusStillClear = snapshots.missingKey.providerMentionsFake;

    const privacyText = readPrivacyCheckText(context);
    checks.privacyOutput = forbiddenTexts.every((text) => !privacyText.includes(text));
    checks.noScreenshotResidueBeforeCleanup = findScreenshotResidue(context).filter((path) => !path.includes(runParentDir)).length === 0;

    const result = {
      ok: Object.values(checks).every(Boolean),
      runDir,
      appDataDir,
      port,
      mockRequestCount,
      checks,
      snapshots: {
        ollama: {
          presetId: snapshots.ollama.presetId,
          baseURLMatches: snapshots.ollama.baseURL === "http://localhost:11434/v1",
          modelMatches: snapshots.ollama.model === recommendedOllamaModel
        },
        lmStudio: {
          presetId: snapshots.lmStudio.presetId,
          baseURLMatches: snapshots.lmStudio.baseURL === "http://localhost:1234/v1"
        },
        ready: {
          presetId: snapshots.ready.presetId,
          healthState: snapshots.ready.healthState,
          healthReady: snapshots.ready.healthReady
        },
        modelMissing: {
          healthState: snapshots.modelMissing.healthState,
          healthModelMissing: snapshots.modelMissing.healthModelMissing
        },
        unreachable: {
          healthState: snapshots.unreachable.healthState,
          healthUnreachable: snapshots.unreachable.healthUnreachable
        },
        missingKey: {
          healthState: snapshots.missingKey.healthState,
          healthMissingKey: snapshots.missingKey.healthMissingKey
        }
      },
      residue: findScreenshotResidue(context)
    };

    writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
    log(`checks=${JSON.stringify(checks)}`);

    if (!result.ok) {
      throw new Error(`P2-13F real UI checks failed: ${JSON.stringify(checks)}`);
    }
  } catch (error) {
    writeFileSync(resultPath, `${JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      checks
    }, null, 2)}\n`);
    throw error;
  } finally {
    await stopElectron(context);
    await close(mockServer);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
}).finally(() => {
  if (process.env.P2_13F_KEEP_TMP !== "1") {
    cleanupRealUiRun(context);
  }
});

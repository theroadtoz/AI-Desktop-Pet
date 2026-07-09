import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNoScreenshotResidue,
  chatUiSelectors,
  cleanupRealUiRun,
  click,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  getPageByUrlPart,
  log,
  startElectron,
  stopElectron,
  typeText,
  waitFor
} from "./support/real-ui-harness.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runName = "p2-53-startup-local-model-immediate-dialogue";
const port = readPositiveInteger(process.env.P2_53_CDP_PORT) ?? 9643;

const context = createRealUiRunContext({
  runName,
  port,
  env: {
    AI_DESKTOP_PET_PROVIDER: "",
    AI_DESKTOP_PET_API_KEY: "",
    AI_DESKTOP_PET_BASE_URL: "",
    AI_DESKTOP_PET_MODEL: "",
    AI_DESKTOP_PET_BUNDLED_LLAMA_CPP_ROOT: join(root, ".tmp", runName, "missing-local-llm-pack"),
    AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1"
  },
  tmpResiduePatterns: [
    new RegExp(`^${escapeRegExp(runName)}$`, "i")
  ]
});

main().catch((error) => {
  const summary = createSummary({
    ok: false,
    checks: { script: false },
    providerConfig: null,
    providerStatus: null,
    statusText: "",
    reply: null,
    failureCategory: classifyError(error),
    durationMs: 0
  });
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = 1;
});

async function main() {
  const startedAt = Date.now();
  let providerConfig = null;
  let providerStatus = null;
  let statusText = "";
  let reply = null;

  try {
    log(context, "starting fresh startup UI without configured provider or bundled model resources");
    const { chat } = await startApp();

    providerConfig = await evaluate(chat, "window.configApi?.getProvider()");
    providerStatus = await waitForStartupFallbackStatus(chat);
    statusText = await evaluate(chat, "document.querySelector('#provider-status')?.textContent ?? ''");
    reply = await sendFirstMessage(chat);

    const visibleText = await evaluate(chat, "document.body.innerText ?? ''");
    const checks = {
      defaultConfigStillEmbeddedLocal: providerConfig?.providerId === "local-openai-compatible" &&
        providerConfig?.localPresetId === "embedded-llama-cpp",
      runtimeUsesImmediateFallback: providerStatus?.providerId === "fake" &&
        providerStatus?.displayName === "本地即时对话" &&
        providerStatus?.isFallback === false,
      statusExplainsImmediateLocalDialogue: statusText.includes("本地即时对话") &&
        statusText.includes("自动切换") &&
        !statusText.includes("Fake Provider"),
      firstMessageGetsPetReply: reply?.petMessageCount >= 1 && reply?.lastPetReplyLength > 0,
      noMisleadingStartupError: !/连接失败|baseURL|切换到本地 Ollama|确认 Ollama 已安装并启动/.test(visibleText),
      missingPackWasNotCreated: !existsSync(context.env.AI_DESKTOP_PET_BUNDLED_LLAMA_CPP_ROOT),
      noScreenshotResidue: true
    };

    try {
      assertNoScreenshotResidue(context);
    } catch {
      checks.noScreenshotResidue = false;
    }

    const summary = createSummary({
      ok: Object.values(checks).every(Boolean),
      checks,
      providerConfig,
      providerStatus,
      statusText,
      reply,
      failureCategory: firstFailedCheck(checks),
      durationMs: Date.now() - startedAt
    });
    console.log(JSON.stringify(summary, null, 2));

    if (!summary.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    const checks = {
      defaultConfigStillEmbeddedLocal: providerConfig?.providerId === "local-openai-compatible" &&
        providerConfig?.localPresetId === "embedded-llama-cpp",
      runtimeUsesImmediateFallback: providerStatus?.providerId === "fake" &&
        providerStatus?.displayName === "本地即时对话",
      statusExplainsImmediateLocalDialogue: statusText.includes("本地即时对话"),
      firstMessageGetsPetReply: reply?.petMessageCount >= 1,
      noMisleadingStartupError: false,
      missingPackWasNotCreated: !existsSync(context.env.AI_DESKTOP_PET_BUNDLED_LLAMA_CPP_ROOT),
      noScreenshotResidue: false
    };
    const summary = createSummary({
      ok: false,
      checks,
      providerConfig,
      providerStatus,
      statusText,
      reply,
      failureCategory: classifyError(error),
      durationMs: Date.now() - startedAt
    });
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = 1;
  } finally {
    await stopElectron(context);
    if (process.env.P2_53_KEEP_TMP !== "1" && process.exitCode !== 1) {
      cleanupRealUiRun(context);
    }
  }
}

async function startApp() {
  startElectron(context);
  await connectToElectron(context, 45_000);
  const pet = await getPageByUrlPart(context, "renderer/pet/index.html", 45_000);
  await waitFor(pet, "Boolean(window.petApi)", { timeoutMs: 15_000 });
  await evaluate(pet, "window.petApi.openChat()");
  const chat = await getPageByUrlPart(context, "renderer/chat/index.html", 45_000);
  await waitFor(chat, "Boolean(window.chatApi && window.configApi)", { timeoutMs: 30_000 });
  return { pet, chat };
}

async function waitForStartupFallbackStatus(page) {
  return waitFor(page, `
    window.configApi?.getProviderStatus().then((status) => {
      if (
        status?.providerId === "fake" &&
        status?.displayName === "本地即时对话" &&
        status?.isFallback === false
      ) {
        return status;
      }
      return null;
    })
  `, { timeoutMs: 15_000, intervalMs: 300 });
}

async function sendFirstMessage(page) {
  await waitFor(page, "document.querySelector('#chat-input')?.disabled === false", { timeoutMs: 15_000 });
  await typeText(page, chatUiSelectors.chat.input, "启动后现在可以直接说话吗？");
  await click(page, chatUiSelectors.chat.send);
  return waitFor(page, `
    (() => {
      const petMessages = [...document.querySelectorAll(".message-pet")];
      const userMessages = [...document.querySelectorAll(".message-user")];
      const lastPetReply = petMessages.at(-1)?.textContent?.trim() ?? "";
      const visibleText = document.body.innerText ?? "";
      if (
        userMessages.length >= 1 &&
        petMessages.length >= 1 &&
        lastPetReply.length > 0 &&
        !/连接失败|baseURL|切换到本地 Ollama|确认 Ollama 已安装并启动/.test(visibleText)
      ) {
        return {
          userMessageCount: userMessages.length,
          petMessageCount: petMessages.length,
          lastPetReplyLength: lastPetReply.length
        };
      }
      return null;
    })()
  `, { timeoutMs: 30_000, intervalMs: 300 });
}

function createSummary({
  ok,
  checks,
  providerConfig,
  providerStatus,
  statusText,
  reply,
  failureCategory,
  durationMs
}) {
  return {
    ok,
    runName,
    providerConfig: providerConfig ? summarizeProviderConfig(providerConfig) : null,
    providerStatus: providerStatus ? summarizeProviderStatus(providerStatus) : null,
    statusText,
    reply,
    checks,
    failureCategory,
    durationMs
  };
}

function summarizeProviderConfig(config) {
  return {
    providerId: config.providerId,
    displayName: config.displayName,
    localPresetId: config.providerId === "local-openai-compatible" ? config.localPresetId : undefined,
    model: config.providerId === "fake" ? undefined : config.model
  };
}

function summarizeProviderStatus(status) {
  return {
    providerId: status.providerId,
    displayName: status.displayName,
    model: status.model,
    baseURLHost: status.baseURLHost,
    isFallback: status.isFallback
  };
}

function firstFailedCheck(checks) {
  return Object.entries(checks).find(([, value]) => !value)?.[0] ?? null;
}

function classifyError(error) {
  if (!error) {
    return "unknown";
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/Timed out/i.test(message)) {
    return "timeout";
  }
  if (/Target not found/i.test(message)) {
    return "window_not_found";
  }
  return "runtime_error";
}

function readPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


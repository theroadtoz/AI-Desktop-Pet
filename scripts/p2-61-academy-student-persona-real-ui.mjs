import { spawnSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNoScreenshotResidue,
  cleanupRealUiRun,
  click,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  log,
  readPrivacyCheckText,
  sleep,
  startElectron,
  stopElectron,
  typeText,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";

const require = createRequire(import.meta.url);
const { hasProviderIdentityDrift } = require("../dist/shared/persona-self-identity.js");
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runName = "p2-61-academy-student-persona-real-ui";
const defaultPackRoot = join(root, ".tmp", "p2-23c-qwen25-15b-local-llm");
const packRoot = resolve(
  process.env.AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT ||
  process.env.AI_DESKTOP_PET_BUNDLED_LLAMA_CPP_ROOT ||
  process.env.P2_61_LOCAL_LLM_PACK_ROOT ||
  defaultPackRoot
);
const port = readPositiveInteger(process.env.P2_61_CDP_PORT) ?? 9661;
const providerTimeoutMs = readPositiveInteger(process.env.P2_61_PROVIDER_TIMEOUT_MS) ?? 180_000;
const sendTimeoutMs = readPositiveInteger(process.env.P2_61_SEND_TIMEOUT_MS) ?? 180_000;
const telemetryTimeoutMs = readPositiveInteger(process.env.P2_61_TELEMETRY_TIMEOUT_MS) ?? 180_000;

const context = createRealUiRunContext({
  runName,
  port,
  env: {
    AI_DESKTOP_PET_PROVIDER: "",
    AI_DESKTOP_PET_API_KEY: "",
    AI_DESKTOP_PET_BASE_URL: "",
    AI_DESKTOP_PET_MODEL: "",
    AI_DESKTOP_PET_BUNDLED_LLAMA_CPP_ROOT: packRoot,
    AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1"
  },
  tmpResiduePatterns: [
    new RegExp(`^${escapeRegExp(runName)}$`, "i")
  ]
});

const cases = [
  {
    caseId: "academy-student-life",
    category: "student-life",
    prompt: "最近学院里的课程、实验和报告都在忙些什么？听起来你这阵子应该挺满的。",
    assert(reply) {
      const studentLifeConcrete = countMatchingGroups(reply, [
        /课程|上课|选修/,
        /实验|实验室|实验数据/,
        /报告|汇报|论文/,
        /课题|项目|作业/
      ]) >= 2;
      const activityConcrete = /(忙|赶|写|做|准备|修改|整理|调试|复现|数据|进度|截止|提交)/.test(reply);
      const notCustomerService = !hasCustomerServiceFormula(reply);
      const noProviderIdentityDrift = !hasProviderIdentityDrift(reply);
      return assertion({
        studentLifeConcrete,
        activityConcrete,
        notCustomerService,
        noProviderIdentityDrift
      }, "student_life_not_natural");
    }
  },
  {
    caseId: "concrete-fatigue-chat",
    category: "ordinary-chat",
    prompt: "今天开会改需求来回折腾了一整天，我脑子都转不动了。",
    assert(reply) {
      const concreteContent = /(开会|会议)/.test(reply) && /(需求|修改|反复|来回|折腾)/.test(reply);
      const fatigueAcknowledged = /(累|疲惫|脑子|转不动|耗|休息|歇|缓一缓|放空)/.test(reply);
      const notCustomerService = !hasCustomerServiceFormula(reply);
      const noForcedPersonaOrAcademy = !/(西塔|魔女|魔法学院|现代魔导工程|Live2D|学院学生)/i.test(reply);
      const noProviderIdentityDrift = !hasProviderIdentityDrift(reply);
      return assertion({
        concreteContent,
        fatigueAcknowledged,
        notCustomerService,
        noForcedPersonaOrAcademy,
        noProviderIdentityDrift
      }, "fatigue_chat_not_concrete");
    }
  },
  {
    caseId: "provider-versus-mcp",
    category: "technical-accuracy",
    prompt: "我总把 Provider 和 MCP 混在一起，它们分别负责什么，实际调用时怎么区分？",
    assert(reply) {
      const providerTermPreserved = /Provider/i.test(reply);
      const mcpTermPreserved = /MCP/i.test(reply);
      const providerMeaning = providerTermPreserved &&
        /(模型|推理|API|接口|供应商|提供方|连接|配置|请求)/i.test(reply);
      const mcpMeaning = mcpTermPreserved &&
        /(协议|工具|tool|服务端|server|客户端|client|资源|搜索|外部能力|调用)/i.test(reply);
      const noRoleOpening = !/^(?:我是|西塔|作为西塔|身为|作为一名|魔女|在学院)/.test(reply.trim().slice(0, 100));
      const noTechnicalMagicAlias = !/(水晶球|法阵|咒语|魔法接口|魔导接口|魔法协议|召唤术)/.test(reply);
      const noProviderIdentityDrift = !hasProviderIdentityDrift(reply);
      return assertion({
        providerTermPreserved,
        mcpTermPreserved,
        providerMeaning,
        mcpMeaning,
        noRoleOpening,
        noTechnicalMagicAlias,
        noProviderIdentityDrift
      }, "provider_mcp_distinction_inaccurate");
    }
  },
  {
    caseId: "language-model-and-mcp",
    category: "compound-intent",
    prompt: "你是不是语言模型？顺便解释 MCP 怎么工作。",
    assert(reply) {
      const mcpIntentAnswered = /MCP/i.test(reply);
      const mcpWorkflow = countMatchingGroups(reply, [
        /协议/,
        /客户端|client/i,
        /服务端|server/i,
        /工具|tool/i,
        /请求|调用|invoke/i,
        /结果|返回|响应|response/i
      ]) >= 3;
      const noProviderIdentityDrift = !hasProviderIdentityDrift(reply);
      const noTechnicalMagicAlias = !/(水晶球|法阵|咒语|魔法接口|魔导接口|魔法协议|召唤术)/.test(reply);
      return assertion({
        mcpIntentAnswered,
        mcpWorkflow,
        noProviderIdentityDrift,
        noTechnicalMagicAlias
      }, "compound_mcp_intent_not_answered");
    }
  }
];

const replies = [];
const caseResults = [];

main().catch((error) => {
  const summary = createSummary({
    ok: false,
    durationMs: 0,
    validation: null,
    providerStatus: null,
    telemetry: null,
    checks: { script: false },
    failureCategory: classifyError(error)
  });
  writeSafeSummary(summary);
  process.exitCode = 1;
});

async function main() {
  const startedAt = Date.now();
  let validation = null;
  let providerStatus = null;
  let telemetry = null;

  try {
    validation = validateLocalLlmPack(packRoot);
    if (!validation.ok) {
      const summary = createSummary({
        ok: false,
        durationMs: Date.now() - startedAt,
        validation,
        providerStatus,
        telemetry,
        checks: { localLlmPackReady: false },
        failureCategory: validation.status ?? "local_llm_pack_invalid"
      });
      writeSafeSummary(summary);
      process.exitCode = 1;
      return;
    }

    log(context, "starting real Electron UI for P2-61 academy student persona acceptance");
    const { chat } = await startApp();
    telemetry = await waitForEmbeddedHandoffTelemetry(validation);
    providerStatus = await waitForEmbeddedProviderStatus(chat, telemetry.handoff);

    for (const item of cases) {
      await startNewConversation(chat);
      caseResults.push(await runCase(chat, item));
    }

    telemetry = summarizeTelemetry(readTelemetryEntries());
    const checks = createChecks({ validation, providerStatus, telemetry });
    try {
      assertNoScreenshotResidue(context);
    } catch {
      checks.noScreenshotResidue = false;
    }

    const summary = createSummary({
      ok: Object.values(checks).every(Boolean),
      durationMs: Date.now() - startedAt,
      validation,
      providerStatus,
      telemetry,
      checks,
      failureCategory: firstFailedCheck(checks)
    });
    const finalSummary = writeSafeSummary(summary);
    if (!finalSummary.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    telemetry = summarizeTelemetry(readTelemetryEntries());
    const checks = createChecks({ validation, providerStatus, telemetry });
    const summary = createSummary({
      ok: false,
      durationMs: Date.now() - startedAt,
      validation,
      providerStatus,
      telemetry,
      checks,
      failureCategory: classifyError(error)
    });
    writeSafeSummary(summary);
    process.exitCode = 1;
  } finally {
    await stopElectron(context);
    if (process.env.P2_61_KEEP_TMP !== "1") {
      cleanupRealUiRun(context);
    }
  }
}

async function startApp() {
  startElectron(context);
  await connectToElectron(context, 45_000);
  const pet = await waitForWindow(context, "renderer/pet/index.html", 45_000);
  await sleep(1_000);
  await evaluate(pet, "window.petApi?.openChat()");
  const chat = await waitForWindow(context, "renderer/chat/index.html", 45_000);
  await waitFor(chat, "Boolean(document.querySelector('#chat-input') && window.configApi?.getProviderStatus)", {
    timeoutMs: 30_000
  });
  return { pet, chat };
}

async function waitForEmbeddedProviderStatus(page, handoff) {
  return waitFor(page, `
    window.configApi?.getProviderStatus().then((status) => {
      if (
        status?.providerId === "local-openai-compatible" &&
        status?.model === ${JSON.stringify(handoff.alias)} &&
        status?.baseURLHost === ${JSON.stringify(handoff.baseURLHost)} &&
        status?.isFallback === false
      ) {
        return {
          providerId: status.providerId,
          model: status.model,
          baseURLHost: status.baseURLHost,
          isFallback: status.isFallback
        };
      }
      return null;
    })
  `, { timeoutMs: providerTimeoutMs, intervalMs: 500 });
}

async function waitForEmbeddedHandoffTelemetry(validation) {
  const deadline = Date.now() + telemetryTimeoutMs;
  while (Date.now() < deadline) {
    const telemetry = summarizeTelemetry(readTelemetryEntries());
    if (
      telemetry.runtimeReady?.status === "ready" &&
      telemetry.handoff?.providerId === "local-openai-compatible" &&
      telemetry.handoff?.localPresetId === "embedded-llama-cpp" &&
      telemetry.handoff?.alias === validation.alias &&
      telemetry.handoff?.baseURLHost &&
      !isExternalHost(telemetry.handoff.baseURLHost)
    ) {
      return telemetry;
    }
    await sleep(500);
  }
  throw new Error("embedded_handoff_timeout");
}

async function startNewConversation(page) {
  await click(page, "#new-conversation-button");
  await waitFor(page, `
    (() => {
      const replies = document.querySelectorAll(".message-pet .message-content");
      const input = document.querySelector("#chat-input");
      return replies.length === 0 && input && !input.disabled;
    })()
  `, { timeoutMs: 10_000, intervalMs: 150 });
}

async function runCase(page, item) {
  const startedAt = Date.now();
  try {
    const reply = await sendMessage(page, item.prompt);
    replies.push(reply);
    const result = item.assert(reply);
    const thinkLeak = hasThinkLeak(reply);
    return removeUndefined({
      caseId: item.caseId,
      category: item.category,
      passed: result.passed && !thinkLeak,
      checks: result.checks,
      attemptCount: 1,
      replyLength: reply.length,
      thinkLeak,
      durationMs: Date.now() - startedAt,
      failureCategory: result.passed
        ? thinkLeak ? "reasoning_tag_leak" : undefined
        : result.failureCategory
    });
  } catch (error) {
    return {
      caseId: item.caseId,
      category: item.category,
      passed: false,
      checks: {},
      attemptCount: 1,
      replyLength: 0,
      thinkLeak: false,
      durationMs: Date.now() - startedAt,
      failureCategory: classifyError(error)
    };
  }
}

async function sendMessage(page, message) {
  const before = await evaluate(page, "document.querySelectorAll('.message-pet .message-content').length");
  await typeText(page, "#chat-input", message);
  await click(page, "#send-button");
  const deadline = Date.now() + sendTimeoutMs;

  while (Date.now() < deadline) {
    const state = await evaluate(page, `
      (() => {
        const input = document.querySelector("#chat-input");
        const replies = [...document.querySelectorAll(".message-pet .message-content")];
        const lastReply = replies.at(-1)?.textContent?.trim() ?? "";
        const sessionNote = document.querySelector("#chat-session-note");
        return {
          replyCount: replies.length,
          inputDisabled: Boolean(input?.disabled),
          lastReply,
          lastReplyLength: lastReply.length,
          sessionState: sessionNote?.dataset.state ?? ""
        };
      })()
    `);
    if (state.replyCount > before && !state.inputDisabled && state.lastReplyLength > 0) {
      return state.lastReply;
    }
    if (state.replyCount <= before && !state.inputDisabled && state.sessionState === "error") {
      throw new Error("provider_chat_failed");
    }
    await sleep(300);
  }
  throw new Error("send_timeout");
}

function validateLocalLlmPack(resourceRoot) {
  const validation = spawnSync(process.execPath, ["scripts/p2-20h-validate-local-llm-resources.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT: resourceRoot,
      AI_DESKTOP_PET_BUNDLED_LLAMA_CPP_ROOT: ""
    },
    encoding: "utf8",
    windowsHide: true
  });
  const summary = parseJson(validation.stdout?.trim()) ?? {};
  return removeUndefined({
    ok: validation.status === 0 && summary.ok === true,
    safeSummaryOnly: true,
    status: summary.status ?? (validation.error ? "validator_failed" : "validator_nonzero"),
    resourceRootName: summary.resourceRootName ?? basename(resourceRoot),
    executableName: summary.executableName,
    modelName: summary.modelName,
    alias: summary.alias,
    ctxSize: summary.ctxSize,
    stderrLength: validation.stderr?.length || undefined
  });
}

function readTelemetryEntries() {
  const logDir = join(context.appDataDir, "logs");
  if (!existsSync(logDir)) {
    return [];
  }
  return readdirSync(logDir)
    .filter((name) => name.startsWith("telemetry-") && name.endsWith(".jsonl"))
    .map((name) => join(logDir, name))
    .sort((left, right) => statSync(left).mtimeMs - statSync(right).mtimeMs)
    .flatMap((filePath) => readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => parseJson(line))
      .filter((entry) => entry && typeof entry === "object"));
}

function summarizeTelemetry(entries) {
  const runtimeReady = latestPayload(entries, "bundled_llama_cpp_runtime_status", (payload) => payload?.status === "ready");
  const handoff = latestPayload(entries, "bundled_llama_cpp_provider_handoff");
  const providerRequests = entries
    .filter((entry) => entry.type === "provider_request_started" || entry.type === "provider_request_completed")
    .map((entry) => ({
      type: entry.type,
      providerId: entry.payload?.providerId,
      model: entry.payload?.model,
      baseURLHost: entry.payload?.baseURLHost,
      replyLength: entry.payload?.replyLength
    }));
  const completedRequests = providerRequests.filter((entry) => entry.type === "provider_request_completed");
  const failures = entries.filter((entry) =>
    entry.type === "provider_request_failed" ||
    entry.type === "provider_unavailable" ||
    entry.type === "chat_stream_failed"
  );
  const chatCompletedCount = entries.filter((entry) => entry.type === "chat_stream_completed").length;
  return removeUndefined({
    safeSummaryOnly: true,
    runtimeReady: summarizeRuntime(runtimeReady),
    handoff: summarizeHandoff(handoff),
    providerRequestCount: providerRequests.length,
    providerRequestCompletedCount: completedRequests.length,
    chatCompletedCount,
    failureCount: failures.length,
    providerRequests,
    externalHostSeen: providerRequests.some((entry) => isExternalHost(entry.baseURLHost)) ||
      isExternalHost(handoff?.baseURLHost)
  });
}

function createChecks({ validation, providerStatus, telemetry }) {
  const completedRequests = (telemetry?.providerRequests ?? [])
    .filter((entry) => entry.type === "provider_request_completed");
  return {
    localLlmPackReady: validation?.ok === true,
    runtimeReady: telemetry?.runtimeReady?.status === "ready",
    embeddedProviderHandoff: telemetry?.handoff?.providerId === "local-openai-compatible" &&
      telemetry?.handoff?.localPresetId === "embedded-llama-cpp",
    providerIdLocal: providerStatus?.providerId === "local-openai-compatible",
    providerNotFallback: providerStatus?.isFallback === false,
    providerRequestsLocal: completedRequests.length === cases.length && completedRequests.every((entry) =>
      entry.providerId === "local-openai-compatible" && !isExternalHost(entry.baseURLHost)
    ),
    externalHostSeenFalse: telemetry?.externalHostSeen === false,
    noTelemetryFailures: telemetry?.failureCount === 0,
    oneCompletedStreamPerCase: telemetry?.chatCompletedCount === cases.length,
    singleAttemptPerCase: caseResults.length === cases.length &&
      caseResults.every((result) => result.attemptCount === 1),
    requiredCasesPassed: caseResults.length === cases.length &&
      caseResults.every((result) => result.passed === true),
    noThinkLeak: caseResults.every((result) => result.thinkLeak === false),
    noScreenshotResidue: true
  };
}

function createSummary({
  ok,
  durationMs,
  validation,
  providerStatus,
  telemetry,
  checks,
  failureCategory
}) {
  return removeUndefined({
    ok,
    safeSummaryOnly: true,
    runName,
    durationMs,
    resourceRootName: basename(packRoot),
    validation,
    providerStatus: summarizeProviderStatus(providerStatus),
    telemetry: summarizePublicTelemetry(telemetry),
    cases: caseResults,
    checks,
    failureCategory: ok ? undefined : failureCategory
  });
}

function summarizePublicTelemetry(telemetry) {
  if (!telemetry) {
    return undefined;
  }
  return removeUndefined({
    safeSummaryOnly: true,
    runtimeReady: telemetry.runtimeReady,
    handoff: telemetry.handoff,
    providerRequestCount: telemetry.providerRequestCount,
    providerRequestCompletedCount: telemetry.providerRequestCompletedCount,
    chatCompletedCount: telemetry.chatCompletedCount,
    failureCount: telemetry.failureCount,
    externalHostSeen: telemetry.externalHostSeen
  });
}

function writeSafeSummary(summary) {
  const serialized = `${JSON.stringify(summary, null, 2)}\n`;
  const privacyOk = checkPrivacy(serialized, replies);
  const finalSummary = privacyOk
    ? summary
    : {
        ...summary,
        ok: false,
        checks: {
          ...(summary.checks ?? {}),
          privacyOutput: false
        },
        failureCategory: "privacy_output_failed"
      };
  const finalSerialized = `${JSON.stringify(finalSummary, null, 2)}\n`;
  writeFileSync(context.resultPath, finalSerialized, "utf8");
  console.log(finalSerialized.trimEnd());
  return finalSummary;
}

function checkPrivacy(serialized, allReplies) {
  const text = [
    readPrivacyCheckText(context, ["progress.log", "electron.stdout.log", "electron.stderr.log"]),
    serialized
  ].join("\n");
  const forbiddenSnippets = [
    ...cases.map((item) => item.prompt),
    ...allReplies.map((reply) => reply.trim()).filter((reply) => reply.length >= 12),
    "provider request body",
    "requestBody",
    "system prompt",
    "\"prompt\"",
    "\"messages\"",
    "\"content\"",
    "API Key",
    "apiKey",
    "Authorization",
    "Bearer ",
    ".env.local",
    "sk-",
    packRoot
  ];
  const forbiddenPatterns = [
    /AI_DESKTOP_PET_API_KEY\s*=/i,
    /(?:user|assistant|system)\s*:\s*["'`]/i,
    /完整(?:用户|AI|assistant|模型|回复|对话)正文/i
  ];
  return forbiddenSnippets.every((snippet) => !text.includes(snippet)) &&
    forbiddenPatterns.every((pattern) => !pattern.test(text));
}

function assertion(checks, failureCategory) {
  const passed = Object.values(checks).every(Boolean);
  return {
    passed,
    checks,
    failureCategory: passed ? undefined : failureCategory
  };
}

function countMatchingGroups(text, patterns) {
  return patterns.filter((pattern) => pattern.test(text)).length;
}

function hasCustomerServiceFormula(text) {
  return /(感谢您的提问|很高兴为您服务|请问您还需要|还有什么可以帮|随时为您服务|尊敬的用户)/.test(text);
}

function hasThinkLeak(text) {
  return /<think>|<\/think>|思考过程|chain of thought|reasoning/i.test(text);
}

function latestPayload(entries, type, predicate = () => true) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type === type && predicate(entry.payload ?? {})) {
      return entry.payload ?? {};
    }
  }
  return null;
}

function summarizeRuntime(payload) {
  if (!payload) {
    return undefined;
  }
  return removeUndefined({
    safeSummaryOnly: true,
    status: payload.status,
    bundled: payload.bundled,
    alias: payload.alias,
    baseURLHost: payload.baseURLHost
  });
}

function summarizeHandoff(payload) {
  if (!payload) {
    return undefined;
  }
  return removeUndefined({
    safeSummaryOnly: true,
    status: payload.status,
    providerId: payload.providerId,
    localPresetId: payload.localPresetId,
    alias: payload.alias,
    baseURLHost: payload.baseURLHost
  });
}

function summarizeProviderStatus(status) {
  if (!status) {
    return undefined;
  }
  return removeUndefined({
    providerId: status.providerId,
    model: status.model,
    baseURLHost: status.baseURLHost,
    isFallback: status.isFallback
  });
}

function isExternalHost(host) {
  const value = String(host ?? "").trim();
  return Boolean(value) && !/^(127\.0\.0\.1|localhost|\[::1\]|::1)(:\d+)?$/i.test(value);
}

function firstFailedCheck(checks) {
  return Object.entries(checks).find(([, value]) => value !== true)?.[0];
}

function classifyError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout/i.test(message)) {
    return "timeout";
  }
  if (/local_llm|validator/i.test(message)) {
    return "local_llm_pack_invalid";
  }
  if (/provider_chat_failed|provider/i.test(message)) {
    return "provider_chat_failed";
  }
  if (/Target not found|Timed out waiting/.test(message)) {
    return "ui_not_ready";
  }
  return "script_failed";
}

function parseJson(value) {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function readPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function removeUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(removeUndefined);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, removeUndefined(entryValue)])
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNoScreenshotResidue,
  chatUiSelectors,
  cleanupRealUiRun,
  click,
  closeSettingsPage,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  getPageByUrlPart,
  log,
  openAdvancedSettings,
  openModelSettings,
  readPrivacyCheckText,
  sleep,
  startElectron,
  stopElectron,
  typeText,
  waitFor
} from "./support/real-ui-harness.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runName = "p2-43-local-only-persona-search-detection";
const defaultPackRoot = join(root, ".tmp", "p2-23c-qwen25-15b-local-llm");
const packRoot = resolve(
  process.env.AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT ||
  process.env.AI_DESKTOP_PET_BUNDLED_LLAMA_CPP_ROOT ||
  process.env.P2_43_LOCAL_LLM_PACK_ROOT ||
  defaultPackRoot
);
const port = readPositiveInteger(process.env.P2_43_CDP_PORT) ?? 9609;
const sendTimeoutMs = readPositiveInteger(process.env.P2_43_SEND_TIMEOUT_MS) ?? 180_000;
const providerTimeoutMs = readPositiveInteger(process.env.P2_43_PROVIDER_TIMEOUT_MS) ?? 180_000;

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

const fakeServerPath = join(context.runDir, "fake-mcp-search-server.mjs");
const fakeRecordPath = join(context.runDir, "fake-mcp-calls.jsonl");
writeFileSync(fakeServerPath, createFakeMcpServerSource(), "utf8");

const replies = [];
const caseResults = [];

main().catch((error) => {
  const summary = createSummary({
    ok: false,
    validation: null,
    providerStatus: null,
    modelUi: null,
    telemetry: null,
    search: null,
    checks: { script: false },
    failureCategory: classifyError(error),
    durationMs: 0
  });
  writeSafeSummary(summary);
  process.exitCode = 1;
});

async function main() {
  const startedAt = Date.now();
  let validation = null;
  let providerStatus = null;
  let modelUi = null;
  let search = null;
  let telemetry = null;

  try {
    validation = validateLocalLlmPack(packRoot);
    if (!validation.ok) {
      const summary = createSummary({
        ok: false,
        validation,
        providerStatus,
        modelUi,
        telemetry,
        search,
        checks: { localLlmPackReady: false },
        failureCategory: validation.status ?? "local_llm_pack_invalid",
        durationMs: Date.now() - startedAt
      });
      writeSafeSummary(summary);
      process.exitCode = 1;
      return;
    }

    log(context, "starting real Electron UI for P2-43 local-only detection");
    const { chat } = await startApp();
    providerStatus = await waitForEmbeddedProviderStatus(chat, validation);
    modelUi = await inspectModelUi(chat);

    await runCase(chat, {
      caseId: "local-persona-identity",
      category: "persona",
      prompt: "你是谁？请用一句话说明你在这个桌面应用里的身份。",
      assert(reply) {
        const personaAnchor = /(魔女|魔法学院|魔导工程)/.test(reply);
        const companionAnchor = /(桌面|Live2D).*(伙伴|同伴|陪伴)|(?:伙伴|同伴|陪伴).*(桌面|Live2D)/.test(reply);
        const genericSelfId = /我是(?:一个|一名)?(?:AI助手|人工智能助手|语言模型|聊天机器人)/i.test(reply);
        return assertion(personaAnchor && companionAnchor && !genericSelfId, [
          ["academy_witch_or_thaumaturgy", personaAnchor],
          ["desktop_live2d_companion", companionAnchor],
          ["no_generic_ai_self_identity", !genericSelfId]
        ], genericSelfId ? "generic_ai_self_identity" : "persona_anchor_missing");
      }
    });

    await runCase(chat, {
      caseId: "local-current-time",
      category: "runtime-context",
      prompt: "现在时间大约是几点几分？只回答当前小时和分钟。",
      assert(reply, _sentAt, pageClock) {
        const expectedTimes = expectedLocalTimes(pageClock);
        const timeHit = expectedTimes.some((item) => reply.includes(item));
        const cannotConfirm = /(不能确认|无法确认|没有系统时间上下文)/.test(reply);
        return assertion(timeHit && !cannotConfirm, [
          ["current_time_anchor", timeHit],
          ["no_missing_runtime_context_claim", !cannotConfirm]
        ], timeHit ? "runtime_context_refused" : "current_time_anchor_missing");
      }
    });

    await runCase(chat, {
      caseId: "local-common-sense",
      category: "common-sense",
      prompt: "标准大气压下水的沸点是多少？直接回答。",
      assert(reply) {
        const number = /100|一百/.test(reply);
        const unit = /摄氏|℃|度|沸点/.test(reply);
        return assertion(number && unit, [
          ["boiling_point_number", number],
          ["boiling_point_unit", unit]
        ], "common_sense_anchor_missing");
      }
    });

    search = await runFakeMcpSearchCase(chat);
    telemetry = summarizeTelemetry(readTelemetryEntries());
    const checks = createChecks({ validation, providerStatus, modelUi, telemetry, search });

    try {
      assertNoScreenshotResidue(context);
    } catch {
      checks.noScreenshotResidue = false;
    }

    const summary = createSummary({
      ok: Object.values(checks).every(Boolean),
      validation,
      providerStatus,
      modelUi,
      telemetry,
      search,
      checks,
      failureCategory: firstFailedCheck(checks),
      durationMs: Date.now() - startedAt
    });
    const finalSummary = writeSafeSummary(summary);
    if (!finalSummary.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    telemetry = summarizeTelemetry(readTelemetryEntries());
    const checks = createChecks({ validation, providerStatus, modelUi, telemetry, search });
    const summary = createSummary({
      ok: false,
      validation,
      providerStatus,
      modelUi,
      telemetry,
      search,
      checks,
      failureCategory: classifyError(error),
      durationMs: Date.now() - startedAt
    });
    writeSafeSummary(summary);
    process.exitCode = 1;
  } finally {
    await stopElectron(context);
    if (process.env.P2_43_KEEP_TMP !== "1" && process.exitCode !== 1) {
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
  await waitFor(chat, "Boolean(window.chatApi && window.configApi && window.webSearchApi)", { timeoutMs: 30_000 });
  return { pet, chat };
}

async function waitForEmbeddedProviderStatus(page, validation) {
  return waitFor(page, `
    window.configApi?.getProviderStatus().then((status) => {
      if (
        status?.providerId === "local-openai-compatible" &&
        status?.model === ${JSON.stringify(validation.alias)} &&
        status?.isFallback === false &&
        !String(status?.baseURLHost ?? "").includes("api.deepseek.com")
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

async function inspectModelUi(page) {
  await openModelSettings(page);
  const beforeReset = await evaluate(page, `({
    providerOptions: [...document.querySelectorAll("#provider-id option")].map((node) => node.value),
    providerValue: document.querySelector("#provider-id")?.value ?? "",
    localPresetValue: document.querySelector("#local-provider-preset")?.value ?? "",
    connectionHidden: document.querySelector("#connection-safe-section")?.hidden === true,
    apiKeyInputHidden: document.querySelector("#provider-api-key")?.closest("[hidden]") !== null ||
      document.querySelector("#connection-safe-section")?.hidden === true,
    resetButtonVisible: Boolean(document.querySelector("#provider-reset-local-button")),
    note: document.querySelector("#local-provider-note")?.textContent ?? ""
  })`);

  await click(page, "#provider-reset-local-button");
  const afterReset = await evaluate(page, `({
    providerValue: document.querySelector("#provider-id")?.value ?? "",
    localPresetValue: document.querySelector("#local-provider-preset")?.value ?? "",
    baseURL: document.querySelector("#provider-base-url")?.value ?? "",
    model: document.querySelector("#provider-model")?.value ?? "",
    feedback: document.querySelector("#settings-feedback")?.textContent ?? ""
  })`);
  await closeSettingsPage(page);

  return {
    options: beforeReset.providerOptions,
    connectionHidden: beforeReset.connectionHidden,
    apiKeyInputHidden: beforeReset.apiKeyInputHidden,
    resetButtonVisible: beforeReset.resetButtonVisible,
    localOnlyNote: /不需要 API Key/.test(beforeReset.note),
    afterReset
  };
}

async function runCase(page, item) {
  const startedAt = Date.now();
  const sentAt = new Date();
  try {
    const pageClock = await readPageClock(page);
    const reply = await sendMessage(page, item.prompt);
    replies.push(reply);
    const result = item.assert(reply, sentAt, pageClock);
    const thinkLeak = /<think>|<\/think>|思考过程|chain of thought/i.test(reply);
    caseResults.push(removeUndefined({
      caseId: item.caseId,
      category: item.category,
      status: result.passed && !thinkLeak ? "passed" : "failed",
      anchors: result.anchors,
      replyLength: reply.length,
      thinkLeak,
      durationMs: Date.now() - startedAt,
      failureCategory: result.passed ? thinkLeak ? "reasoning_tag_leak" : undefined : result.failureCategory
    }));
  } catch (error) {
    caseResults.push({
      caseId: item.caseId,
      category: item.category,
      status: "failed",
      anchors: [],
      replyLength: 0,
      durationMs: Date.now() - startedAt,
      failureCategory: classifyError(error)
    });
  }
}

async function runFakeMcpSearchCase(page) {
  await openAdvancedSettings(page);
  await typeText(page, "#web-search-command", process.execPath);
  await typeText(page, "#web-search-args", `${fakeServerPath} ${fakeRecordPath}`);
  await typeText(page, "#web-search-tool-name", "web_search");
  await typeText(page, "#web-search-timeout", "5000");
  await typeText(page, "#web-search-max-results", "2");
  await evaluate(page, `
    (() => {
      const checkbox = document.querySelector("#web-search-enabled");
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    })()
  `);
  await click(page, "#web-search-save-button");
  await waitFor(page, "document.querySelector('#web-search-status')?.textContent.includes('已启用')", {
    timeoutMs: 10_000
  });
  await closeSettingsPage(page);

  const beforeCalls = readFakeMcpCalls().length;
  const reply = await sendMessage(page, "请联网搜索 C:\\Users\\PrivateUser\\notes.txt private@example.com P2-43 本地模型 MCP 搜索验收");
  replies.push(reply);
  await waitFor(page, "Boolean(document.querySelector('.message-pet:last-child .message-citations, .message-citations'))", {
    timeoutMs: 20_000
  }).catch(() => false);

  const calls = readFakeMcpCalls();
  const newCalls = calls.slice(beforeCalls);
  const serialized = newCalls.join("\n");
  const citationVisible = await evaluate(page, "Boolean(document.querySelector('.message-citations'))");

  return {
    fakeMcpCallCount: newCalls.length,
    citationVisible,
    safeQueryOnly: newCalls.length === 1 &&
      /P2-43/.test(serialized) &&
      !/PrivateUser|private@example\.com|notes\.txt|memoryContext|providerMessages|prompt|messages|content|apiKey/i.test(serialized),
    replyLength: reply.length
  };
}

async function sendMessage(page, message) {
  const before = await evaluate(page, "document.querySelectorAll('.message-pet .message-content').length");
  await typeText(page, chatUiSelectors.chat.input, message);
  await click(page, chatUiSelectors.chat.send);
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
    status: summary.status ?? (validation.error ? "validator_failed" : "validator_nonzero"),
    resourceRootName: summary.resourceRootName ?? basename(resourceRoot),
    manifestFound: summary.manifestFound,
    executableName: summary.executableName,
    modelName: summary.modelName,
    alias: summary.alias,
    ctxSize: summary.ctxSize,
    safeSummaryOnly: true
  });
}

function readFakeMcpCalls() {
  if (!existsSync(fakeRecordPath)) {
    return [];
  }
  return readFileSync(fakeRecordPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function readPageClock(page) {
  return evaluate(page, `
    (() => {
      const now = new Date();
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const localTime = new Intl.DateTimeFormat("zh-CN", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).format(now);
      return {
        nowMs: now.getTime(),
        timezone,
        localTime
      };
    })()
  `);
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
  const providerRequests = entries
    .filter((entry) => entry.type === "provider_request_started" || entry.type === "provider_request_completed")
    .map((entry) => entry.payload ?? {});
  const providerSelected = entries
    .filter((entry) => entry.type === "provider_selected")
    .map((entry) => entry.payload ?? {});
  const failures = entries.filter((entry) =>
    entry.type === "provider_request_failed" ||
    entry.type === "provider_unavailable" ||
    entry.type === "chat_stream_failed"
  );

  return {
    providerRequestCount: providerRequests.length,
    providerSelectedLocalCount: providerSelected.filter((payload) => payload.providerId === "local-openai-compatible").length,
    failureCount: failures.length,
    externalHostSeen: providerRequests.some((payload) => isExternalHost(payload.baseURLHost)),
    localRequestOnly: providerRequests.every((payload) =>
      payload.providerId === "local-openai-compatible" &&
      !isExternalHost(payload.baseURLHost)
    )
  };
}

function createChecks({ validation, providerStatus, modelUi, telemetry, search }) {
  return {
    localLlmPackReady: validation?.ok === true,
    providerStatusLocalOnly: providerStatus?.providerId === "local-openai-compatible" &&
      providerStatus?.isFallback === false &&
      !isExternalHost(providerStatus?.baseURLHost),
    uiNoExternalProviderOption: modelUi?.options?.includes("openai-compatible") === false,
    uiNoApiKeyPath: modelUi?.connectionHidden === true && modelUi?.apiKeyInputHidden === true,
    uiResetEmbeddedLocal: modelUi?.afterReset?.localPresetValue === "embedded-llama-cpp" &&
      modelUi?.afterReset?.model === "ai-desktop-pet-local",
    localPersonaAndQaCasesPassed: caseResults.every((item) => item.status === "passed") && caseResults.length >= 3,
    noThinkLeak: caseResults.every((item) => item.thinkLeak !== true),
    fakeMcpSafeQueryOnly: search?.safeQueryOnly === true,
    fakeMcpCitationVisible: search?.citationVisible === true,
    telemetryLocalOnly: telemetry?.localRequestOnly === true && telemetry?.externalHostSeen === false,
    noTelemetryFailures: telemetry?.failureCount === 0,
    noScreenshotResidue: true
  };
}

function createSummary({
  ok,
  validation,
  providerStatus,
  modelUi,
  telemetry,
  search,
  checks,
  failureCategory,
  durationMs
}) {
  return removeUndefined({
    ok,
    safeSummaryOnly: true,
    runName,
    durationMs,
    resourceRootName: basename(packRoot),
    validation,
    providerStatus,
    modelUi,
    cases: caseResults,
    search,
    telemetry,
    checks,
    failureCategory: ok ? undefined : failureCategory
  });
}

function writeSafeSummary(summary) {
  const serialized = `${JSON.stringify(summary, null, 2)}\n`;
  const privacyOk = checkPrivacy(serialized);
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

function checkPrivacy(serializedSummary) {
  const text = [
    readPrivacyCheckText(context, ["progress.log", "electron.stdout.log", "electron.stderr.log"]),
    serializedSummary
  ].join("\n");
  const forbidden = [
    ...replies.map((reply) => reply.trim()).filter((reply) => reply.length >= 12),
    "private@example.com",
    "PrivateUser",
    "notes.txt",
    "provider request body",
    "requestBody",
    "system prompt",
    "\"prompt\"",
    "memoryContext",
    "providerMessages",
    "Authorization",
    "Bearer ",
    "api.deepseek.com",
    "deepseek-v4-flash"
  ];
  return forbidden.every((snippet) => !text.includes(snippet));
}

function expectedLocalTimes(pageClock) {
  const values = [];
  for (let offset = -3; offset <= 3; offset += 1) {
    const current = new Date(Number(pageClock?.nowMs) + offset * 60_000);
    const parts = new Intl.DateTimeFormat("zh-CN", {
      timeZone: pageClock?.timezone || "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(current);
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
    const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
    const padded = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    const minuteText = String(minute).padStart(2, "0");
    values.push(
      padded,
      `${hour}:${minuteText}`,
      `${hour}点${minuteText}分`,
      `${String(hour).padStart(2, "0")}点${minuteText}分`
    );
  }
  return [...new Set(values)];
}

function assertion(passed, entries, failureCategory) {
  return {
    passed,
    anchors: entries.map(([name, hit]) => ({ name, hit })),
    failureCategory: passed ? undefined : failureCategory
  };
}

function isExternalHost(host) {
  return /api\.deepseek\.com|api\.openai\.com|openrouter\.ai|anthropic\.com|dashscope|bigmodel|volcengine/i.test(String(host ?? ""));
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
  return message.slice(0, 80) || "unknown_error";
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

function createFakeMcpServerSource() {
  return `
import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";

const recordPath = process.argv[2];
const lineReader = createInterface({ input: process.stdin });

lineReader.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    respond(message.id, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-p2-43-search", version: "0.0.0" } });
    return;
  }
  if (message.method === "tools/list") {
    respond(message.id, {
      tools: [{
        name: "web_search",
        description: "FAKE MCP search for P2-43 local-only detection; no network access",
        inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] }
      }]
    });
    return;
  }
  if (message.method === "tools/call") {
    writeFileSync(recordPath, JSON.stringify(message.params.arguments) + "\\n", { flag: "a" });
    respond(message.id, {
      content: [{
        type: "text",
        text: JSON.stringify({
          results: [{
            title: "FAKE_P2_43_MCP_RESULT",
            snippet: "P2-43 fake MCP safe search summary. It proves citation plumbing only, not a real web result.",
            url: "https://example.test/p2-43"
          }]
        })
      }]
    });
    return;
  }
  if (typeof message.id === "number") {
    respond(message.id, {});
  }
});

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
}
`;
}

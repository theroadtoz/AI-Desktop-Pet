import {
  cleanupRealUiRun,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  findScreenshotResidue,
  startElectron,
  stopElectron,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { createMemoryStore } = require("../dist/main/services/chat/memory-store.js");
const { createMemoryReviewStore } = require("../dist/main/services/chat/memory-review-store.js");

const context = createRealUiRunContext({
  runName: "p2-87e-history-lifecycle-real-ui",
  port: Number(process.env.P2_87E_CDP_PORT || 9798)
});

const historyDirectory = join(context.appDataDir, "history");
const conversationId = "11111111-1111-4111-8111-111111111111";
const messageId = "22222222-2222-4222-8222-222222222222";
const semanticSummaryMarker = "P2-91A_MAIN_ONLY_SEMANTIC_SUMMARY_MARKER";
const oldProviderContextMarker = "P2-91A_OLD_PROVIDER_CONTEXT_MARKER";
const newProviderContextMarker = "P2-91A_NEW_PROVIDER_CONTEXT_MARKER";
const providerRequests = [];
const providerServer = createServer((request, response) => {
  if (request.url === "/v1/models") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ data: [{ id: "p2-91a-review-model" }] }));
    return;
  }
  if (request.url !== "/v1/chat/completions" || request.method !== "POST") {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { type: "not_found" } }));
    return;
  }

  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    providerRequests.push(JSON.parse(body));
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "收到。" } }] })}\n\ndata: [DONE]\n\n`);
  });
});
mkdirSync(historyDirectory, { recursive: true });
writeFileSync(join(historyDirectory, "conversations.json"), `${JSON.stringify({
  version: 2,
  retentionLimit: 500,
  conversations: [{
    id: conversationId,
    title: "P2-91A 合成历史",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    messages: [{ id: messageId, role: "user", content: "待清除的合成历史", createdAt: 1_700_000_000_000 }]
  }],
  semanticSummaries: [{
    conversationId,
    sourceMessageIds: [messageId],
    content: semanticSummaryMarker,
    updatedAt: 1_700_000_000_000
  }]
}, null, 2)}\n`, "utf8");

const memoryStore = createMemoryStore({ userDataPath: context.appDataDir });
const reviewStore = createMemoryReviewStore({ userDataPath: context.appDataDir });
memoryStore.setEnabled(true);
memoryStore.createCard({
  title: "P2-91A 保留事实",
  content: "清空历史后仍需保留。",
  tags: ["验收"],
  sourceConversationId: crypto.randomUUID()
});
reviewStore.enqueue(reviewDraft("p2-91a-preserved-review"));
const suppressionCandidate = reviewStore.enqueue(reviewDraft("p2-91a-preserved-suppression"));
memoryStore.confirmReviewedCandidate(suppressionCandidate);
const automaticCard = memoryStore.listCards().find((card) => card.sourceType !== "manual-chat");
if (!automaticCard || memoryStore.forgetCard(automaticCard.id).status !== "forgotten") {
  throw new Error("Failed to seed a non-empty suppression");
}

let result = { ok: false, checks: {} };
try {
  await listen(providerServer);
  context.env = {
    ...context.env,
    AI_DESKTOP_PET_PROVIDER: "local-openai-compatible",
    AI_DESKTOP_PET_BASE_URL: providerBaseURL(),
    AI_DESKTOP_PET_MODEL: "p2-91a-review-model",
    AI_DESKTOP_PET_TEMPERATURE: "0.2",
    AI_DESKTOP_PET_MAX_TOKENS: "80"
  };
  startElectron(context);
  await connectToElectron(context);
  const pet = await waitForWindow(context, "renderer/pet/index.html");
  await evaluate(pet, "window.petApi?.openChat()");
  const chat = await waitForWindow(context, "renderer/chat/index.html");
  await waitFor(chat, "Boolean(document.querySelector('#history-retention-limit') && window.historyApi?.getRetentionLimit)");
  await sendChat(chat, oldProviderContextMarker);
  const checks = await evaluate(chat, `
    (async () => {
      document.querySelector('#settings-button').click();
      document.querySelector('#settings-data-tab').click();
      const historyGroup = document.querySelector('#history-settings-group');
      if (!historyGroup.open) historyGroup.querySelector('summary').click();
      await window.memoryApi.setEnabled(true);
      const memoryResult = await window.memoryApi.createCard({
        title: 'P2-91A 保留事实',
        content: '清空历史后仍需保留。',
        tags: ['验收'],
        sourceConversationId: crypto.randomUUID()
      });
      const factsBefore = await window.memoryApi.listCards();
      const reviewsBefore = await window.memoryApi.listReviews();
      const suppressionsBefore = await window.memoryApi.listSuppressions();
      const select = document.querySelector('#history-retention-limit');
      const save = document.querySelector('#save-history-retention-button');
      select.value = '100';
      save.click();
      await new Promise((resolve) => setTimeout(resolve, 150));
      const saved = await window.historyApi.getRetentionLimit();
      select.value = '1000';
      save.click();
      await new Promise((resolve) => setTimeout(resolve, 150));
      const expanded = await window.historyApi.getRetentionLimit();
      select.value = '500';
      save.click();
      await new Promise((resolve) => setTimeout(resolve, 150));
      const restored = await window.historyApi.getRetentionLimit();
      document.querySelector('#clear-history-button').click();
      document.querySelector('#confirm-clear-history-button').click();
      await new Promise((resolve) => setTimeout(resolve, 200));
      const [historyAfter, factsAfter, reviewsAfter, suppressionsAfter] = await Promise.all([
        window.historyApi.listConversations(),
        window.memoryApi.listCards(),
        window.memoryApi.listReviews(),
        window.memoryApi.listSuppressions()
      ]);
      return {
        retentionControlVisible: historyGroup.open && document.querySelector('#history-retention-limit')?.value === '500',
        historyApiTrusted: saved === 100 && expanded === 1000 && restored === 500,
        clearHistoryVisible: historyAfter.length === 0 && document.querySelector('#conversation-list').textContent.includes('暂无本地历史'),
        providerResetNoteVisible: document.querySelector('#chat-session-note')?.textContent?.includes('Provider 上下文已重置') === true,
        memoryBoundariesPreserved: memoryResult.status === 'created' && factsBefore.length > 0 && reviewsBefore.length > 0 && suppressionsBefore.length > 0 &&
          factsAfter.length === factsBefore.length && reviewsAfter.length === reviewsBefore.length && suppressionsAfter.length === suppressionsBefore.length &&
          factsBefore.every((item) => factsAfter.some((after) => after.id === item.id)) &&
          reviewsBefore.every((item) => reviewsAfter.some((after) => after.id === item.id)) &&
          suppressionsBefore.every((item) => suppressionsAfter.some((after) => after.id === item.id)),
        clearScopeVisible: document.querySelector('#clear-history-confirmation')?.textContent?.includes('事实卡、待复核候选或已忘记类型') === true,
        noSummaryBodyExposed: !document.body.textContent.includes(${JSON.stringify(semanticSummaryMarker)})
      };
    })()
  `);
  await evaluate(chat, "document.querySelector('#settings-close-button')?.click()");
  await sendChat(chat, newProviderContextMarker);
  const firstProviderBody = JSON.stringify(providerRequests[0] ?? {});
  const secondProviderBody = JSON.stringify(providerRequests[1] ?? {});
  checks.currentProviderContextReset = providerRequests.length === 2 &&
    firstProviderBody.includes(oldProviderContextMarker) &&
    secondProviderBody.includes(newProviderContextMarker) &&
    !secondProviderBody.includes(oldProviderContextMarker);
  result = {
    ok: Object.values(checks).every(Boolean),
    checks,
    screenshotResidue: findScreenshotResidue(context).filter((path) => !path.includes(context.runParentDir)).length
  };
  result.ok &&= result.screenshotResidue === 0;
} catch (error) {
  result = { ok: false, checks: {}, failure: error instanceof Error ? error.name : "unknown" };
} finally {
  await stopElectron(context);
  await close(providerServer);
  if (result.ok) cleanupRealUiRun(context);
}

console.log(JSON.stringify(result));
if (!result.ok) process.exitCode = 1;

function reviewDraft(key) {
  return {
    action: "create",
    title: "合成偏好",
    content: "用户喜欢安静的陪伴。",
    tags: ["合成"],
    namespace: "preference",
    key,
    importance: "general",
    category: "interaction",
    confidence: 0.9,
    sourceConversationId: crypto.randomUUID(),
    sourceMessageId: crypto.randomUUID()
  };
}

async function sendChat(chat, text) {
  await evaluate(chat, `
    (() => {
      const input = document.querySelector('#chat-input');
      input.value = ${JSON.stringify(text)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#chat-form').requestSubmit();
    })()
  `);
  await waitFor(chat, "document.querySelector('#chat-input')?.disabled === false", { timeoutMs: 20_000 });
}

function providerBaseURL() {
  return `http://127.0.0.1:${providerServer.address().port}/v1`;
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function close(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
  openAdvancedSettings,
  readPrivacyCheckText,
  sleep,
  startElectron,
  stopElectron,
  typeText,
  waitFor
} from "./support/real-ui-harness.mjs";

const context = createRealUiRunContext({
  runName: "p2-29a-privacy-safe-mcp-web-search",
  port: 9549,
  env: {
    AI_DESKTOP_PET_PROVIDER: "fake"
  }
});
const bundledServerPath = join(context.root, "dist", "main", "services", "search", "baidu-search-mcp-server.js");
const bundledServerBackup = readFileSync(bundledServerPath);
const fixtureRecordPath = join(context.runDir, "bundled-mcp-fixture-calls.jsonl");
let bundledFixtureInstalled = false;

try {
  startElectron(context);
  await connectToElectron(context, 30_000);
  const petPage = await getPageByUrlPart(context, "pet/index.html", 30_000);
  await waitFor(petPage, "Boolean(window.petApi)", { timeoutMs: 10_000 });
  await evaluate(petPage, "window.petApi.openChat()");
  const chatPage = await getPageByUrlPart(context, "chat/index.html", 30_000);
  await waitFor(chatPage, "Boolean(window.chatApi?.onContextTransparency) && Boolean(window.webSearchApi)", { timeoutMs: 10_000 });
  await evaluate(chatPage, `
    (() => {
      window.__p229aContextTransparencyEvents = [];
      window.chatApi.onContextTransparency((payload) => {
        window.__p229aContextTransparencyEvents.push(payload);
      });
    })()
  `);

  await openAdvancedSettings(chatPage);
  await waitFor(chatPage, "document.querySelector('#web-search-status')?.textContent.length > 0");
  const webSearchProfileState = await evaluate(chatPage, `({
    value: document.querySelector('#web-search-profile')?.value ?? '',
    options: [...document.querySelectorAll('#web-search-profile option')].map((option) => option.value),
    hasCustomProcessControls: Boolean(document.querySelector('#web-search-command, #web-search-args, #web-search-tool-name'))
  })`);
  assert.equal(webSearchProfileState.value, "bundled-baidu-search");
  assert.deepEqual(webSearchProfileState.options, ["bundled-baidu-search"]);
  assert.equal(webSearchProfileState.hasCustomProcessControls, false);
  await evaluate(chatPage, `
    (() => {
      const profile = document.querySelector('#web-search-profile');
      profile.value = 'bundled-baidu-search';
      profile.dispatchEvent(new Event('change', { bubbles: true }));
    })()
  `);
  await typeText(chatPage, "#web-search-timeout", "15000");
  await typeText(chatPage, "#web-search-max-results", "2");
  await evaluate(chatPage, "document.querySelector('#web-search-enabled').checked = true; document.querySelector('#web-search-enabled').dispatchEvent(new Event('change', { bubbles: true }))");
  await click(chatPage, "#web-search-save-button");
  await sleep(1_000);
  const webSearchSaveState = await evaluate(chatPage, `({
    status: document.querySelector('#web-search-status')?.textContent ?? '',
    feedback: document.querySelector('#settings-feedback')?.textContent ?? '',
    hasApi: Boolean(window.webSearchApi),
    hasChatApi: Boolean(window.chatApi),
    hasConfigApi: Boolean(window.configApi),
    hasMemoryApi: Boolean(window.memoryApi),
    enabled: document.querySelector('#web-search-enabled')?.checked ?? false,
    profile: document.querySelector('#web-search-profile')?.value ?? ''
  })`);
  assert.equal(webSearchSaveState.hasApi, true, `webSearchApi missing: ${JSON.stringify(webSearchSaveState)}`);
  assert.match(webSearchSaveState.status, /已启用/, `web search save failed: ${JSON.stringify(webSearchSaveState)}`);
  assert.equal(webSearchSaveState.profile, "bundled-baidu-search");
  await click(chatPage, "#web-search-test-button");
  await waitFor(chatPage, "document.querySelector('#web-search-status')?.textContent.includes('工具可用')", {
    timeoutMs: 15_000
  });
  bundledFixtureInstalled = true;
  writeFileSync(bundledServerPath, createBundledMcpFixtureSource(fixtureRecordPath), "utf8");
  await closeSettingsPage(chatPage);

  await typeText(chatPage, chatUiSelectors.chat.input, "请联网搜索 P2-29A 公开 MCP 引用验收");
  await click(chatPage, chatUiSelectors.chat.send);
  await waitFor(chatPage, "document.querySelector('.message-pet .message-citations')", { timeoutMs: 30_000 });
  await waitFor(chatPage, "window.__p229aContextTransparencyEvents.length >= 1", { timeoutMs: 10_000 });
  const publicSearchState = await evaluate(chatPage, `(() => {
    const citations = [...document.querySelectorAll('.message-pet .message-citations')];
    const citation = citations[citations.length - 1];
    const transparency = window.__p229aContextTransparencyEvents[0];
    return {
      citationCount: citation?.querySelectorAll('.message-citation-item').length ?? 0,
      citationText: citation?.textContent ?? '',
      links: [...citation?.querySelectorAll('a') ?? []].map((link) => ({
        href: link.href,
        rel: link.rel
      })),
      transparency
    };
  })()`);
  assert.ok(publicSearchState.citationCount > 0, "bundled MCP search must render at least one citation");
  assert.match(publicSearchState.citationText, /资料来源/);
  assert.equal(publicSearchState.links.every((link) => /^https?:\/\//.test(link.href) && link.rel === "noreferrer"), true);
  assert.equal(publicSearchState.transparency?.webSearch?.included, true);
  assert.equal(publicSearchState.transparency?.webSearch?.citationCount, publicSearchState.citationCount);

  await typeText(chatPage, chatUiSelectors.chat.input, "请联网搜索我的聊天记录里 alice@example.com 的住址是什么");
  await click(chatPage, chatUiSelectors.chat.send);
  await waitFor(chatPage, "document.querySelector('#send-button')?.textContent === '发送'", { timeoutMs: 20_000 });
  await waitFor(chatPage, "window.__p229aContextTransparencyEvents.length >= 2", { timeoutMs: 10_000 });
  const privateSearchState = await evaluate(chatPage, `({
    transparency: window.__p229aContextTransparencyEvents[1],
    citationContainerCount: document.querySelectorAll('.message-pet .message-citations').length
  })`);
  assert.equal(privateSearchState.transparency?.webSearch?.included, false);
  assert.equal(privateSearchState.transparency?.webSearch?.citationCount, 0);
  assert.equal(privateSearchState.citationContainerCount, 1, "private memory request must not add a citation UI");

  assert.equal(existsSync(fixtureRecordPath), true);
  const mcpCalls = readFileSync(fixtureRecordPath, "utf8").trim().split(/\r?\n/).filter(Boolean);
  assert.equal(mcpCalls.length, 1, "private memory request must not call the bundled MCP capability");
  assert.match(mcpCalls[0] ?? "", /P2-29A/);
  assert.doesNotMatch(mcpCalls[0] ?? "", /alice@example\.com|聊天记录|住址/i);
  assert.doesNotMatch(mcpCalls[0] ?? "", /memoryContext|providerMessages|apiKey|prompt|messages|content/i);

  const privacyText = readPrivacyCheckText(context);
  assert.match(privacyText, /"type":"web_search_blocked"[^\r\n]*"private_memory_request"/);
  assert.equal((privacyText.match(/"type":"web_search_started"/g) ?? []).length, 1, "private memory request must not start a second MCP search");
  assert.equal((privacyText.match(/"type":"web_search_completed"/g) ?? []).length, 1, "public MCP search must complete exactly once");
  assert.doesNotMatch(privacyText, /alice@example\.com/i);
  assert.doesNotMatch(privacyText, /apiKey|providerRequestBody|memoryContext|providerMessages|systemPrompt/i);
  assertNoScreenshotResidue(context);

  writeFileSync(context.resultPath, `${JSON.stringify({
    ok: true,
    profile: webSearchSaveState.profile,
    bundledMcpConnection: "tool_available",
    bundledMcpFixtureCalls: mcpCalls.length,
    publicSearchCitationCount: publicSearchState.citationCount,
    privateSearchBlocked: true,
    privacyChecked: true
  }, null, 2)}\n`, "utf8");
} catch (error) {
  console.error(readPrivacyCheckText(context));
  throw error;
} finally {
  try {
    await stopElectron(context);
  } finally {
    if (bundledFixtureInstalled) {
      writeFileSync(bundledServerPath, bundledServerBackup);
    }
    cleanupRealUiRun(context);
  }
}

function createBundledMcpFixtureSource(recordPath) {
  return `
const { writeFileSync } = require("node:fs");
const { createInterface } = require("node:readline");

const recordPath = ${JSON.stringify(recordPath)};
const lineReader = createInterface({ input: process.stdin });

lineReader.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    respond(message.id, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "p2-29a-bundled-capability-fixture", version: "0.0.0" }
    });
    return;
  }
  if (message.method === "tools/list") {
    respond(message.id, {
      tools: [{
        name: "search",
        description: "Deterministic public search fixture for P2-29A real UI acceptance.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" }, limit: { type: "number" } },
          required: ["query"]
        }
      }]
    });
    return;
  }
  if (message.method === "tools/call") {
    writeFileSync(recordPath, JSON.stringify(message.params.arguments) + "\\n", { flag: "a" });
    respond(message.id, {
      structuredContent: {
        results: [{
          title: "P2-29A MCP 搜索引用验收",
          snippet: "公开搜索结果经 bundled capability、MCP stdio 和引用 UI 展示。",
          url: "https://example.test/p2-29a-public-result"
        }]
      },
      content: [{
        type: "text",
        text: JSON.stringify({
          results: [{
            title: "P2-29A MCP 搜索引用验收",
            snippet: "公开搜索结果经 bundled capability、MCP stdio 和引用 UI 展示。",
            url: "https://example.test/p2-29a-public-result"
          }]
        })
      }]
    });
    return;
  }
  if (Object.prototype.hasOwnProperty.call(message, "id")) {
    respond(message.id, {});
  }
});

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
}
`;
}

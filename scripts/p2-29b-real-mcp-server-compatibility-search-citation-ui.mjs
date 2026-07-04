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
  runName: "p2-29b-real-mcp-server-compatibility-search-citation-ui",
  port: 9550,
  env: {
    AI_DESKTOP_PET_PROVIDER: "fake"
  }
});

const fakeServerPath = join(context.runDir, "fake-mcp-search-server.mjs");
const fakeRecordPath = join(context.runDir, "fake-mcp-calls.jsonl");
const braveApiKeyConfigured = Boolean(process.env.BRAVE_API_KEY);

writeFileSync(fakeServerPath, createFakeMcpServerSource(), "utf8");

let liveMcpStatus = braveApiKeyConfigured ? "not_run" : "blocked_missing_brave_api_key";

try {
  startElectron(context);
  await connectToElectron(context, 30_000);
  const petPage = await getPageByUrlPart(context, "pet/index.html", 30_000);
  await waitFor(petPage, "Boolean(window.petApi)", { timeoutMs: 10_000 });
  await evaluate(petPage, "window.petApi.openChat()");
  const chatPage = await getPageByUrlPart(context, "chat/index.html", 30_000);
  await waitFor(chatPage, "Boolean(window.chatApi) && Boolean(window.webSearchApi)", { timeoutMs: 10_000 });

  await configureSearch(chatPage, {
    command: process.execPath,
    args: `${fakeServerPath} ${fakeRecordPath}`,
    toolName: "web_search",
    timeoutMs: "5000",
    maxResults: "3",
    enabled: true
  });

  await click(chatPage, "#web-search-test-button");
  await waitFor(chatPage, "document.querySelector('#web-search-status')?.textContent.includes('工具可用')", {
    timeoutMs: 10_000
  });

  const probeRecordBeforeSearch = readFakeRecordLines();
  assert.equal(probeRecordBeforeSearch.some((line) => line.includes("tools/call")), false, "connection test must not call search tool");

  await closeSettingsPage(chatPage);
  await typeText(chatPage, chatUiSelectors.chat.input, "请联网搜索 P2-29B fake MCP 搜索引用 UI 验收");
  await click(chatPage, chatUiSelectors.chat.send);
  await waitFor(chatPage, "document.querySelector('.message-pet .message-citations')", { timeoutMs: 20_000 });

  const fakeCitationState = await evaluate(chatPage, `(() => {
    const citation = document.querySelector('.message-pet .message-citations');
    return {
      hasCitation: Boolean(citation),
      text: citation?.textContent ?? '',
      urls: [...document.querySelectorAll('.message-citation-url')].map((node) => node.textContent ?? ''),
      linkHrefs: [...document.querySelectorAll('.message-citations a')].map((node) => node.href)
    };
  })()`);
  assert.equal(fakeCitationState.hasCitation, true);
  assert.match(fakeCitationState.text, /资料来源/);
  assert.match(fakeCitationState.text, /FAKE_MCP_STRUCTURED_RESULT|FAKE_MCP_JSON_RESULT/);
  assert.equal(fakeCitationState.urls.some((url) => /[?#]|token=|secret/.test(url)), false);
  assert.equal(fakeCitationState.linkHrefs.some((url) => /[?#]|token=|secret/.test(url)), false);

  const fakeRecordAfterSearch = readFakeRecordLines();
  const fakeToolCalls = fakeRecordAfterSearch.filter((line) => line.includes("tools/call"));
  assert.equal(fakeToolCalls.length, 1);
  assert.match(fakeToolCalls[0] ?? "", /P2-29B/);
  assert.doesNotMatch(fakeToolCalls[0] ?? "", /memoryContext|providerMessages|apiKey|prompt|messages|content/i);

  if (braveApiKeyConfigured) {
    liveMcpStatus = await runBraveLivePath(chatPage);
  } else {
    console.log("liveMcpStatus=blocked_missing_brave_api_key");
  }

  const privacyText = readPrivacyCheckText(context);
  assert.doesNotMatch(privacyText, /BRAVE_API_KEY|providerRequestBody|memoryContext|providerMessages|systemPrompt|apiKey/i);
  assert.doesNotMatch(privacyText, /sk-[A-Za-z0-9_-]{8,}/);
  assertNoScreenshotResidue(context);

  writeFileSync(context.resultPath, `${JSON.stringify({
    ok: true,
    fakeMcpCompatibility: true,
    citationUiVisible: true,
    fakeToolCallCount: fakeToolCalls.length,
    liveMcpStatus,
    braveApiKeyConfigured,
    privacyChecked: true
  }, null, 2)}\n`, "utf8");
} catch (error) {
  console.error(readPrivacyCheckText(context));
  throw error;
} finally {
  await stopElectron(context);
  cleanupRealUiRun(context);
}

async function configureSearch(chatPage, settings) {
  await openAdvancedSettings(chatPage);
  await waitFor(chatPage, "document.querySelector('#web-search-status')?.textContent.length > 0");
  await typeText(chatPage, "#web-search-command", settings.command);
  await typeText(chatPage, "#web-search-args", settings.args);
  await typeText(chatPage, "#web-search-tool-name", settings.toolName);
  await typeText(chatPage, "#web-search-timeout", settings.timeoutMs);
  await typeText(chatPage, "#web-search-max-results", settings.maxResults);
  await evaluate(chatPage, `
    (() => {
      const enabled = document.querySelector('#web-search-enabled');
      enabled.checked = ${settings.enabled ? "true" : "false"};
      enabled.dispatchEvent(new Event('change', { bubbles: true }));
    })()
  `);
  await click(chatPage, "#web-search-save-button");
  await sleep(1_000);
}

async function runBraveLivePath(chatPage) {
  await configureSearch(chatPage, {
    command: "npx.cmd",
    args: "-y @brave/brave-search-mcp-server --transport stdio",
    toolName: "brave_web_search",
    timeoutMs: "20000",
    maxResults: "2",
    enabled: true
  });

  await click(chatPage, "#web-search-test-button");
  await waitFor(chatPage, "document.querySelector('#web-search-status')?.textContent.includes('工具可用')", {
    timeoutMs: 30_000
  });
  await closeSettingsPage(chatPage);
  const beforeCount = await evaluate(chatPage, "document.querySelectorAll('.message-citations').length");
  await typeText(chatPage, chatUiSelectors.chat.input, "请联网搜索 OpenAI 公开新闻");
  await click(chatPage, chatUiSelectors.chat.send);
  await waitFor(chatPage, `document.querySelectorAll('.message-citations').length > ${beforeCount}`, {
    timeoutMs: 45_000
  });
  const liveState = await evaluate(chatPage, `(() => {
    const citations = [...document.querySelectorAll('.message-citations')];
    const latest = citations[citations.length - 1];
    return {
      hasCitation: Boolean(latest),
      textLength: latest?.textContent?.length ?? 0,
      urlHasQueryOrHash: [...latest?.querySelectorAll('.message-citation-url') ?? []]
        .some((node) => /[?#]/.test(node.textContent ?? ''))
    };
  })()`);

  assert.equal(liveState.hasCitation, true);
  assert.equal(liveState.urlHasQueryOrHash, false);
  assert.ok(liveState.textLength > 0);
  console.log("liveMcpStatus=brave_live_pass");
  return "brave_live_pass";
}

function readFakeRecordLines() {
  if (!existsSync(fakeRecordPath)) {
    return [];
  }

  return readFileSync(fakeRecordPath, "utf8").trim().split(/\r?\n/).filter(Boolean);
}

function createFakeMcpServerSource() {
  return `
import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";

const recordPath = process.argv[2];
const lineReader = createInterface({ input: process.stdin });

lineReader.on("line", (line) => {
  const message = JSON.parse(line);
  writeFileSync(recordPath, JSON.stringify({ method: message.method, name: message.params?.name ?? null, arguments: message.method === "tools/call" ? message.params?.arguments : undefined }) + "\\n", { flag: "a" });
  if (message.method === "initialize") {
    respond(message.id, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-p2-29b-search", version: "0.0.0" } });
    return;
  }
  if (message.method === "tools/list") {
    respond(message.id, {
      tools: [{
        name: "web_search",
        description: "FAKE MCP search for P2-29B acceptance; no network access",
        inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] }
      }]
    });
    return;
  }
  if (message.method === "tools/call") {
    respond(message.id, {
      content: [{
        type: "text",
        text: JSON.stringify({
          results: [{
            title: "FAKE_MCP_JSON_RESULT",
            description: "这是 P2-29B JSON text 搜索摘要，用于验收引用 UI。",
            link: "https://example.test/p2-29b-json?token=secret#frag",
            publishedAt: "2026-07-04"
          }]
        })
      }],
      structuredContent: {
        results: [{
          title: "FAKE_MCP_STRUCTURED_RESULT",
          snippet: "这是 P2-29B structuredContent 搜索摘要，用于验收真实 MCP 兼容解析。",
          url: "https://example.test/p2-29b-structured?apiKey=secret#section",
          date: "2026-07-04"
        }]
      }
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

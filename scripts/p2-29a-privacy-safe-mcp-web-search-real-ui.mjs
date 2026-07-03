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

const fakeServerPath = join(context.runDir, "fake-mcp-search-server.mjs");
const fakeRecordPath = join(context.runDir, "fake-mcp-calls.jsonl");

writeFileSync(fakeServerPath, createFakeMcpServerSource(), "utf8");

try {
  startElectron(context);
  await connectToElectron(context, 30_000);
  const petPage = await getPageByUrlPart(context, "pet/index.html", 30_000);
  await waitFor(petPage, "Boolean(window.petApi)", { timeoutMs: 10_000 });
  await evaluate(petPage, "window.petApi.openChat()");
  const chatPage = await getPageByUrlPart(context, "chat/index.html", 30_000);
  await waitFor(chatPage, "Boolean(window.chatApi) && Boolean(window.webSearchApi)", { timeoutMs: 10_000 });

  await openAdvancedSettings(chatPage);
  await waitFor(chatPage, "document.querySelector('#web-search-status')?.textContent.length > 0");
  await typeText(chatPage, "#web-search-command", process.execPath);
  await typeText(chatPage, "#web-search-args", `${fakeServerPath} ${fakeRecordPath}`);
  await typeText(chatPage, "#web-search-tool-name", "web_search");
  await typeText(chatPage, "#web-search-timeout", "5000");
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
    command: document.querySelector('#web-search-command')?.value ?? '',
    args: document.querySelector('#web-search-args')?.value ?? ''
  })`);
  assert.equal(webSearchSaveState.hasApi, true, `webSearchApi missing: ${JSON.stringify(webSearchSaveState)}`);
  assert.match(webSearchSaveState.status, /已启用/, `web search save failed: ${JSON.stringify(webSearchSaveState)}`);
  await closeSettingsPage(chatPage);

  await typeText(chatPage, chatUiSelectors.chat.input, "请联网搜索 P2-29A fake MCP 搜索验收最新信息");
  await click(chatPage, chatUiSelectors.chat.send);
  await waitFor(chatPage, "[...document.querySelectorAll('.message-pet .message-content')].some((node) => node.textContent.includes('FAKE_MCP_SEARCH_RESULT'))", { timeoutMs: 20_000 });

  await typeText(chatPage, chatUiSelectors.chat.input, "请联网搜索我的聊天记录里 alice@example.com 的住址是什么");
  await click(chatPage, chatUiSelectors.chat.send);
  await waitFor(chatPage, "document.querySelector('#send-button')?.textContent === '发送'", { timeoutMs: 20_000 });

  assert.equal(existsSync(fakeRecordPath), true);
  const mcpCalls = readFileSync(fakeRecordPath, "utf8").trim().split(/\r?\n/).filter(Boolean);
  assert.equal(mcpCalls.length, 1, "private memory request must not call fake MCP search");
  assert.match(mcpCalls[0] ?? "", /P2-29A/);
  assert.doesNotMatch(mcpCalls[0] ?? "", /alice@example\.com/i);
  assert.doesNotMatch(mcpCalls[0] ?? "", /聊天记录|住址|memoryContext|providerMessages|apiKey|prompt|messages|content/i);

  const privacyText = readPrivacyCheckText(context);
  assert.doesNotMatch(privacyText, /alice@example\.com/i);
  assert.doesNotMatch(privacyText, /apiKey|providerRequestBody|memoryContext|providerMessages|systemPrompt/i);
  assertNoScreenshotResidue(context);

  writeFileSync(context.resultPath, `${JSON.stringify({
    ok: true,
    fakeMcpSearchCalls: mcpCalls.length,
    fakeOnly: true,
    privacyChecked: true
  }, null, 2)}\n`, "utf8");
} catch (error) {
  console.error(readPrivacyCheckText(context));
  throw error;
} finally {
  await stopElectron(context);
  cleanupRealUiRun(context);
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
    respond(message.id, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-p2-29a-search", version: "0.0.0" } });
    return;
  }
  if (message.method === "tools/list") {
    respond(message.id, {
      tools: [{
        name: "web_search",
        description: "FAKE MCP search for P2-29A acceptance; no network access",
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
            title: "FAKE_MCP_SEARCH_RESULT",
            snippet: "这是 P2-29A fake MCP 搜索摘要，用于验收隐私网关和 stdio 编排，不代表真实联网结果。",
            url: "https://example.test/p2-29a"
          }]
        })
      }],
      structuredContent: { isFake: true }
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

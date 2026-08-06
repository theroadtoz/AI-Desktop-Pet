import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

function handlerSource(appSource: string, channel: string): string {
  const start = appSource.indexOf(`ipcMain.handle("${channel}"`);
  assert.notEqual(start, -1, `missing handler ${channel}`);
  const next = appSource.indexOf("ipcMain.handle(", start + 16);
  return appSource.slice(start, next === -1 ? undefined : next);
}

function assertOrdered(source: string, fragments: readonly string[]): void {
  let cursor = -1;
  for (const fragment of fragments) {
    const index = source.indexOf(fragment, cursor + 1);
    assert.notEqual(index, -1, `missing ordered fragment: ${fragment}`);
    cursor = index;
  }
}

test("history, memory, automatic situation and user profile IPC are restricted and expose no file access bridge", async () => {
  const appSource = await readFile(join(process.cwd(), "src", "main", "app.ts"), "utf8");
  const preloadSource = await readFile(join(process.cwd(), "dist", "preload", "chat-preload.js"), "utf8");

  assert.match(appSource, /from "\.\.\/shared\/memory-history-codec"/u);
  assertOrdered(handlerSource(appSource, "history:list"), ["isChatSender(event)", "historyStore.listConversations()", "parseHistoryConversationList("]);
  assertOrdered(handlerSource(appSource, "history:get"), ["isChatSender(event)", "parseHistoryIdRequest({ id })", "historyStore.getConversation(", "parseNullableHistoryConversation("]);
  assertOrdered(handlerSource(appSource, "history:delete"), ["isChatSender(event)", "parseHistoryIdRequest({ id })", "historyStore.deleteConversation(", "parseBooleanResponse("]);
  const historyClearHandler = handlerSource(appSource, "history:clear");
  assertOrdered(historyClearHandler, ["if (!isChatSender(event))", "Unauthorized history request", "if (!historyStore)", "History clear failed", "historyStore.clearConversations() !== true", "return undefined"]);
  assertOrdered(handlerSource(appSource, "history:get-retention"), ["isChatSender(event)", "historyStore.getRetentionLimit()", "parseHistoryRetentionLimit("]);
  assertOrdered(handlerSource(appSource, "history:set-retention"), ["isChatSender(event)", "parseHistoryRetentionRequest({ limit })", "historyStore.setRetentionLimit(", "parseHistoryRetentionLimit("]);
  assertOrdered(handlerSource(appSource, "memory:list"), ["isChatSender(event)", "memoryStore.listCards()", "parseMemoryCards("]);
  assertOrdered(handlerSource(appSource, "memory:create"), ["isChatSender(event)", "parseMemoryCardDraftRequest({ draft })", "memoryStore.createCard(", "parseMemoryCreateResult("]);
  assertOrdered(handlerSource(appSource, "memory:confirm-review"), ["isChatSender(event)", "parseMemoryReviewDecisionRequest({ id, update })", "memoryReviewStore.pruneExpiredPendingCandidates()", "parseMemoryReviewDecisionResult("]);
  assert.match(appSource, /ipcMain\.handle\("memory:clear", \(event\) => \{\s+if \(!isChatSender\(event\) \|\| !memoryStore \|\| !memoryReviewStore\)/);
  assert.match(appSource, /ipcMain\.handle\("userProfile:get", \(event\) => \{\s+if \(!isChatSender\(event\) \|\| !userProfileStore\)/);
  assert.match(appSource, /ipcMain\.handle\("userProfile:save", \(event, profile: unknown\) => \{\s+if \(!isChatSender\(event\) \|\| !userProfileStore\)/);
  assert.match(appSource, /ipcMain\.handle\("userProfile:clear", \(event\) => \{\s+if \(!isChatSender\(event\) \|\| !userProfileStore\)/);
  assert.match(appSource, /ipcMain\.handle\("automaticSituation:get", \(event\) => \{\s+if \(!isPetSender\(event\) \|\| !automaticSituationCoordinator\)/);
  assert.doesNotMatch(appSource, /ipcMain\.handle\("(?:dialogue|presence)Mode:(?:list|get|set)"/);
  assert.match(appSource, /event\.sender\.send\("chat:context-transparency", createChatContextTransparencyPayload\(\{/);
  assert.match(appSource, /event\.sender\.send\("chat:memory-activity", createChatMemoryActivityPayload\(\{/);
  assert.match(preloadSource, /exposeInMainWorld\("historyApi", historyApi\)/);
  assert.match(preloadSource, /ipcRenderer\.invoke\("history:get-retention"\)/);
  assert.match(preloadSource, /ipcRenderer\.invoke\("history:set-retention", request\.limit\)/);
  assert.match(preloadSource, /value === 100 \|\| value === 500 \|\| value === 1e3/);
  assert.doesNotMatch(preloadSource, /value === 2048/);
  assert.match(preloadSource, /exposeInMainWorld\("memoryApi", memoryApi\)/);
  assert.match(preloadSource, /exposeInMainWorld\("userProfileApi", userProfileApi\)/);
  assert.doesNotMatch(preloadSource, /exposeInMainWorld\("(?:dialogue|presence)ModeApi"/);
  assert.match(preloadSource, /onContextTransparency\(handler\) \{/);
  assert.match(preloadSource, /ipcRenderer\.on\("chat:context-transparency", listener\)/);
  assert.match(preloadSource, /hasExactKeys\d*\(value, \["requestVersion", "contextBudget", "memory", "webSearch"\]\)/);
  assert.match(preloadSource, /hasExactKeys\d*\(contextBudget, \[[\s\S]*"originalMessageCount"[\s\S]*"providerMessageCount"[\s\S]*"recentMessageCount"[\s\S]*\]\)/);
  assert.match(preloadSource, /hasExactKeys\d*\(memory, \["injectionCount"\]\)/);
  assert.match(preloadSource, /hasExactKeys\d*\(webSearch, \[[\s\S]*"included"[\s\S]*"citationCount"[\s\S]*\]\)/);
  assert.match(preloadSource, /onMemoryActivity\(handler\) \{/);
  assert.match(preloadSource, /ipcRenderer\.on\("chat:memory-activity", listener\)/);
  assert.match(preloadSource, /hasExactKeys\d*\(value, \["requestVersion", "autoCapture", "injection", "contextBudget"\]\)/);
  assert.match(preloadSource, /hasExactKeys\d*\(autoCapture, \[[\s\S]*"injectionBudget"[\s\S]*\]\)/);
  assert.doesNotMatch(preloadSource, /exposeInMainWorld\("ipcRenderer"/);
  assert.doesNotMatch(preloadSource, /historyPath|memoryPath|profilePath|presenceModePath|readFile|writeFile/);
  assert.doesNotMatch(preloadSource, /history:get-retention[\s\S]{0,220}(content|summary|messages|prompt|providerMessages|apiKey|historyPath)/);
  assert.doesNotMatch(preloadSource, /chat:context-transparency[\s\S]{0,220}(content|cards|prompt|providerMessages|safeQuery|snippet|apiKey|memoryPath)/);
  assert.doesNotMatch(preloadSource, /chat:memory-activity[\s\S]{0,220}(content|cards|prompt|providerMessages|apiKey|memoryPath)/);
});

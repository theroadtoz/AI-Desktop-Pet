import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("history, memory and user profile IPC are restricted to the chat window and expose no file access bridge", async () => {
  const appSource = await readFile(join(process.cwd(), "src", "main", "app.ts"), "utf8");
  const preloadSource = await readFile(join(process.cwd(), "dist", "preload", "chat-preload.js"), "utf8");

  assert.match(appSource, /ipcMain\.handle\("history:list", \(event\) => \{\s+if \(!isChatSender\(event\) \|\| !historyStore\)/);
  assert.match(appSource, /ipcMain\.handle\("history:get", \(event, id: unknown\) => \{\s+if \(!isChatSender\(event\) \|\| !historyStore \|\| !isHistoryId\(id\)\)/);
  assert.match(appSource, /ipcMain\.handle\("history:clear", \(event\) => \{\s+if \(!isChatSender\(event\) \|\| !historyStore\)/);
  assert.match(appSource, /ipcMain\.handle\("memory:list", \(event\) => \{\s+if \(!isChatSender\(event\) \|\| !memoryStore\)/);
  assert.match(appSource, /ipcMain\.handle\("memory:create", \(event, draft: unknown\) => \{\s+const parsedDraft = parseMemoryCardDraft\(draft\);/);
  assert.match(appSource, /ipcMain\.handle\("memory:clear", \(event\) => \{\s+if \(!isChatSender\(event\) \|\| !memoryStore\)/);
  assert.match(appSource, /ipcMain\.handle\("userProfile:get", \(event\) => \{\s+if \(!isChatSender\(event\) \|\| !userProfileStore\)/);
  assert.match(appSource, /ipcMain\.handle\("userProfile:save", \(event, profile: unknown\) => \{\s+if \(!isChatSender\(event\) \|\| !userProfileStore\)/);
  assert.match(appSource, /ipcMain\.handle\("userProfile:clear", \(event\) => \{\s+if \(!isChatSender\(event\) \|\| !userProfileStore\)/);
  assert.match(preloadSource, /exposeInMainWorld\("historyApi", historyApi\)/);
  assert.match(preloadSource, /exposeInMainWorld\("memoryApi", memoryApi\)/);
  assert.match(preloadSource, /exposeInMainWorld\("userProfileApi", userProfileApi\)/);
  assert.doesNotMatch(preloadSource, /exposeInMainWorld\("ipcRenderer"/);
  assert.doesNotMatch(preloadSource, /historyPath|memoryPath|profilePath|readFile|writeFile/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("history, memory, mode and user profile IPC are restricted and expose no file access bridge", async () => {
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
  assert.match(appSource, /ipcMain\.handle\("presenceMode:list", \(event\) => \{\s+if \(!isChatSender\(event\)\)/);
  assert.match(appSource, /ipcMain\.handle\("presenceMode:get", \(event\) => \{\s+if \(!isChatSender\(event\) && !isPetSender\(event\)\)/);
  assert.match(appSource, /ipcMain\.handle\("presenceMode:set", \(event, modeId: unknown\) => \{\s+if \(!isChatSender\(event\) \|\| !presenceModeStore \|\| !isPresenceModeId\(modeId\)\)/);
  assert.match(preloadSource, /exposeInMainWorld\("historyApi", historyApi\)/);
  assert.match(preloadSource, /exposeInMainWorld\("memoryApi", memoryApi\)/);
  assert.match(preloadSource, /exposeInMainWorld\("userProfileApi", userProfileApi\)/);
  assert.match(preloadSource, /exposeInMainWorld\("presenceModeApi", presenceModeApi\)/);
  assert.doesNotMatch(preloadSource, /exposeInMainWorld\("ipcRenderer"/);
  assert.doesNotMatch(preloadSource, /historyPath|memoryPath|profilePath|presenceModePath|readFile|writeFile/);
});

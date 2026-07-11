import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { isTrustedIpcSender, type TrustedIpcDocumentRole } from "../src/main/ipc/trusted-ipc-sender.ts";

const rendererRoot = resolve("src", "renderer");

function getRoleDocumentUrl(role: TrustedIpcDocumentRole): string {
  return pathToFileURL(resolve("src", "renderer", role, "index.html")).href;
}

function createHarness(role: TrustedIpcDocumentRole = "chat") {
  const mainFrame = { url: getRoleDocumentUrl(role) };
  const webContents = {
    mainFrame,
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    }
  };
  const window = {
    webContents,
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    }
  };
  const event = {
    sender: webContents,
    senderFrame: mainFrame
  };

  return { event, mainFrame, webContents, window };
}

test("accepts the current window main frame at the exact trusted role document", () => {
  const chat = createHarness("chat");
  const pet = createHarness("pet");

  assert.equal(isTrustedIpcSender(chat.event, chat.window, "chat", rendererRoot), true);
  assert.equal(isTrustedIpcSender(pet.event, pet.window, "pet", rendererRoot), true);
});

test("rejects null frames and child frames", () => {
  const harness = createHarness();

  assert.equal(
    isTrustedIpcSender({ ...harness.event, senderFrame: null }, harness.window, "chat", rendererRoot),
    false
  );
  assert.equal(
    isTrustedIpcSender(
      { ...harness.event, senderFrame: { url: getRoleDocumentUrl("chat") } },
      harness.window,
      "chat",
      rendererRoot
    ),
    false
  );
});

test("rejects the wrong role, remote documents, and URL disguises", () => {
  const harness = createHarness();
  const rejectedUrls = [
    getRoleDocumentUrl("pet"),
    "https://example.com/renderer/chat/index.html",
    `${getRoleDocumentUrl("chat")}?role=chat`,
    `${getRoleDocumentUrl("chat")}#chat`
  ];

  for (const url of rejectedUrls) {
    harness.mainFrame.url = url;
    assert.equal(isTrustedIpcSender(harness.event, harness.window, "chat", rendererRoot), false, url);
  }
});

test("rejects stale, destroyed, or mismatched window capabilities", () => {
  const current = createHarness();
  const stale = createHarness();

  assert.equal(isTrustedIpcSender(stale.event, current.window, "chat", rendererRoot), false);

  current.window.destroyed = true;
  assert.equal(isTrustedIpcSender(current.event, current.window, "chat", rendererRoot), false);

  current.window.destroyed = false;
  current.webContents.destroyed = true;
  assert.equal(isTrustedIpcSender(current.event, current.window, "chat", rendererRoot), false);

  assert.equal(isTrustedIpcSender(current.event, null, "chat", rendererRoot), false);
});

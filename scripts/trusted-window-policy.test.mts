import assert from "node:assert/strict";
import test from "node:test";
import { installTrustedWindowPolicy } from "../src/main/windows/trusted-window-policy.ts";

interface NavigationEvent {
  url: string;
  preventDefault(): void;
}

interface WindowOpenDetails {
  url: string;
}

function createWebContentsHarness() {
  let navigateHandler: ((event: NavigationEvent) => void) | undefined;
  let windowOpenHandler:
    | ((details: WindowOpenDetails) => { action: "deny" })
    | undefined;

  return {
    webContents: {
      on(event: string, handler: (event: NavigationEvent) => void) {
        assert.equal(event, "will-navigate");
        navigateHandler = handler;
      },
      setWindowOpenHandler(
        handler: (details: WindowOpenDetails) => { action: "deny" }
      ) {
        windowOpenHandler = handler;
      }
    },
    navigate(url: string) {
      let prevented = false;
      assert.ok(navigateHandler, "will-navigate handler was installed");
      navigateHandler({
        url,
        preventDefault() {
          prevented = true;
        }
      });
      return prevented;
    },
    openWindow(url: string) {
      assert.ok(windowOpenHandler, "window open handler was installed");
      return windowOpenHandler({ url });
    }
  };
}

test("trusted navigation stays in the app and delegates parsed HTTPS once", () => {
  const harness = createWebContentsHarness();
  const opened: string[] = [];

  installTrustedWindowPolicy(harness.webContents, (url) => {
    opened.push(url);
  });

  assert.equal(harness.navigate("https://example.com/citation?q=trusted"), true);
  assert.deepEqual(opened, ["https://example.com/citation?q=trusted"]);
});

test("new windows are denied while parsed HTTP links are delegated once", () => {
  const harness = createWebContentsHarness();
  const opened: string[] = [];

  installTrustedWindowPolicy(harness.webContents, (url) => {
    opened.push(url);
  });

  assert.deepEqual(harness.openWindow("http://example.com:80/source"), {
    action: "deny"
  });
  assert.deepEqual(opened, ["http://example.com/source"]);
});

test("unsafe and malformed navigation is denied without invoking the opener", () => {
  const harness = createWebContentsHarness();
  const opened: string[] = [];
  const unsafeUrls = [
    "javascript:alert(1)",
    "data:text/html,<h1>unsafe</h1>",
    "file:///C:/Windows/System32/drivers/etc/hosts",
    "not a URL",
    "https://[invalid",
    " https://example.com",
    "https://exa\nmple.com"
  ];

  installTrustedWindowPolicy(harness.webContents, (url) => {
    opened.push(url);
  });

  for (const url of unsafeUrls) {
    assert.equal(harness.navigate(url), true);
    assert.deepEqual(harness.openWindow(url), { action: "deny" });
  }
  assert.deepEqual(opened, []);
});

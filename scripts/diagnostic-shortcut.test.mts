import assert from "node:assert/strict";
import test from "node:test";
import {
  WEBGL_DIAGNOSTIC_SHORTCUT,
  registerWebGLDiagnosticShortcut,
  sendWebGLDiagnosticTrigger
} from "../src/main/services/diagnostic-shortcut.ts";

test("WebGL diagnostic shortcut is registered only for unpackaged builds", () => {
  let registeredAccelerator: string | undefined;
  let triggered = 0;

  const development = registerWebGLDiagnosticShortcut({
    isPackaged: false,
    register(accelerator, callback) {
      registeredAccelerator = accelerator;
      callback();
      return true;
    },
    onTriggered() {
      triggered += 1;
    }
  });

  assert.deepEqual(development, {
    accelerator: WEBGL_DIAGNOSTIC_SHORTCUT,
    registered: true,
    reason: "registered"
  });
  assert.equal(registeredAccelerator, "Ctrl+Alt+Shift+L");
  assert.equal(triggered, 1);

  const packaged = registerWebGLDiagnosticShortcut({
    isPackaged: true,
    register() {
      throw new Error("packaged builds must not register diagnostic shortcuts");
    },
    onTriggered() {
      throw new Error("packaged builds must not trigger diagnostics");
    }
  });

  assert.deepEqual(packaged, {
    accelerator: WEBGL_DIAGNOSTIC_SHORTCUT,
    registered: false,
    reason: "packaged"
  });
});

test("WebGL diagnostic shortcut sends one safe renderer command", () => {
  const sent: string[] = [];

  assert.equal(sendWebGLDiagnosticTrigger({
    isDestroyed: () => false,
    webContents: {
      send(channel) {
        sent.push(channel);
      }
    }
  }), true);
  assert.deepEqual(sent, ["pet:inject-webgl-context-loss"]);
  assert.equal(sendWebGLDiagnosticTrigger(null), false);
});

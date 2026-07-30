import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const petWindowSource = readFileSync("src/main/windows/pet-window.ts", "utf8");

test("P2-88D R7-A3 keeps the opaque pet window override behind all three development diagnostic gates", () => {
  assert.match(petWindowSource, /import \{ app, BrowserWindow, shell \} from "electron";/);
  assert.match(petWindowSource, /const isOpaquePetWindowDiagnostic = !app\.isPackaged &&\s*process\.env\.AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY === "1" &&\s*process\.env\.AI_DESKTOP_PET_P2_88D_RENDERER_DIAG_MODE === "opaque-pet-window";/);
  assert.match(petWindowSource, /transparent: !isOpaquePetWindowDiagnostic,/);
});

test("P2-88D R7-A3 changes only the pet BrowserWindow transparency option and keeps production unreachable", () => {
  const optionsStart = petWindowSource.indexOf("const window = new BrowserWindow({");
  const optionsEnd = petWindowSource.indexOf("  });", optionsStart);
  const options = petWindowSource.slice(optionsStart, optionsEnd);

  assert.ok(optionsStart >= 0 && optionsEnd > optionsStart);
  assert.match(options, /width: 420,/);
  assert.match(options, /height: 600,/);
  assert.match(options, /transparent: !isOpaquePetWindowDiagnostic,/);
  assert.match(options, /backgroundColor: "#00000000",/);
  assert.match(options, /frame: false,/);
  assert.match(options, /hasShadow: false,/);
  assert.match(options, /resizable: false,/);
  assert.match(options, /skipTaskbar: true,/);
  assert.match(options, /show: false,/);
  assert.match(options, /focusable: false,/);
  assert.match(options, /nodeIntegration: false,/);
  assert.match(options, /contextIsolation: true,/);
  assert.match(options, /sandbox: true/);
  assert.doesNotMatch(options, /AI_DESKTOP_PET_P2_88D_RENDERER_DIAG_MODE/);
  assert.equal(options.match(/\btransparent:/g)?.length, 1);
  assert.equal(petWindowSource.match(/\bisOpaquePetWindowDiagnostic\b/g)?.length, 2);
});

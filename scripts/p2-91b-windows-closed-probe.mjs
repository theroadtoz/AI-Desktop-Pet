import { createRequire } from "node:module";
import { app, powerMonitor } from "electron";

const require = createRequire(import.meta.url);
const {
  bucketIdleSeconds,
  createWindowsDesktopContextProvider
} = require("../dist/main/services/desktop-context/windows-desktop-context-provider.js");

function currentTimeBand(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 17) return "daytime";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

function hasExactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

let provider;
try {
  await app.whenReady();
  provider = createWindowsDesktopContextProvider();
  const [quns, gsmtc] = await Promise.all([
    provider.sampleInterruptibility(),
    provider.sampleMedia()
  ]);
  const result = {
    ok: process.platform === "win32" &&
      hasExactKeys(quns, ["status", "value", "capability"]) &&
      hasExactKeys(gsmtc, ["status", "value", "capability"]),
    platform: process.platform,
    timeBand: currentTimeBand(),
    idleBucket: bucketIdleSeconds(powerMonitor.getSystemIdleTime()),
    quns,
    gsmtc
  };
  process.stdout.write(`P2_91B_CLOSED_PROBE ${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 1;
} catch {
  process.stdout.write("P2_91B_CLOSED_PROBE {\"ok\":false,\"reason\":\"closed_probe_failed\"}\n");
  process.exitCode = 1;
} finally {
  provider?.dispose();
  app.quit();
}

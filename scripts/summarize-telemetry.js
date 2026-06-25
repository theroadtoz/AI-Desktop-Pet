const { existsSync, readdirSync, readFileSync, statSync } = require("node:fs");
const { homedir } = require("node:os");
const { join } = require("node:path");

const APP_NAME = "ai-desktop-pet";
const MAX_FILES = 5;

function defaultLogDirectory() {
  if (process.platform === "win32" && process.env.APPDATA) {
    return join(process.env.APPDATA, APP_NAME, "logs");
  }

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", APP_NAME, "logs");
  }

  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), APP_NAME, "logs");
}

function readLogFiles(logDirectory) {
  if (!existsSync(logDirectory)) {
    return [];
  }

  return readdirSync(logDirectory)
    .filter((name) => name.startsWith("telemetry-") && name.endsWith(".jsonl"))
    .map((name) => join(logDirectory, name))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
    .slice(0, MAX_FILES)
    .reverse();
}

function readEvents(files) {
  const events = [];

  for (const file of files) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      try {
        events.push(JSON.parse(line));
      } catch {
        // Ignore partial lines from a currently running app.
      }
    }
  }

  return events;
}

function collectFirstFrameMs(events) {
  const firstFrameEvents = events
    .filter((event) => event.type === "first_frame")
    .map((event) => event.payload?.firstFrameMs)
    .filter((value) => typeof value === "number" && Number.isFinite(value));

  if (firstFrameEvents.length > 0) {
    return firstFrameEvents;
  }

  return events
    .filter((event) => event.type === "pet_health")
    .map((event) => event.payload?.firstFrameMs)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
}

function collectMaxWorkingSetMb(events) {
  let maxWorkingSetKb = 0;

  for (const event of events) {
    if (event.type !== "performance_heartbeat") {
      continue;
    }

    for (const metric of event.payload?.processMetrics ?? []) {
      const workingSetSize = metric?.memory?.workingSetSize;

      if (typeof workingSetSize === "number" && workingSetSize > maxWorkingSetKb) {
        maxWorkingSetKb = workingSetSize;
      }
    }
  }

  return maxWorkingSetKb > 0 ? Math.round((maxWorkingSetKb / 1024) * 10) / 10 : 0;
}

function countEvents(events, type) {
  return events.filter((event) => event.type === type).length;
}

function collectRendererPerformance(events) {
  const samples = events
    .filter((event) => event.type === "pet_performance_sample")
    .map((event) => event.payload ?? {});
  const byMode = {};

  for (const sample of samples) {
    const mode = typeof sample.mode === "string" ? sample.mode : "unknown";
    const bucket = byMode[mode] ?? {
      count: 0,
      latestTargetFramesPerSecond: null,
      maxRafFramesPerSecond: 0,
      maxRenderedFramesPerSecond: 0,
      maxLive2DUpdatesPerSecond: 0
    };

    bucket.count += 1;

    if (typeof sample.targetFramesPerSecond === "number") {
      bucket.latestTargetFramesPerSecond = sample.targetFramesPerSecond;
    }

    if (typeof sample.rafFramesPerSecond === "number") {
      bucket.maxRafFramesPerSecond = Math.max(bucket.maxRafFramesPerSecond, sample.rafFramesPerSecond);
    }

    if (typeof sample.renderedFramesPerSecond === "number") {
      bucket.maxRenderedFramesPerSecond = Math.max(bucket.maxRenderedFramesPerSecond, sample.renderedFramesPerSecond);
    }

    if (typeof sample.live2DUpdatesPerSecond === "number") {
      bucket.maxLive2DUpdatesPerSecond = Math.max(bucket.maxLive2DUpdatesPerSecond, sample.live2DUpdatesPerSecond);
    }

    byMode[mode] = bucket;
  }

  return {
    count: samples.length,
    byMode
  };
}

function main() {
  const logDirectory = process.argv[2] || defaultLogDirectory();
  const files = readLogFiles(logDirectory);
  const events = readEvents(files);
  const firstFrames = collectFirstFrameMs(events);

  const summary = {
    logDirectory,
    filesRead: files.length,
    eventsRead: events.length,
    startupCount: countEvents(events, "startup"),
    firstFrameMs: {
      count: firstFrames.length,
      min: firstFrames.length ? Math.min(...firstFrames) : null,
      max: firstFrames.length ? Math.max(...firstFrames) : null,
      latest: firstFrames.length ? firstFrames[firstFrames.length - 1] : null
    },
    contextLostCount: countEvents(events, "webgl_context_lost"),
    rendererGoneCount: countEvents(events, "renderer_process_gone"),
    recoverySucceededCount: countEvents(events, "recovery_succeeded"),
    recoveryFailedCount: countEvents(events, "recovery_failed"),
    maxWorkingSetMb: collectMaxWorkingSetMb(events),
    rendererPerformance: collectRendererPerformance(events)
  };

  console.log(JSON.stringify(summary, null, 2));
}

main();

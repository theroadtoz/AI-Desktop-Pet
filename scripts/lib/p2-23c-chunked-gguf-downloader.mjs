import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, truncateSync } from "node:fs";
import { basename, dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const defaultChunkBytes = 8 * 1024 * 1024;
export const defaultMaxRetriesPerChunk = 3;
export const defaultChunkTimeoutMs = 120_000;

export async function downloadChunkedGgufModel(options) {
  const startedAt = Date.now();
  const config = normalizeChunkedGgufDownloadConfig(options);
  const tempPath = `${config.destinationPath}.download`;
  const initialPartialSize = getFileSize(tempPath);
  const baseSource = initialPartialSize > 0 ? "resumed" : "chunked";

  if (typeof config.fetchImpl !== "function") {
    return blockedResult("model_download_unavailable", config, {
      source: "download",
      partialSizeBytes: initialPartialSize,
      durationMs: Date.now() - startedAt
    });
  }

  if (initialPartialSize === config.expectedSizeBytes) {
    renameSync(tempPath, config.destinationPath);
    return readyResult(config, "resumed", Date.now() - startedAt);
  }

  if (initialPartialSize > config.expectedSizeBytes) {
    return blockedResult("model_download_size_mismatch", config, {
      source: baseSource,
      partialSizeBytes: initialPartialSize,
      durationMs: Date.now() - startedAt
    });
  }

  mkdirSync(dirname(config.destinationPath), { recursive: true });

  let completedChunks = 0;
  let bytesWrittenThisRun = 0;
  let fullOverwrite = false;

  while (getFileSize(tempPath) < config.expectedSizeBytes) {
    const chunkStartBytes = getFileSize(tempPath);
    const limitResult = checkRunLimits(config, {
      startedAt,
      completedChunks,
      bytesWrittenThisRun,
      chunkStartBytes,
      source: baseSource
    });

    if (limitResult) {
      return limitResult;
    }

    const remainingBytes = config.expectedSizeBytes - chunkStartBytes;
    const allowedRunBytes = config.maxBytes ? config.maxBytes - bytesWrittenThisRun : remainingBytes;
    const currentChunkBytes = Math.min(config.chunkBytes, remainingBytes, allowedRunBytes);
    const chunkEndBytes = chunkStartBytes + currentChunkBytes - 1;
    let lastErrorName;
    let lastReason = "model_download_failed";
    let chunkOk = false;

    for (let attempt = 1; attempt <= config.maxRetriesPerChunk; attempt += 1) {
      const remainingWallClockMs = config.maxDurationMs
        ? Math.max(1, config.maxDurationMs - (Date.now() - startedAt))
        : config.timeoutMs;
      const timeoutMs = Math.min(config.timeoutMs, remainingWallClockMs);

      try {
        const status = await runChunkAttempt(config, {
          tempPath,
          chunkStartBytes,
          chunkEndBytes,
          attempt,
          timeoutMs
        });

        fullOverwrite = fullOverwrite || status.fullOverwrite;
        chunkOk = true;
        break;
      } catch (error) {
        truncatePartial(tempPath, chunkStartBytes);
        lastErrorName = error instanceof Error ? error.name : "unexpected_error";
        lastReason = error instanceof ChunkHttpStatusError
          ? `model_download_http_${error.statusCode}`
          : "model_download_failed";

        if (attempt >= config.maxRetriesPerChunk) {
          return blockedResult(lastReason, config, {
            source: baseSource,
            partialSizeBytes: getFileSize(tempPath),
            chunkStartBytes,
            chunkEndBytes,
            chunkBytes: currentChunkBytes,
            attempt,
            maxRetriesPerChunk: config.maxRetriesPerChunk,
            timeoutMs,
            errorName: lastErrorName,
            durationMs: Date.now() - startedAt
          });
        }
      }
    }

    if (!chunkOk) {
      return blockedResult(lastReason, config, {
        source: baseSource,
        partialSizeBytes: getFileSize(tempPath),
        chunkStartBytes,
        chunkEndBytes,
        chunkBytes: currentChunkBytes,
        maxRetriesPerChunk: config.maxRetriesPerChunk,
        errorName: lastErrorName,
        durationMs: Date.now() - startedAt
      });
    }

    const expectedPartialSize = fullOverwrite ? config.expectedSizeBytes : chunkEndBytes + 1;
    const actualPartialSize = getFileSize(tempPath);

    if (actualPartialSize !== expectedPartialSize) {
      return blockedResult("model_download_size_mismatch", config, {
        source: baseSource,
        partialSizeBytes: fullOverwrite ? actualPartialSize : truncateAndGetPartialSize(tempPath, chunkStartBytes),
        chunkStartBytes,
        chunkEndBytes,
        chunkBytes: currentChunkBytes,
        maxRetriesPerChunk: config.maxRetriesPerChunk,
        timeoutMs: config.timeoutMs,
        durationMs: Date.now() - startedAt
      });
    }

    completedChunks += 1;
    bytesWrittenThisRun += fullOverwrite ? config.expectedSizeBytes : currentChunkBytes;
  }

  const finalSize = getFileSize(tempPath);

  if (finalSize !== config.expectedSizeBytes) {
    return blockedResult("model_download_size_mismatch", config, {
      source: baseSource,
      partialSizeBytes: finalSize,
      durationMs: Date.now() - startedAt
    });
  }

  renameSync(tempPath, config.destinationPath);
  return readyResult(config, fullOverwrite ? "downloaded" : baseSource, Date.now() - startedAt);
}

export function normalizeChunkedGgufDownloadConfig(options) {
  const expectedSizeBytes = readPositiveInteger(options?.expectedSizeBytes) ?? 0;
  const chunkBytes = readPositiveInteger(options?.chunkBytes) ?? defaultChunkBytes;
  const maxRetriesPerChunk = readPositiveInteger(options?.maxRetriesPerChunk) ?? defaultMaxRetriesPerChunk;
  const timeoutMs = readPositiveInteger(options?.timeoutMs) ?? defaultChunkTimeoutMs;
  const maxDurationMs = readPositiveInteger(options?.maxDurationMs) ?? timeoutMs;

  return {
    destinationPath: options?.destinationPath,
    downloadURL: options?.downloadURL,
    expectedSizeBytes,
    fetchImpl: options?.fetchImpl,
    chunkBytes,
    maxRetriesPerChunk,
    timeoutMs,
    maxChunks: readPositiveInteger(options?.maxChunks) ?? undefined,
    maxBytes: readPositiveInteger(options?.maxBytes) ?? undefined,
    maxDurationMs
  };
}

async function runChunkAttempt(config, details) {
  const abortController = new AbortController();
  const timeoutError = createAbortError();
  let timeoutRejectId;
  const timeout = setTimeout(() => {
    abortController.abort(timeoutError);
  }, details.timeoutMs);

  timeout.unref?.();

  try {
    return await Promise.race([
      fetchAndWriteChunk(config, details, abortController.signal),
      new Promise((_, reject) => {
        timeoutRejectId = setTimeout(() => reject(timeoutError), details.timeoutMs);
        timeoutRejectId.unref?.();
      })
    ]);
  } finally {
    clearTimeout(timeout);
    clearTimeout(timeoutRejectId);
  }
}

async function fetchAndWriteChunk(config, details, signal) {
  const headers = {
    "User-Agent": "AI_Desktop_Pet/P2-23C local-llm-pack-preparer",
    Range: `bytes=${details.chunkStartBytes}-${details.chunkEndBytes}`
  };
  const response = await config.fetchImpl(config.downloadURL, {
    headers,
    signal
  });
  const statusCode = Number.isInteger(response?.status) ? response.status : 0;
  const fullOverwrite = details.chunkStartBytes === 0 && statusCode === 200;

  if (statusCode !== 206 && !fullOverwrite) {
    throw new ChunkHttpStatusError(statusCode);
  }

  if (!response?.body) {
    throw new Error("response_body_missing");
  }

  const sourceStream = typeof response.body.getReader === "function"
    ? Readable.fromWeb(response.body)
    : response.body;
  const writeFlags = details.chunkStartBytes === 0 || fullOverwrite ? "w" : "a";

  await pipeline(sourceStream, createWriteStream(details.tempPath, { flags: writeFlags }));

  return { fullOverwrite };
}

function checkRunLimits(config, details) {
  if (config.maxDurationMs && Date.now() - details.startedAt >= config.maxDurationMs) {
    return blockedResult("model_download_limit_reached", config, {
      source: details.source,
      partialSizeBytes: getFileSize(`${config.destinationPath}.download`),
      chunkStartBytes: details.chunkStartBytes,
      chunkBytes: config.chunkBytes,
      maxRetriesPerChunk: config.maxRetriesPerChunk,
      timeoutMs: config.timeoutMs,
      durationMs: Date.now() - details.startedAt
    });
  }

  if (config.maxChunks && details.completedChunks >= config.maxChunks) {
    return blockedResult("model_download_limit_reached", config, {
      source: details.source,
      partialSizeBytes: getFileSize(`${config.destinationPath}.download`),
      chunkStartBytes: details.chunkStartBytes,
      chunkBytes: config.chunkBytes,
      maxRetriesPerChunk: config.maxRetriesPerChunk,
      timeoutMs: config.timeoutMs,
      durationMs: Date.now() - details.startedAt
    });
  }

  if (config.maxBytes && details.bytesWrittenThisRun >= config.maxBytes) {
    return blockedResult("model_download_limit_reached", config, {
      source: details.source,
      partialSizeBytes: getFileSize(`${config.destinationPath}.download`),
      chunkStartBytes: details.chunkStartBytes,
      chunkBytes: config.chunkBytes,
      maxRetriesPerChunk: config.maxRetriesPerChunk,
      timeoutMs: config.timeoutMs,
      durationMs: Date.now() - details.startedAt
    });
  }

  return null;
}

function readyResult(config, source, durationMs) {
  return {
    ok: true,
    source,
    sourceBasename: basename(config.destinationPath),
    sizeBytes: config.expectedSizeBytes,
    summary: safeSummary(config, {
      reason: undefined,
      source,
      partialSizeBytes: config.expectedSizeBytes,
      durationMs
    })
  };
}

function blockedResult(reason, config, details) {
  return {
    ok: false,
    summary: safeSummary(config, {
      reason,
      ...details
    })
  };
}

function safeSummary(config, details) {
  return removeUndefined({
    reason: details.reason,
    modelName: basename(config.destinationPath ?? "model.gguf"),
    source: details.source,
    partialSizeBytes: details.partialSizeBytes,
    expectedModelSizeBytes: config.expectedSizeBytes,
    chunkStartBytes: details.chunkStartBytes,
    chunkEndBytes: details.chunkEndBytes,
    chunkBytes: details.chunkBytes,
    attempt: details.attempt,
    maxRetriesPerChunk: details.maxRetriesPerChunk,
    timeoutMs: details.timeoutMs,
    errorName: details.errorName,
    durationMs: details.durationMs,
    safeSummaryOnly: true
  });
}

function truncatePartial(path, sizeBytes) {
  if (isExistingFile(path) && getFileSize(path) !== sizeBytes) {
    truncateSync(path, sizeBytes);
  }
}

function truncateAndGetPartialSize(path, sizeBytes) {
  truncatePartial(path, sizeBytes);
  return getFileSize(path);
}

function getFileSize(path) {
  return isExistingFile(path) ? statSync(path).size : 0;
}

function isExistingFile(path) {
  try {
    return typeof path === "string" && path.length > 0 && existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function readPositiveInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function createAbortError() {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

function removeUndefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => typeof entryValue !== "undefined")
  );
}

class ChunkHttpStatusError extends Error {
  constructor(statusCode) {
    super(`unexpected_http_status_${statusCode}`);
    this.name = "HttpStatusError";
    this.statusCode = statusCode;
  }
}

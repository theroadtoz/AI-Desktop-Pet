import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { basename, join, resolve } from "node:path";
import {
  BAIDU_SEARCH_VERIFICATION_REQUIRED_ERROR,
  BUNDLED_BAIDU_SEARCH_COMMAND,
  type WebSearchConnectionTestResult,
  type WebSearchSettings,
  type WebSearchResult
} from "../../../shared/web-search";
import type { WebSearchProvider, WebSearchRequest } from "./web-search-provider";
import {
  createMcpProcessNotAllowedError,
  resolveMcpProcessCapability,
  type McpSpawnConfig
} from "./mcp-process-capability";

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: number;
  method?: string;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
  };
};

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

const MCP_PROTOCOL_VERSION = "2025-06-18";
const MAX_STDERR_BYTES = 4096;
const MCP_CLOSE_GRACE_MS = 250;
const MCP_CLOSE_FORCE_MS = 750;
const MCP_REGISTRY_CLOSE_MS = MCP_CLOSE_GRACE_MS + MCP_CLOSE_FORCE_MS + 250;
const MAX_RESULT_TITLE_LENGTH = 96;
const MAX_RESULT_SNIPPET_LENGTH = 360;
const MAX_RESULT_URL_LENGTH = 240;
const MAX_RESULT_DATE_LENGTH = 40;

export type ParseMcpToolResultsOptions = {
  trustedBaiduRedirects?: boolean;
  allowTitleSnippetFallback?: boolean;
};

export type McpSearchClientConfig = Pick<
  WebSearchSettings,
  "command" | "args" | "toolName" | "timeoutMs" | "maxResults"
>;

export type McpSpawnAdapter = {
  spawn(config: McpSearchClientConfig): ChildProcessWithoutNullStreams;
  terminateProcessTree?(process: ChildProcessWithoutNullStreams): Promise<void> | void;
};

type McpSessionClose = () => Promise<void>;

export type McpSearchSessionRegistry = {
  register(close: McpSessionClose): () => void;
  shutdown(): Promise<void>;
};

export type McpSearchClientOptions = {
  spawnAdapter?: McpSpawnAdapter;
  sessionRegistry?: McpSearchSessionRegistry;
};

export function createMcpSearchSessionRegistry(): McpSearchSessionRegistry {
  const activeSessions = new Set<McpSessionClose>();
  let shutdownPromise: Promise<void> | null = null;

  return {
    register(close) {
      if (shutdownPromise) {
        throw createMcpSearchError("mcp_search_closed");
      }
      activeSessions.add(close);
      return () => {
        activeSessions.delete(close);
      };
    },
    shutdown() {
      if (shutdownPromise) {
        return shutdownPromise;
      }
      shutdownPromise = Promise.allSettled(Array.from(activeSessions, (close) => settleWithin(
        close(),
        MCP_REGISTRY_CLOSE_MS
      ))).then((results) => {
        const failures = results.filter((result) => result.status === "rejected");
        if (failures.length > 0) {
          throw new Error("mcp_session_shutdown_failed");
        }
      });
      return shutdownPromise;
    }
  };
}

export const mcpSearchSessionRegistry = createMcpSearchSessionRegistry();

const DEFAULT_MCP_SPAWN_ADAPTER: McpSpawnAdapter = {
  spawn(config) {
    const spawnConfig = createMcpSpawnConfig(config);
    return spawn(spawnConfig.command, spawnConfig.args, {
      shell: spawnConfig.shell,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: createSafeMcpChildEnv(config)
    });
  },
  terminateProcessTree(process) {
    if (globalThis.process.platform === "win32" && process.pid) {
      return new Promise((resolve) => {
        execFile(
          "taskkill.exe",
          ["/pid", String(process.pid), "/T", "/F"],
          { windowsHide: true, timeout: MCP_CLOSE_FORCE_MS },
          () => resolve()
        );
      });
    }
    process.kill("SIGKILL");
  }
};

export function createMcpSearchProvider(
  config: McpSearchClientConfig,
  options: McpSearchClientOptions = {}
): WebSearchProvider {
  return {
    search(request) {
      return callMcpSearchTool(config, request, options);
    }
  };
}

export function createMcpSearchToolArguments(config: McpSearchClientConfig, request: WebSearchRequest): Record<string, unknown> {
  const limit = Math.min(request.maxResults, config.maxResults);
  if (isBundledBaiduSearchConfig(config)) {
    return {
      query: request.query,
      limit
    };
  }

  const args: Record<string, unknown> = {
    query: request.query,
    maxResults: limit,
    limit
  };

  if (isPinnedOpenWebSearchBaiduPreset(config)) {
    args.engines = ["baidu"];
  }

  if (isGoogleSearchMcpConfig(config)) {
    args.timeout = config.timeoutMs;
    args.language = "zh-CN";
    args.region = "com";
  }

  return args;
}

export async function callMcpSearchTool(
  config: McpSearchClientConfig,
  request: WebSearchRequest,
  options: McpSearchClientOptions = {}
): Promise<WebSearchResult[]> {
  if (!config.command.trim()) {
    throw createMcpSearchError("mcp_search_not_configured");
  }

  const session = createMcpJsonRpcSession(
    config,
    options.spawnAdapter,
    options.sessionRegistry ?? mcpSearchSessionRegistry
  );

  try {
    await session.start();
    await session.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "ai-desktop-pet",
        version: "0.0.0"
      }
    });
    session.notify("notifications/initialized", {});

    const tools = await session.request("tools/list", {});
    const toolName = resolveMcpSearchToolName(tools, config.toolName);

    const result = await session.request("tools/call", {
      name: toolName,
      arguments: createMcpSearchToolArguments(config, request)
    });

    if (isMcpToolErrorResult(result)) {
      throw createMcpSearchError(readMcpToolErrorCode(result) ?? "mcp_search_tool_failed");
    }

    return parseMcpToolResults(
      result,
      Math.min(request.maxResults, config.maxResults),
      isBundledBaiduSearchConfig(config)
        ? { trustedBaiduRedirects: true, allowTitleSnippetFallback: true }
        : undefined
    );
  } finally {
    await session.close();
  }
}

export async function testMcpSearchConnection(
  config: WebSearchSettings,
  options: McpSearchClientOptions = {}
): Promise<WebSearchConnectionTestResult> {
  const baseResult = {
    commandConfigured: config.command.trim().length > 0,
    enabled: config.enabled,
    toolName: config.toolName,
    toolFound: false,
    toolCount: 0,
    ...(config.command ? { commandName: basename(config.command) } : {})
  };

  if (!baseResult.commandConfigured) {
    return { ...baseResult, status: "not_configured" };
  }

  if (!config.enabled) {
    return { ...baseResult, status: "configured_disabled" };
  }

  const session = createMcpJsonRpcSession(
    config,
    options.spawnAdapter,
    options.sessionRegistry ?? mcpSearchSessionRegistry
  );

  try {
    await session.start();
    await session.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "ai-desktop-pet",
        version: "0.0.0"
      }
    });
    session.notify("notifications/initialized", {});

    const tools = await session.request("tools/list", {});
    const toolSummaries = readToolSummaries(tools);
    const resolvedTool = findMcpSearchToolName(toolSummaries, config.toolName);
    const toolFound = Boolean(resolvedTool);

    return {
      ...baseResult,
      status: toolFound ? "tool_available" : "tool_missing",
      toolFound,
      toolCount: toolSummaries.length,
      ...(resolvedTool ? { toolName: resolvedTool } : {})
    };
  } catch (error: unknown) {
    const errorType = error instanceof Error ? error.name : "mcp_search_failed";
    if (errorType === "mcp_process_not_allowed") {
      const { commandName: _commandName, ...safeBaseResult } = baseResult;
      return {
        ...safeBaseResult,
        status: "failed"
      };
    }
    return {
      ...baseResult,
      status: errorType === "mcp_search_timeout"
        ? "timeout"
        : errorType === "mcp_search_spawn_failed"
          ? "spawn_failed"
          : "failed"
    };
  } finally {
    await session.close();
  }
}

function createMcpJsonRpcSession(
  config: McpSearchClientConfig,
  spawnAdapter: McpSpawnAdapter = DEFAULT_MCP_SPAWN_ADAPTER,
  sessionRegistry: McpSearchSessionRegistry = mcpSearchSessionRegistry
): {
  start(): Promise<void>;
  request(method: string, params: unknown): Promise<unknown>;
  notify(method: string, params: unknown): void;
  close(): Promise<void>;
} {
  let child: ChildProcessWithoutNullStreams | null = null;
  let childExit: Promise<void> | null = null;
  let closePromise: Promise<void> | null = null;
  let closed = false;
  let nextId = 1;
  let stderrBytes = 0;
  const pending = new Map<number, PendingRequest>();
  const timeoutMs = normalizeTimeoutMs(config.timeoutMs);

  function rejectAll(error: Error): void {
    for (const request of pending.values()) {
      request.reject(error);
    }
    pending.clear();
  }

  const unregister = sessionRegistry.register(close);

  function close(): Promise<void> {
    if (closePromise) {
      return closePromise;
    }

    closed = true;
    rejectAll(createMcpSearchError("mcp_search_closed"));
    const process = child;
    child = null;
    closePromise = (async () => {
      if (process && process.exitCode === null && process.signalCode === null) {
        try {
          process.kill();
        } catch {
          // Escalation below still gets a chance to terminate the process tree.
        }
        if (!await settlesWithin(childExit, MCP_CLOSE_GRACE_MS)) {
          try {
            const termination = spawnAdapter.terminateProcessTree
              ? spawnAdapter.terminateProcessTree(process)
              : process.kill("SIGKILL");
            void Promise.resolve(termination).catch(() => undefined);
          } catch {
            // Closing is bounded even when the platform termination API fails.
          }
          await settlesWithin(childExit, MCP_CLOSE_FORCE_MS);
        }
        releaseChildProcess(process);
      }
    })().finally(unregister);
    return closePromise;
  }

  return {
    start() {
      if (closed) {
        return Promise.reject(createMcpSearchError("mcp_search_closed"));
      }
      return new Promise((resolve, reject) => {
        let process: ChildProcessWithoutNullStreams;
        try {
          process = spawnAdapter.spawn(config);
        } catch (error: unknown) {
          reject(error instanceof Error ? error : createMcpProcessNotAllowedError());
          return;
        }
        child = process;
        childExit = new Promise<void>((resolveExit) => {
          process.once("exit", () => resolveExit());
          process.once("error", () => resolveExit());
        });

        const lineReader = createInterface({ input: process.stdout });
        lineReader.on("line", (line) => {
          handleJsonRpcLine(line, pending);
        });

        process.stderr.on("data", (chunk: Buffer) => {
          stderrBytes = Math.min(stderrBytes + chunk.length, MAX_STDERR_BYTES);
        });

        process.once("spawn", () => {
          resolve();
        });
        process.once("error", () => {
          reject(createMcpSearchError("mcp_search_spawn_failed"));
        });
        process.once("exit", (code) => {
          if (pending.size > 0) {
            rejectAll(createMcpSearchError(code === 0 ? "mcp_search_closed" : "mcp_search_failed"));
          }
        });
      });
    },
    request(method, params) {
      if (closed) {
        return Promise.reject(createMcpSearchError("mcp_search_closed"));
      }
      if (!child) {
        return Promise.reject(createMcpSearchError("mcp_search_not_started"));
      }
      const currentChild = child;

      const id = nextId;
      nextId += 1;

      const message = {
        jsonrpc: "2.0",
        id,
        method,
        params
      };

      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          pending.delete(id);
          reject(createMcpSearchError("mcp_search_timeout"));
          try {
            currentChild.kill();
          } catch {
            // The bounded session close path will perform the final escalation.
          }
        }, timeoutMs);

        pending.set(id, {
          resolve(value) {
            clearTimeout(timeoutId);
            resolve(value);
          },
          reject(error) {
            clearTimeout(timeoutId);
            reject(error);
          }
        });

        currentChild.stdin.write(`${JSON.stringify(message)}\n`, "utf8", (error) => {
          if (!error) {
            return;
          }
          pending.delete(id);
          clearTimeout(timeoutId);
          reject(createMcpSearchError("mcp_search_write_failed"));
        });
      });
    },
    notify(method, params) {
      child?.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`, "utf8");
    },
    close() {
      if (stderrBytes > MAX_STDERR_BYTES) {
        stderrBytes = MAX_STDERR_BYTES;
      }
      return close();
    }
  };
}

function settlesWithin(promise: Promise<unknown> | null, timeoutMs: number): Promise<boolean> {
  if (!promise) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => resolve(false), timeoutMs);
    promise.then(
      () => {
        clearTimeout(timeoutId);
        resolve(true);
      },
      () => {
        clearTimeout(timeoutId);
        resolve(true);
      }
    );
  });
}

async function settleWithin(promise: Promise<unknown>, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(resolve, timeoutMs);
    promise.then(
      () => {
        clearTimeout(timeoutId);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

function releaseChildProcess(process: ChildProcessWithoutNullStreams): void {
  for (const stream of [process.stdin, process.stdout, process.stderr]) {
    try {
      stream.destroy();
    } catch {
      // Best-effort handle cleanup must not make shutdown unbounded.
    }
  }
  try {
    process.unref();
  } catch {
    // Test adapters and partially spawned children may not expose a live handle.
  }
}

function handleJsonRpcLine(line: string, pending: Map<number, PendingRequest>): void {
  const trimmed = line.trim();

  if (!trimmed) {
    return;
  }

  let message: JsonRpcMessage;
  try {
    message = JSON.parse(trimmed) as JsonRpcMessage;
  } catch {
    return;
  }

  if (typeof message.id !== "number") {
    return;
  }

  const request = pending.get(message.id);
  if (!request) {
    return;
  }

  pending.delete(message.id);

  if (message.error) {
    request.reject(createMcpSearchError("mcp_search_tool_failed"));
    return;
  }

  request.resolve(message.result);
}

function resolveMcpSearchToolName(value: unknown, requestedToolName: string): string {
  const tools = readToolSummaries(value);
  const resolvedToolName = findMcpSearchToolName(tools, requestedToolName);

  if (!resolvedToolName) {
    throw createMcpSearchError("mcp_search_tool_missing");
  }

  return resolvedToolName;
}

function findMcpSearchToolName(tools: Array<{ name: string }>, requestedToolName: string): string | null {
  if (tools.some((tool) => tool.name === requestedToolName)) {
    return requestedToolName;
  }

  if (!isSearchToolAlias(requestedToolName)) {
    return null;
  }

  const aliases = ["brave_web_search", "web_search", "search"];
  return aliases.find((alias) => tools.some((tool) => tool.name === alias)) ?? null;
}

function isSearchToolAlias(value: string): boolean {
  return ["brave_web_search", "web_search", "search"].includes(value);
}

function readToolSummaries(value: unknown): Array<{ name: string }> {
  const tools = (value as { tools?: Array<{ name?: unknown }> } | null)?.tools;

  if (!Array.isArray(tools)) {
    return [];
  }

  return tools
    .map((tool) => typeof tool.name === "string" ? { name: tool.name } : null)
    .filter((tool): tool is { name: string } => tool !== null);
}

export function parseMcpToolResults(
  value: unknown,
  maxResults: number,
  options: ParseMcpToolResultsOptions = {}
): WebSearchResult[] {
  if (isMcpToolErrorResult(value)) {
    return [];
  }
  const textParts = readMcpTextParts(value);
  const structuredResults = readStructuredResults(value);
  const parsedJsonPayloads = textParts.map(parseResultJsonPayload);
  const parsedFromJson = parsedJsonPayloads.flatMap((payload) => payload.results);
  const hasRecognizedJsonResults = parsedJsonPayloads.some((payload) => payload.recognized);
  const candidates = [...structuredResults, ...parsedFromJson];
  const fallbackCandidates = candidates.length > 0
    ? candidates
    : hasRecognizedJsonResults
      ? []
    : textParts.map((text) => ({ title: "搜索结果", snippet: text }));
  const seenResults = new Set<string>();

  return fallbackCandidates
    .map((candidate) => sanitizeSearchResult(candidate, options))
    .filter((result): result is WebSearchResult => result !== null)
    .filter((result) => {
      const key = JSON.stringify([result.title, result.snippet, result.url ?? "", result.date ?? ""]);
      if (seenResults.has(key)) {
        return false;
      }
      seenResults.add(key);
      return true;
    })
    .slice(0, maxResults);
}

function readStructuredResults(value: unknown): Array<Record<string, unknown>> {
  const results = (value as { structuredContent?: { results?: unknown } } | null)?.structuredContent?.results;

  if (!Array.isArray(results)) {
    return [];
  }

  return results.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
}

function readMcpTextParts(value: unknown): string[] {
  const content = (value as { content?: Array<{ type?: unknown; text?: unknown }> } | null)?.content;

  if (!Array.isArray(content)) {
    return [];
  }

  return content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => String(item.text).trim())
    .filter((text) => text.length > 0);
}

function parseResultJsonPayload(text: string): { recognized: boolean; results: Array<Record<string, unknown>> } {
  if (!text.trim()) {
    return { recognized: false, results: [] };
  }

  try {
    const parsed = JSON.parse(text) as unknown;

    if (Array.isArray(parsed)) {
      return {
        recognized: true,
        results: parsed.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      };
    }

    const results = (parsed as { results?: unknown } | null)?.results;
    if (Array.isArray(results)) {
      return {
        recognized: true,
        results: results.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      };
    }

    const dataResults = (parsed as { data?: { results?: unknown } } | null)?.data?.results;
    if (Array.isArray(dataResults)) {
      return {
        recognized: true,
        results: dataResults.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      };
    }

    return { recognized: false, results: [] };
  } catch {
    return { recognized: false, results: [] };
  }
}

function sanitizeSearchResult(
  value: Record<string, unknown>,
  options: ParseMcpToolResultsOptions
): WebSearchResult | null {
  const safeTitle = sanitizeText(value.title, MAX_RESULT_TITLE_LENGTH);
  const title = safeTitle || "搜索结果";
  const providedSnippet = sanitizeText(
    value.snippet ?? value.description ?? value.content ?? value.text,
    MAX_RESULT_SNIPPET_LENGTH
  );
  const snippet = providedSnippet || (options.allowTitleSnippetFallback
    ? safeTitle || "百度搜索结果（页面未提供摘要）"
    : "");
  const url = sanitizeUrl(value.url ?? value.link, options);
  const date = sanitizeText(value.date ?? value.publishedAt, MAX_RESULT_DATE_LENGTH);

  if (!snippet) {
    return null;
  }

  return {
    title,
    snippet,
    ...(url ? { url } : {}),
    ...(date ? { date } : {})
  };
}

function sanitizeText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, maxLength).trim();
}

function sanitizeUrl(value: unknown, options: ParseMcpToolResultsOptions): string | null {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    const baiduRedirectToken = options.trustedBaiduRedirects &&
      url.protocol === "https:" &&
      url.hostname === "www.baidu.com" &&
      url.port === "" &&
      url.pathname === "/link"
      ? url.searchParams.get("url")
      : null;
    url.search = "";
    url.hash = "";
    if (baiduRedirectToken && baiduRedirectToken.length <= 200 && !/[\u0000-\u001f\u007f]/.test(baiduRedirectToken)) {
      url.searchParams.set("url", baiduRedirectToken);
    }
    return url.toString().slice(0, MAX_RESULT_URL_LENGTH);
  } catch {
    return null;
  }
}

function isMcpToolErrorResult(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && (value as { isError?: unknown }).isError === true);
}

function readMcpToolErrorCode(value: unknown): string | null {
  if (!isMcpToolErrorResult(value)) {
    return null;
  }

  const structuredContent = (value as { structuredContent?: unknown }).structuredContent;
  if (!structuredContent || typeof structuredContent !== "object") {
    return null;
  }
  const error = (structuredContent as { error?: unknown }).error;
  if (!error || typeof error !== "object") {
    return null;
  }

  return (error as { code?: unknown }).code === BAIDU_SEARCH_VERIFICATION_REQUIRED_ERROR
    ? BAIDU_SEARCH_VERIFICATION_REQUIRED_ERROR
    : null;
}

export function createSafeMcpChildEnv(
  config: McpSearchClientConfig,
  options: { electronRuntime?: boolean } = {}
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "ComSpec"]) {
    const value = process.env[key];
    if (value) {
      env[key] = value;
    }
  }

  for (const key of ["TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"]) {
    env[key] = "";
  }

  if (isBundledBaiduSearchConfig(config) && (options.electronRuntime ?? Boolean(process.versions.electron))) {
    env.ELECTRON_RUN_AS_NODE = "1";
  }

  if (isOpenWebSearchMcpConfig(config)) {
    env.MODE = "stdio";
    env.DEFAULT_SEARCH_ENGINE = isPinnedOpenWebSearchBaiduPreset(config) ? "baidu" : "sogou";
    env.ALLOWED_SEARCH_ENGINES = isPinnedOpenWebSearchBaiduPreset(config) ? "baidu" : "sogou,baidu,bing";
    env.SEARCH_MODE = "auto";
  }

  if (isManagedSearchMcpConfig(config)) {
    const runtimeRoot = join(resolve(process.cwd(), ".tmp"), getManagedSearchRuntimeDir(config));
    const npmCache = join(runtimeRoot, "npm-cache");
    const tempDir = join(runtimeRoot, "temp");
    const homeDir = join(runtimeRoot, "home");
    const appDataDir = join(runtimeRoot, "appdata");
    const localAppDataDir = join(runtimeRoot, "localappdata");
    mkdirSync(npmCache, { recursive: true });
    mkdirSync(tempDir, { recursive: true });
    mkdirSync(homeDir, { recursive: true });
    mkdirSync(appDataDir, { recursive: true });
    mkdirSync(localAppDataDir, { recursive: true });
    env.NPM_CONFIG_CACHE = npmCache;
    env.TEMP = tempDir;
    env.TMP = tempDir;
    env.USERPROFILE = homeDir;
    env.HOME = homeDir;
    env.APPDATA = appDataDir;
    env.LOCALAPPDATA = localAppDataDir;
  }

  const braveApiKey = process.env.BRAVE_API_KEY;
  if (braveApiKey && isBraveSearchMcpConfig(config)) {
    env.BRAVE_API_KEY = braveApiKey;
  }
  return env;
}

export function createMcpSpawnConfig(config: McpSearchClientConfig): McpSpawnConfig {
  return resolveMcpProcessCapability(config, {
    bundledExecutable: process.execPath,
    bundledServerPath: join(__dirname, "baidu-search-mcp-server.js")
  });
}

function isBraveSearchMcpConfig(config: McpSearchClientConfig): boolean {
  return config.args.some(isBraveSearchPackageArg);
}

function isOpenWebSearchMcpConfig(config: McpSearchClientConfig): boolean {
  return config.args.some(isOpenWebSearchPackageArg);
}

function isGoogleSearchMcpConfig(config: McpSearchClientConfig): boolean {
  return config.args.some(isGoogleSearchPackageArg);
}

function isBundledBaiduSearchConfig(config: McpSearchClientConfig): boolean {
  return config.command === BUNDLED_BAIDU_SEARCH_COMMAND && config.args.length === 0;
}

function isPinnedOpenWebSearchBaiduPreset(config: McpSearchClientConfig): boolean {
  return config.command === "npx.cmd" &&
    config.args.length === 2 &&
    config.args[0] === "-y" &&
    config.args[1] === "open-websearch@2.1.11" &&
    config.toolName === "search" &&
    config.timeoutMs === 60_000 &&
    config.maxResults === 3;
}

function isBraveSearchPackageArg(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return [
    "@brave/brave-search-mcp-server",
    "@modelcontextprotocol/server-brave-search"
  ].some((packageName) => normalized === packageName || normalized.startsWith(`${packageName}@`));
}

function isOpenWebSearchPackageArg(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "open-websearch" || normalized.startsWith("open-websearch@");
}

function isGoogleSearchPackageArg(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "@mcp-server/google-search-mcp" || normalized.startsWith("@mcp-server/google-search-mcp@");
}

function isManagedSearchMcpConfig(config: McpSearchClientConfig): boolean {
  return isOpenWebSearchMcpConfig(config) || isGoogleSearchMcpConfig(config);
}

function getManagedSearchRuntimeDir(config: McpSearchClientConfig): string {
  return isGoogleSearchMcpConfig(config)
    ? "mcp-google-search-runtime"
    : "mcp-open-websearch-runtime";
}

function normalizeTimeoutMs(value: number): number {
  return Number.isSafeInteger(value) && value >= 1_000 && value <= 60_000 ? value : 10_000;
}

function createMcpSearchError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

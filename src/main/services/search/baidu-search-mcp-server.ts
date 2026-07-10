import { load } from "cheerio";
import { Agent, get } from "node:https";
import { createInterface } from "node:readline";
import { BAIDU_SEARCH_VERIFICATION_REQUIRED_ERROR } from "../../../shared/web-search";

const BAIDU_SEARCH_URL = "https://www.baidu.com/s";
const BAIDU_WAPPASS_HOSTNAME = "wappass.baidu.com";
const MAX_RESULT_TITLE_LENGTH = 96;
const MAX_RESULT_SNIPPET_LENGTH = 360;
const MAX_RESULT_URL_LENGTH = 240;
const MAX_RESULT_DATE_LENGTH = 40;
const DEFAULT_SEARCH_LIMIT = 3;
const MAX_QUERY_LENGTH = 200;
const MCP_PROTOCOL_VERSION = "2025-06-18";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  "Accept-Language": "zh-CN,zh;q=0.9",
  Accept: "text/html,application/xhtml+xml"
} as const;

const SEARCH_TOOL = {
  name: "search",
  description: "Search public web results with Baidu.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", minLength: 1, maxLength: 200 },
      limit: { type: "integer", minimum: 1, maximum: 5 }
    },
    required: ["query"],
    additionalProperties: false
  }
} as const;

export type BaiduSearchResult = {
  title?: string;
  snippet?: string;
  url?: string;
  date?: string;
};

export type BaiduSearchArguments = {
  query: string;
  limit: number;
};

export type BaiduSearchMcpSessionState = {
  initialized: boolean;
};

type JsonRpcId = number | string | null;

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
};

type BaiduSearchFunction = (input: BaiduSearchArguments) => Promise<BaiduSearchResult[]>;

export function createBaiduSearchMcpSessionState(): BaiduSearchMcpSessionState {
  return { initialized: false };
}

export function createBaiduSearchRequestDetails(query: string): {
  url: URL;
  headers: typeof REQUEST_HEADERS;
  timeoutMs: number;
  maxRedirects: number;
  maxResponseBytes: number;
  agent: Agent;
} {
  const url = new URL(BAIDU_SEARCH_URL);
  url.searchParams.set("wd", query);
  url.searchParams.set("pn", "0");
  url.searchParams.set("ie", "utf-8");

  return {
    url,
    headers: REQUEST_HEADERS,
    timeoutMs: REQUEST_TIMEOUT_MS,
    maxRedirects: MAX_REDIRECTS,
    maxResponseBytes: MAX_RESPONSE_BYTES,
    agent: new Agent({
      minVersion: "TLSv1.2",
      maxVersion: "TLSv1.2",
      rejectUnauthorized: true
    })
  };
}

export function isAllowedBaiduRedirectUrl(url: URL): boolean {
  return url.protocol === "https:" && url.origin === new URL(BAIDU_SEARCH_URL).origin;
}

export function resolveBaiduSearchRedirectUrl(currentUrl: URL, location: string): URL {
  let redirectUrl: URL;
  try {
    redirectUrl = new URL(location, currentUrl);
  } catch {
    throw createBaiduSearchError("baidu_search_redirect_failed");
  }

  if (redirectUrl.hostname === BAIDU_WAPPASS_HOSTNAME) {
    throw createBaiduSearchError(BAIDU_SEARCH_VERIFICATION_REQUIRED_ERROR);
  }
  if (!isAllowedBaiduRedirectUrl(redirectUrl)) {
    throw createBaiduSearchError("baidu_search_redirect_failed");
  }

  return redirectUrl;
}

export async function handleBaiduSearchMcpLine(
  line: string,
  search: BaiduSearchFunction = performBaiduSearch,
  state: BaiduSearchMcpSessionState = createBaiduSearchMcpSessionState()
): Promise<JsonRpcResponse | null> {
  let message: unknown;
  try {
    message = JSON.parse(line) as unknown;
  } catch {
    return createJsonRpcError(null, -32700, "Parse error");
  }

  if (!isJsonRpcRequest(message)) {
    return createJsonRpcError(readJsonRpcId(message), -32600, "Invalid Request");
  }

  const hasId = Object.prototype.hasOwnProperty.call(message, "id");
  if (!hasId) {
    return null;
  }
  const id = message.id as JsonRpcId;

  if (message.method === "initialize") {
    const params = message.params as { protocolVersion?: unknown } | undefined;
    if (!params || params.protocolVersion !== MCP_PROTOCOL_VERSION) {
      return createJsonRpcError(id, -32602, "Unsupported protocol version");
    }
    state.initialized = true;
    return createJsonRpcResult(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "ai-desktop-pet-baidu-search", version: "0.0.0" }
    });
  }

  if ((message.method === "tools/list" || message.method === "tools/call") && !state.initialized) {
    return createJsonRpcError(id, -32000, "Server not initialized");
  }

  if (message.method === "tools/list") {
    return createJsonRpcResult(id, { tools: [SEARCH_TOOL] });
  }

  if (message.method !== "tools/call") {
    return createJsonRpcError(id, -32601, "Method not found");
  }

  const params = message.params as { name?: unknown; arguments?: unknown } | undefined;
  if (!params || typeof params !== "object" || params.name !== SEARCH_TOOL.name) {
    return createJsonRpcError(id, -32602, "Invalid params");
  }

  let input: BaiduSearchArguments;
  try {
    input = validateBaiduSearchArguments(params.arguments);
  } catch {
    return createJsonRpcError(id, -32602, "Invalid params");
  }

  try {
    const results = await search(input);
    return createJsonRpcResult(id, {
      structuredContent: { results },
      content: [{ type: "text", text: JSON.stringify({ results }) }]
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === BAIDU_SEARCH_VERIFICATION_REQUIRED_ERROR) {
      return createJsonRpcResult(id, {
        isError: true,
        structuredContent: {
          error: { code: BAIDU_SEARCH_VERIFICATION_REQUIRED_ERROR }
        },
        content: [{ type: "text", text: "Baidu search verification required" }]
      });
    }
    return createJsonRpcResult(id, {
      isError: true,
      content: [{ type: "text", text: "Baidu search failed" }]
    });
  }
}

export async function runBaiduSearchMcpServer(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout
): Promise<void> {
  const lineReader = createInterface({ input });
  const state = createBaiduSearchMcpSessionState();
  for await (const line of lineReader) {
    const response = await handleBaiduSearchMcpLine(line, performBaiduSearch, state);
    if (response) {
      output.write(`${JSON.stringify(response)}\n`);
    }
  }
}

export function validateBaiduSearchArguments(value: unknown): BaiduSearchArguments {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw createBaiduSearchError("invalid_params");
  }

  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== "query" && key !== "limit")) {
    throw createBaiduSearchError("invalid_params");
  }

  if (typeof input.query !== "string" || [...input.query].length > MAX_QUERY_LENGTH) {
    throw createBaiduSearchError("invalid_params");
  }

  const query = input.query.trim();
  if (!query) {
    throw createBaiduSearchError("invalid_params");
  }

  const limit = input.limit === undefined ? DEFAULT_SEARCH_LIMIT : input.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 5) {
    throw createBaiduSearchError("invalid_params");
  }

  return { query, limit };
}

export function parseBaiduSearchHtml(html: string, limit: number): BaiduSearchResult[] {
  if (isBaiduVerificationHtml(html)) {
    throw createBaiduSearchError(BAIDU_SEARCH_VERIFICATION_REQUIRED_ERROR);
  }

  const $ = load(html);
  const results: BaiduSearchResult[] = [];

  $(".result, .c-container").each((_index, element) => {
    if (results.length >= limit) {
      return false;
    }

    const container = $(element);
    const titleLink = container.find("h3 a").first();
    const title = normalizeText(titleLink.text(), MAX_RESULT_TITLE_LENGTH);
    const snippetNode = container
      .find(".c-abstract, [class*='c-abstract'], .content-right_8Zs40, .c-span-last, .c-font-normal, [class*='result-content'], [class*='content-right']")
      .first()
      .clone();
    snippetNode.find("script, style, noscript").remove();
    const snippet = normalizeText(snippetNode.text(), MAX_RESULT_SNIPPET_LENGTH);
    const url = normalizeResultUrl(
      titleLink.attr("data-landurl") ?? container.attr("mu") ?? titleLink.attr("href")
    );
    const date = normalizeText(
      container.find(".c-color-gray2, .c-gap-right-small, [class*='time']").first().text(),
      MAX_RESULT_DATE_LENGTH
    );

    if (!title && !snippet && !url) {
      return;
    }

    results.push({
      ...(title ? { title } : {}),
      ...(snippet ? { snippet } : {}),
      ...(url ? { url } : {}),
      ...(date ? { date } : {})
    });
  });

  if (results.length === 0) {
    throw createBaiduSearchError("baidu_search_parse_failed");
  }

  return results;
}

export function isBaiduVerificationHtml(html: string): boolean {
  const $ = load(html);
  const hasWappassNavigation = $("[action], [src], meta[content]").toArray().some((element) => {
    const node = $(element);
    return [node.attr("action"), node.attr("src"), node.attr("content")].some((value) =>
      typeof value === "string" && /(?:https?:)?\/\/wappass\.baidu\.com(?:[/?#]|$)/i.test(value)
    );
  });
  if (hasWappassNavigation || /(?:https?:)?\/\/wappass\.baidu\.com(?:[/?#]|$)/i.test($("script").text())) {
    return true;
  }

  const pageText = $("title, body").text().replace(/\s+/g, " ").trim();
  return $(".result, .c-container").length === 0 &&
    /百度安全验证|请输入验证码|请完成验证|完成验证后/.test(pageText);
}

function normalizeText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength).trim();
}

function normalizeResultUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value, BAIDU_SEARCH_URL);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    if (url.hostname === "www.baidu.com" && url.pathname === "/link") {
      url.protocol = "https:";
    }
    return url.toString().slice(0, MAX_RESULT_URL_LENGTH);
  } catch {
    return null;
  }
}

function createBaiduSearchError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

function isJsonRpcRequest(value: unknown): value is Record<string, unknown> & {
  jsonrpc: "2.0";
  method: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const message = value as Record<string, unknown>;
  return message.jsonrpc === "2.0" &&
    typeof message.method === "string" &&
    (!Object.prototype.hasOwnProperty.call(message, "id") || isJsonRpcId(message.id));
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return value === null || typeof value === "string" || typeof value === "number" && Number.isFinite(value);
}

function readJsonRpcId(value: unknown): JsonRpcId {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const id = (value as Record<string, unknown>).id;
  return isJsonRpcId(id) ? id : null;
}

function createJsonRpcResult(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function createJsonRpcError(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function performBaiduSearch(input: BaiduSearchArguments): Promise<BaiduSearchResult[]> {
  const request = createBaiduSearchRequestDetails(input.query);
  const html = await requestBaiduSearchPage(request, request.url, 0);
  return parseBaiduSearchHtml(html, input.limit);
}

function requestBaiduSearchPage(
  requestDetails: ReturnType<typeof createBaiduSearchRequestDetails>,
  url: URL,
  redirectCount: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finishWithError = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      reject(error);
    };
    const finishWithValue = (value: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      resolve(value);
    };

    const httpRequest = get(url, {
      agent: requestDetails.agent,
      headers: requestDetails.headers
    }, (response) => {
      const statusCode = response.statusCode ?? 0;
      if (statusCode >= 300 && statusCode < 400) {
        const location = response.headers.location;
        response.resume();
        if (!location || redirectCount >= requestDetails.maxRedirects) {
          finishWithError(createBaiduSearchError("baidu_search_redirect_failed"));
          return;
        }

        let redirectUrl: URL;
        try {
          redirectUrl = resolveBaiduSearchRedirectUrl(url, location);
        } catch (error: unknown) {
          finishWithError(error instanceof Error ? error : createBaiduSearchError("baidu_search_redirect_failed"));
          return;
        }

        clearTimeout(timeoutId);
        settled = true;
        requestBaiduSearchPage(requestDetails, redirectUrl, redirectCount + 1).then(resolve, reject);
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        finishWithError(createBaiduSearchError("baidu_search_http_failed"));
        return;
      }

      const chunks: Buffer[] = [];
      let byteLength = 0;
      response.on("data", (chunk: Buffer) => {
        byteLength += chunk.length;
        if (byteLength > requestDetails.maxResponseBytes) {
          response.destroy();
          finishWithError(createBaiduSearchError("baidu_search_response_too_large"));
          return;
        }
        chunks.push(chunk);
      });
      response.once("aborted", () => {
        finishWithError(createBaiduSearchError("baidu_search_network_failed"));
      });
      response.once("error", () => {
        finishWithError(createBaiduSearchError("baidu_search_network_failed"));
      });
      response.once("end", () => {
        finishWithValue(Buffer.concat(chunks).toString("utf8"));
      });
    });

    const timeoutId = setTimeout(() => {
      httpRequest.destroy(createBaiduSearchError("baidu_search_timeout"));
    }, requestDetails.timeoutMs);
    httpRequest.once("error", () => {
      finishWithError(createBaiduSearchError("baidu_search_network_failed"));
    });
  });
}

if (require.main === module) {
  void runBaiduSearchMcpServer().catch(() => {
    process.exitCode = 1;
  });
}

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  createBaiduSearchRequestDetails,
  createBaiduSearchMcpSessionState,
  handleBaiduSearchMcpLine,
  isAllowedBaiduRedirectUrl,
  isBaiduVerificationHtml,
  parseBaiduSearchHtml,
  resolveBaiduSearchRedirectUrl,
  validateBaiduSearchArguments
} = require("../dist/main/services/search/baidu-search-mcp-server.js") as typeof import("../src/main/services/search/baidu-search-mcp-server");
const {
  parseMcpToolResults
} = require("../dist/main/services/search/mcp-search-client.js") as typeof import("../src/main/services/search/mcp-search-client");

test("Baidu fixture parser reads public result containers without executing page scripts", () => {
  const html = `
    <!doctype html>
    <html>
      <body>
        <div id="content_left">
          <div class="result c-container">
            <h3><a href="/link?url=first">第一条结果</a></h3>
            <div class="c-abstract">第一条摘要 <script>throw new Error("must not run")</script></div>
            <span class="c-color-gray2">2026-07-10</span>
          </div>
          <div class="result">
            <h3><a href="https://example.com/article?tracking=1#section">Second result</a></h3>
            <div class="content-right_8Zs40">Second result summary</div>
          </div>
        </div>
      </body>
    </html>
  `;

  assert.deepEqual(parseBaiduSearchHtml(html, 5), [
    {
      title: "第一条结果",
      snippet: "第一条摘要",
      url: "https://www.baidu.com/link?url=first",
      date: "2026-07-10"
    },
    {
      title: "Second result",
      snippet: "Second result summary",
      url: "https://example.com/article?tracking=1#section"
    }
  ]);
});

test("Baidu DOM results keep title-only entries and safe landing URLs end to end", async () => {
  const html = `
    <div id="content_left">
      <div class="result c-container">
        <h3 class="t"><a href="http://www.baidu.com/link?url=opaqueToken123&wd=private#fragment">只有标题的结果</a></h3>
      </div>
      <div class="result c-container" mu="https://example.com/from-mu?tracking=1#section">
        <h3 class="t"><a href="https://www.baidu.com/link?url=ignored">MU 落地地址</a></h3>
        <div class="c-abstract">公开摘要</div>
      </div>
      <div class="result c-container">
        <h3 class="t"><a href="https://www.baidu.com/link?url=ignored2" data-landurl="https://example.org/from-data?tracking=2#section">data-landurl 落地地址</a></h3>
        <div class="c-abstract">另一条公开摘要</div>
      </div>
    </div>
  `;
  const parsedResults = parseBaiduSearchHtml(html, 5);
  assert.deepEqual(parsedResults.map((result) => result.url), [
    "https://www.baidu.com/link?url=opaqueToken123&wd=private#fragment",
    "https://example.com/from-mu?tracking=1#section",
    "https://example.org/from-data?tracking=2#section"
  ]);

  const state = createBaiduSearchMcpSessionState();
  await handleBaiduSearchMcpLine(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18" }
  }), undefined, state);
  const call = await handleBaiduSearchMcpLine(JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "search", arguments: { query: "fixture", limit: 3 } }
  }), async () => parsedResults, state);
  const normalized = parseMcpToolResults(
    (call as { result?: unknown }).result,
    5,
    { trustedBaiduRedirects: true, allowTitleSnippetFallback: true }
  );

  assert.deepEqual(normalized, [{
    title: "只有标题的结果",
    snippet: "只有标题的结果",
    url: "https://www.baidu.com/link?url=opaqueToken123"
  }, {
    title: "MU 落地地址",
    snippet: "公开摘要",
    url: "https://example.com/from-mu"
  }, {
    title: "data-landurl 落地地址",
    snippet: "另一条公开摘要",
    url: "https://example.org/from-data"
  }]);
});

test("Baidu search schema accepts only a bounded non-empty query and integer limit", () => {
  assert.deepEqual(validateBaiduSearchArguments({ query: "  Electron 42  ", limit: 2 }), {
    query: "Electron 42",
    limit: 2
  });
  assert.deepEqual(validateBaiduSearchArguments({ query: "默认条数" }), {
    query: "默认条数",
    limit: 3
  });

  for (const invalidArguments of [
    null,
    { query: "" },
    { query: "   " },
    { query: "x".repeat(201) },
    { query: "test", limit: 0 },
    { query: "test", limit: 6 },
    { query: "test", limit: 1.5 },
    { query: "test", limit: "2" },
    { query: "test", extra: true }
  ]) {
    assert.throws(
      () => validateBaiduSearchArguments(invalidArguments),
      (error: unknown) => error instanceof Error && error.name === "invalid_params"
    );
  }
});

test("Baidu request policy is HTTPS-only, bounded, and does not add unstable parameters", () => {
  const request = createBaiduSearchRequestDetails("Electron 最新版本");

  assert.equal(request.url.origin, "https://www.baidu.com");
  assert.equal(request.url.pathname, "/s");
  assert.deepEqual([...request.url.searchParams.keys()], ["wd", "pn", "ie"]);
  assert.equal(request.url.searchParams.get("wd"), "Electron 最新版本");
  assert.equal(request.url.searchParams.get("pn"), "0");
  assert.equal(request.url.searchParams.get("ie"), "utf-8");
  assert.equal(request.timeoutMs, 15_000);
  assert.equal(request.maxResponseBytes, 2 * 1024 * 1024);
  assert.equal(request.maxRedirects, 3);
  assert.match(request.headers["User-Agent"], /^Mozilla\/5\.0 .*Chrome\//);
  assert.equal(request.headers["Accept-Language"], "zh-CN,zh;q=0.9");
  assert.equal(request.agent.options.minVersion, "TLSv1.2");
  assert.equal(request.agent.options.maxVersion, "TLSv1.2");
  assert.equal(request.agent.options.rejectUnauthorized, true);

  assert.equal(isAllowedBaiduRedirectUrl(new URL("https://www.baidu.com/s?wd=test")), true);
  assert.equal(isAllowedBaiduRedirectUrl(new URL("https://m.baidu.com/s?wd=test")), false);
  assert.equal(isAllowedBaiduRedirectUrl(new URL("https://baidu.com/s?wd=test")), false);
  assert.equal(isAllowedBaiduRedirectUrl(new URL("http://www.baidu.com/s?wd=test")), false);
  assert.equal(isAllowedBaiduRedirectUrl(new URL("https://www.baidu.com.evil.test/s")), false);

  assert.throws(
    () => parseBaiduSearchHtml("<html><body><div>layout changed</div></body></html>", 3),
    (error: unknown) => error instanceof Error && error.name === "baidu_search_parse_failed"
  );
});

test("Baidu redirects stop at wappass verification and reject unrelated cross-origin targets", () => {
  const searchUrl = new URL("https://www.baidu.com/s?wd=private-query");

  assert.throws(
    () => resolveBaiduSearchRedirectUrl(
      searchUrl,
      "https://wappass.baidu.com/static/captcha/tuxing.html?token=private-token&u=https%3A%2F%2Fwww.baidu.com%2Fs"
    ),
    (error: unknown) => error instanceof Error && error.name === "baidu_search_verification_required"
  );
  assert.throws(
    () => resolveBaiduSearchRedirectUrl(searchUrl, "http://wappass.baidu.com/static/captcha/verify"),
    (error: unknown) => error instanceof Error && error.name === "baidu_search_verification_required"
  );
  assert.throws(
    () => resolveBaiduSearchRedirectUrl(searchUrl, "https://example.test/cross-origin?private=query"),
    (error: unknown) => error instanceof Error && error.name === "baidu_search_redirect_failed"
  );
  assert.equal(
    resolveBaiduSearchRedirectUrl(searchUrl, "/s?wd=public-fixture").toString(),
    "https://www.baidu.com/s?wd=public-fixture"
  );
});

test("Baidu 200 verification fixture is rejected before result parsing", () => {
  const verificationHtml = `
    <!doctype html>
    <html>
      <head>
        <title>百度安全验证</title>
        <meta http-equiv="refresh" content="0;url=https://wappass.baidu.com/static/captcha/tuxing.html?token=private-token">
      </head>
      <body><form action="https://wappass.baidu.com/static/captcha/verify">请完成验证</form></body>
    </html>
  `;

  assert.equal(isBaiduVerificationHtml(verificationHtml), true);
  assert.throws(
    () => parseBaiduSearchHtml(verificationHtml, 3),
    (error: unknown) => error instanceof Error && error.name === "baidu_search_verification_required"
  );
  assert.equal(isBaiduVerificationHtml(`
    <div class="result c-container">
      <h3><a href="https://example.test/result">正常 fixture</a></h3>
      <div class="c-abstract">公开摘要</div>
    </div>
  `), false);
});

test("Baidu bundle build contract is self-contained and included by electron-builder", () => {
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const builderConfig = require("../electron-builder.config.cjs") as { files?: string[] };

  assert.equal(packageJson.devDependencies?.esbuild, "0.28.1");
  assert.equal(packageJson.devDependencies?.cheerio, "1.2.0");
  assert.equal(packageJson.dependencies?.cheerio, undefined);
  assert.match(
    packageJson.scripts?.build ?? "",
    /^tsc -p tsconfig\.main\.json && node scripts\/build-bundled-baidu-mcp-server\.mjs && /
  );
  assert.equal(builderConfig.files?.includes("dist/**/*"), true);
  assert.equal(builderConfig.files?.some((entry) => entry.includes("node_modules/cheerio")), false);
  assert.equal(builderConfig.files?.includes("node_modules/**/*"), false);
});

test("Baidu MCP line protocol implements initialize, tools, calls, notifications, and stable errors", async () => {
  const state = createBaiduSearchMcpSessionState();
  assert.deepEqual(await handleBaiduSearchMcpLine(JSON.stringify({
    jsonrpc: "2.0",
    id: "before-init",
    method: "tools/list",
    params: {}
  }), undefined, state), {
    jsonrpc: "2.0",
    id: "before-init",
    error: { code: -32000, message: "Server not initialized" }
  });

  const invalidVersionState = createBaiduSearchMcpSessionState();
  assert.deepEqual(await handleBaiduSearchMcpLine(JSON.stringify({
    jsonrpc: "2.0",
    id: "bad-version",
    method: "initialize",
    params: { protocolVersion: "2024-11-05" }
  }), undefined, invalidVersionState), {
    jsonrpc: "2.0",
    id: "bad-version",
    error: { code: -32602, message: "Unsupported protocol version" }
  });

  const initialize = await handleBaiduSearchMcpLine(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18" }
  }), undefined, state);
  assert.deepEqual(initialize, {
    jsonrpc: "2.0",
    id: 1,
    result: {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "ai-desktop-pet-baidu-search", version: "0.0.0" }
    }
  });

  assert.equal(await handleBaiduSearchMcpLine(JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {}
  }), undefined, state), null);

  const tools = await handleBaiduSearchMcpLine(JSON.stringify({
    jsonrpc: "2.0",
    id: "tools",
    method: "tools/list",
    params: {}
  }), undefined, state);
  assert.deepEqual((tools as { result?: { tools?: unknown[] } }).result?.tools, [{
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
  }]);

  const fixtureResults = [{
    title: "Fixture result",
    snippet: "Fixture summary",
    url: "https://example.com/result",
    date: "2026-07-10"
  }];
  const calledQueries: unknown[] = [];
  const call = await handleBaiduSearchMcpLine(JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "search", arguments: { query: "fixture query", limit: 1 } }
  }), async (input) => {
    calledQueries.push(input);
    return fixtureResults;
  }, state);
  assert.deepEqual(calledQueries, [{ query: "fixture query", limit: 1 }]);
  assert.deepEqual((call as { result?: unknown }).result, {
    structuredContent: { results: fixtureResults },
    content: [{ type: "text", text: JSON.stringify({ results: fixtureResults }) }]
  });

  const invalidParams = await handleBaiduSearchMcpLine(JSON.stringify({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "search", arguments: { query: "" } }
  }), undefined, state);
  assert.deepEqual(invalidParams, {
    jsonrpc: "2.0",
    id: 3,
    error: { code: -32602, message: "Invalid params" }
  });

  const failedCall = await handleBaiduSearchMcpLine(JSON.stringify({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "search", arguments: { query: "private query", limit: 1 } }
  }), async () => {
    throw new Error("network failed for private query");
  }, state);
  assert.deepEqual(failedCall, {
    jsonrpc: "2.0",
    id: 4,
    result: {
      isError: true,
      content: [{ type: "text", text: "Baidu search failed" }]
    }
  });
  assert.doesNotMatch(JSON.stringify(failedCall), /private query|network failed/);

  const verificationBlockedCall = await handleBaiduSearchMcpLine(JSON.stringify({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "search", arguments: { query: "private verification query", limit: 1 } }
  }), async () => {
    const error = new Error("https://wappass.baidu.com/private?html=<private>");
    error.name = "baidu_search_verification_required";
    throw error;
  }, state);
  assert.deepEqual(verificationBlockedCall, {
    jsonrpc: "2.0",
    id: 5,
    result: {
      isError: true,
      structuredContent: {
        error: { code: "baidu_search_verification_required" }
      },
      content: [{ type: "text", text: "Baidu search verification required" }]
    }
  });
  assert.doesNotMatch(
    JSON.stringify(verificationBlockedCall),
    /private verification query|wappass\.baidu\.com|<private>|token=|https?:\/\//
  );

  assert.deepEqual(await handleBaiduSearchMcpLine("{", undefined, state), {
    jsonrpc: "2.0",
    id: null,
    error: { code: -32700, message: "Parse error" }
  });
});

const packagedAppPath = join(
  process.cwd(),
  ".tmp",
  "p2-20j-package-output",
  "win-unpacked",
  "AI Desktop Pet.exe"
);

test("packaged app.asar bundled Baidu server initializes and lists tools", {
  skip: !existsSync(packagedAppPath)
}, async () => {
  const serverPath = join(
    process.cwd(),
    ".tmp",
    "p2-20j-package-output",
    "win-unpacked",
    "resources",
    "app.asar",
    "dist",
    "main",
    "services",
    "search",
    "baidu-search-mcp-server.js"
  );
  const child = spawn(packagedAppPath, [serverPath], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: {
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
      ELECTRON_RUN_AS_NODE: "1",
      USERPROFILE: "",
      APPDATA: "",
      LOCALAPPDATA: "",
      HOME: "",
      TEMP: "",
      TMP: ""
    }
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  child.stdin.end([
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" }
    }),
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
  ].join("\n") + "\n");

  const timeout = setTimeout(() => child.kill(), 10_000);
  const [exitCode] = await once(child, "exit") as [number | null];
  clearTimeout(timeout);
  assert.equal(exitCode, 0, stderr);
  const responses = stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.equal(responses[0]?.result?.protocolVersion, "2025-06-18");
  assert.equal(responses[1]?.result?.tools?.[0]?.name, "search");
});

test("bundled Baidu MCP server is self-contained and speaks newline-delimited JSON-RPC over stdio", async (t) => {
  const serverPath = join(process.cwd(), "dist", "main", "services", "search", "baidu-search-mcp-server.js");
  const bundleSource = readFileSync(serverPath, "utf8");
  assert.doesNotMatch(bundleSource, /require\((?:"|')cheerio(?:"|')\)/);

  const isolatedDir = mkdtempSync(join(tmpdir(), "bundled-baidu-mcp-"));
  t.after(() => rmSync(isolatedDir, { recursive: true, force: true }));
  const isolatedServerPath = join(isolatedDir, "baidu-search-mcp-server.js");
  copyFileSync(serverPath, isolatedServerPath);
  const child = spawn(process.execPath, [isolatedServerPath], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdin.on("error", () => undefined);

  child.stdin.end([
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" }
    }),
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "search", arguments: { query: "" } }
    }),
    "{"
  ].join("\n") + "\n");

  const timeout = setTimeout(() => child.kill(), 5_000);
  const [exitCode] = await once(child, "exit") as [number | null];
  clearTimeout(timeout);

  assert.equal(exitCode, 0, stderr);
  const responses = stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  assert.deepEqual(responses.map((response) => response.id), [1, 2, 3, null]);
  assert.equal(responses[0]?.result?.serverInfo?.name, "ai-desktop-pet-baidu-search");
  assert.equal(responses[1]?.result?.tools?.[0]?.name, "search");
  assert.deepEqual(responses[2]?.error, { code: -32602, message: "Invalid params" });
  assert.deepEqual(responses[3]?.error, { code: -32700, message: "Parse error" });
});

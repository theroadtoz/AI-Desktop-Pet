import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import ts from "typescript";

import {
  CdpClient,
  CdpClientError,
  cleanupRealUiRun,
  createRealUiRunContext,
  startElectron,
  waitForChildExit
} from "./real-ui-harness.mjs";

type SocketListener = (event: any) => void;

class FakeSocket {
  static instance: FakeSocket;
  static nextInitialEvent: "open" | "close" | "error" | "none" = "open";
  static nextSendThrows = false;

  listeners = new Map<string, Set<SocketListener>>();
  sent: string[] = [];
  closeCalls = 0;

  constructor(_url: string) {
    FakeSocket.instance = this;
    const initialEvent = FakeSocket.nextInitialEvent;
    FakeSocket.nextInitialEvent = "open";
    if (initialEvent !== "none") {
      queueMicrotask(() => this.emit(initialEvent, {}));
    }
  }

  addEventListener(type: string, listener: SocketListener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send(serialized: string) {
    if (FakeSocket.nextSendThrows) {
      FakeSocket.nextSendThrows = false;
      throw new Error("secret transport detail");
    }
    this.sent.push(serialized);
  }

  close() {
    this.closeCalls += 1;
    this.emit("close", {});
  }

  emit(type: string, event: any) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

function assertCdpError(error: unknown, code: string) {
  assert.equal(error instanceof CdpClientError, true);
  assert.equal((error as CdpClientError).code, code);
  assert.equal(JSON.stringify(error).includes("secret"), false);
}

test("CdpClient rejects open when the session closes before open", async () => {
  (globalThis as any).WebSocket = FakeSocket;
  FakeSocket.nextInitialEvent = "close";
  const client = new CdpClient("ws://cdp.test");
  await assert.rejects(client.open(), (error) => {
    assert.equal(error instanceof CdpClientError, true);
    assert.equal((error as CdpClientError).code, "session_closed");
    assert.equal(JSON.stringify(error).includes("ws://"), false);
    return true;
  });
});

test("CdpClient rejects open when transport errors before open", async () => {
  (globalThis as any).WebSocket = FakeSocket;
  FakeSocket.nextInitialEvent = "error";
  const client = new CdpClient("ws://cdp.test");
  await assert.rejects(client.open(), (error) => {
    assertCdpError(error, "transport_error");
    return true;
  });
});

test("CdpClient bounds an open with no event by its supplied deadline and closes", async () => {
  (globalThis as any).WebSocket = FakeSocket;
  FakeSocket.nextInitialEvent = "none";
  const client = new CdpClient("ws://cdp.test");
  const startedAt = Date.now();
  await assert.rejects(client.open(10), (error) => {
    assertCdpError(error, "command_timeout");
    return true;
  });
  assert.equal(Date.now() - startedAt < 1_000, true);
  assert.equal(FakeSocket.instance.closeCalls, 1);
  assert.equal(client.pending.size, 0);
});

async function openClient() {
  (globalThis as any).WebSocket = FakeSocket;
  const client = new CdpClient("ws://cdp.test");
  await client.open();
  return { client, socket: FakeSocket.instance };
}

test("CdpClient dispatches CDP events to method listeners", async () => {
  const { client, socket } = await openClient();
  const received: unknown[] = [];
  client.on("Runtime.consoleAPICalled", (params) => received.push(params));

  socket.emit("message", {
    data: JSON.stringify({
      method: "Runtime.consoleAPICalled",
      params: { type: "log" }
    })
  });

  assert.deepEqual(received, [{ type: "log" }]);
  client.close();
});

test("CdpClient supports unsubscribe and off for event listeners", async () => {
  const { client, socket } = await openClient();
  let firstCalls = 0;
  let secondCalls = 0;
  const first = () => { firstCalls += 1; };
  const second = () => { secondCalls += 1; };
  const unsubscribe = client.on("Page.loadEventFired", first);
  client.on("Page.loadEventFired", second);

  unsubscribe();
  client.off("Page.loadEventFired", second);
  socket.emit("message", {
    data: JSON.stringify({ method: "Page.loadEventFired", params: { timestamp: 1 } })
  });

  assert.equal(firstCalls, 0);
  assert.equal(secondCalls, 0);
  client.close();
});

test("CdpClient does not dispatch response messages as events", async () => {
  const { client, socket } = await openClient();
  let eventCalls = 0;
  client.on("Runtime.evaluate", () => { eventCalls += 1; });

  const response = client.send("Runtime.evaluate", { expression: "1 + 1" });
  const request = JSON.parse(socket.sent[0]);
  socket.emit("message", {
    data: JSON.stringify({
      id: request.id,
      method: "Runtime.evaluate",
      params: { unexpected: true },
      result: { value: 2 }
    })
  });

  assert.deepEqual(await response, { value: 2 });
  assert.equal(eventCalls, 0);
  client.close();
});

test("CdpClient isolates listener exceptions", async () => {
  const { client, socket } = await openClient();
  let calls = 0;
  client.on("Runtime.bindingCalled", () => { throw new Error("listener failed"); });
  client.on("Runtime.bindingCalled", () => { calls += 1; });

  socket.emit("message", {
    data: JSON.stringify({ method: "Runtime.bindingCalled", params: { name: "test" } })
  });

  assert.equal(calls, 1);
  client.close();
});

test("CdpClient rejects pending sends and clears listeners when the socket closes", async () => {
  const { client, socket } = await openClient();
  let eventCalls = 0;
  client.on("Page.frameStoppedLoading", () => { eventCalls += 1; });
  const pending = client.send("Runtime.enable");

  socket.emit("close", {});
  await assert.rejects(pending, (error) => {
    assertCdpError(error, "session_closed");
    return true;
  });
  socket.emit("message", {
    data: JSON.stringify({ method: "Page.frameStoppedLoading", params: {} })
  });

  assert.equal(eventCalls, 0);
});

test("CdpClient rejects pending sends and clears listeners on socket errors", async () => {
  const { client, socket } = await openClient();
  let eventCalls = 0;
  client.on("Inspector.detached", () => { eventCalls += 1; });
  const pending = client.send("Runtime.enable");

  socket.emit("error", { error: new Error("transport failed") });
  await assert.rejects(pending, (error) => {
    assertCdpError(error, "transport_error");
    return true;
  });
  socket.emit("message", {
    data: JSON.stringify({ method: "Inspector.detached", params: {} })
  });

  assert.equal(eventCalls, 0);
});

test("CdpClient classifies Runtime.enable protocol errors without serializing CDP text", async () => {
  const { client, socket } = await openClient();
  const pending = client.send("Runtime.enable");
  const request = JSON.parse(socket.sent[0]);
  socket.emit("message", {
    data: JSON.stringify({ id: request.id, error: { message: "Target closed: secret" } })
  });
  await assert.rejects(pending, (error) => {
    assertCdpError(error, "protocol_error");
    return true;
  });
});

test("CdpClient classifies Runtime.enable command timeouts", async () => {
  const { client, socket } = await openClient();
  client.commandTimeoutMs = 0;
  await assert.rejects(client.send("Runtime.enable"), (error) => {
    assertCdpError(error, "command_timeout");
    return true;
  });
  assert.equal(socket.closeCalls, 1);
  assert.equal(client.pending.size, 0);
  assert.equal(client.listeners.size, 0);
});

test("CdpClient uses the supplied remaining deadline for Runtime.enable", async () => {
  const { client } = await openClient();
  client.commandTimeoutMs = 500;
  const startedAt = Date.now();
  await assert.rejects(client.send("Runtime.enable", {}, 10), (error) => {
    assertCdpError(error, "command_timeout");
    return true;
  });
  assert.equal(Date.now() - startedAt < 200, true);
  assert.equal(client.pending.size, 0);
});

test("CdpClient classifies synchronous Runtime.enable send errors", async () => {
  const { client } = await openClient();
  FakeSocket.nextSendThrows = true;
  await assert.rejects(client.send("Runtime.enable"), (error) => {
    assertCdpError(error, "transport_error");
    return true;
  });
});

test("waitForChildExit waits for the owned Electron child close event", async () => {
  const listeners = new Map<string, Set<(...args: any[]) => void>>();
  const child = {
    exitCode: null,
    signalCode: null,
    once(event: string, listener: (...args: any[]) => void) {
      const eventListeners = listeners.get(event) ?? new Set();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
    }
  };

  const waiting = waitForChildExit(child, 100);
  let resolved = false;
  void waiting.then(() => { resolved = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(resolved, false);

  child.exitCode = 0;
  for (const listener of listeners.get("close") ?? []) {
    listener(0, null);
  }

  await waiting;
  assert.equal(resolved, true);
});

function parseScript(path: string) {
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}

function collectNodes<T extends ts.Node>(source: ts.SourceFile, predicate: (node: ts.Node) => node is T) {
  const found: T[] = [];
  const visit = (node: ts.Node) => {
    if (predicate(node)) {
      found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function isIdentifier(node: ts.Node, name: string): node is ts.Identifier {
  return ts.isIdentifier(node) && node.text === name;
}

function allMjsFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return allMjsFiles(path);
    }
    return entry.isFile() && path.endsWith(".mjs") ? [path] : [];
  });
}

test("P2-89 owns an exact local 100% DPI Electron argument without shared-runner pollution", () => {
  const runnerPath = resolve("scripts/p2-89-settings-information-architecture-real-ui.mjs");
  const runner = parseScript(runnerPath);
  const variableDeclarations = collectNodes(runner, ts.isVariableDeclaration);
  const electronArgs = variableDeclarations.filter((declaration) => (
    isIdentifier(declaration.name, "electronArgs") &&
    declaration.initializer !== undefined
  ));
  assert.equal(electronArgs.length, 1);
  assert.equal(ts.isArrayLiteralExpression(electronArgs[0].initializer!), true);
  assert.deepEqual(
    (electronArgs[0].initializer as ts.ArrayLiteralExpression).elements.map((element) => (
      ts.isStringLiteral(element) ? element.text : null
    )),
    ["--force-device-scale-factor=1"]
  );

  const startCalls = collectNodes(runner, ts.isCallExpression).filter((call) => isIdentifier(call.expression, "startElectron"));
  assert.equal(startCalls.length, 1);
  assert.equal(startCalls[0].arguments.length, 1);
  assert.equal(isIdentifier(startCalls[0].arguments[0], "context"), true);
  assert.equal(electronArgs[0].getStart(runner) < startCalls[0].getStart(runner), true);

  const assignments = collectNodes(runner, ts.isBinaryExpression).filter((expression) => (
    expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isPropertyAccessExpression(expression.left) &&
    isIdentifier(expression.left.expression, "context") &&
    expression.left.name.text === "electronArgs" &&
    isIdentifier(expression.right, "electronArgs")
  ));
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].getStart(runner) < startCalls[0].getStart(runner), true);

  const flaggedRunners = allMjsFiles(resolve("scripts")).filter((path) => {
    const source = parseScript(path);
    return collectNodes(source, ts.isStringLiteral).some((literal) => literal.text === "--force-device-scale-factor=1");
  });
  assert.deepEqual(flaggedRunners, [runnerPath]);
});

test("startElectron forwards a context-local DPI argument and keeps it out of default contexts", () => {
  const runDir = mkdtempSync(join(tmpdir(), "ai-desktop-pet-real-ui-harness-"));
  let defaultContext: ReturnType<typeof createRealUiRunContext> | undefined;
  try {
    defaultContext = createRealUiRunContext({
      runName: "dpi-forwarding-contract",
      appDataDir: join(runDir, "user-data")
    });
    assert.equal(Object.hasOwn(defaultContext, "electronArgs"), false);

    let spawnedArgs: string[] | undefined;
    const stream = { on() {} };
    const child = {
      pid: 1,
      stdout: stream,
      stderr: stream,
      once() {}
    };
    startElectron({
      ...defaultContext,
      runDir,
      electronArgs: ["--force-device-scale-factor=1"]
    }, {
      spawnImpl(_command: string, args: string[]) {
        spawnedArgs = args;
        return child;
      }
    });
    assert.deepEqual(spawnedArgs, [
      ".",
      `--remote-debugging-port=${defaultContext.port}`,
      "--force-device-scale-factor=1"
    ]);
  } finally {
    if (defaultContext) {
      cleanupRealUiRun(defaultContext);
    }
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("P2-89 requires an exact DPR=1 reference baseline while preserving legacy checks and thresholds", () => {
  const runner = parseScript(resolve("scripts/p2-89-settings-information-architecture-real-ui.mjs"));
  const declarations = collectNodes(runner, ts.isVariableDeclaration);
  const rendererDpr = declarations.find((declaration) => isIdentifier(declaration.name, "rendererDevicePixelRatio"));
  assert.notEqual(rendererDpr, undefined);
  assert.equal(ts.isObjectLiteralExpression(rendererDpr!.initializer), true);
  const rendererDprProperties = (rendererDpr!.initializer as ts.ObjectLiteralExpression).properties;
  assert.deepEqual(rendererDprProperties.map((property) => (
    ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) ? property.name.text : null
  )), ["pet", "chat", "charm"]);
  for (const property of rendererDprProperties) {
    assert.equal(ts.isPropertyAssignment(property), true);
    assert.equal(ts.isAwaitExpression((property as ts.PropertyAssignment).initializer), true);
    const call = ((property as ts.PropertyAssignment).initializer as ts.AwaitExpression).expression;
    assert.equal(ts.isCallExpression(call), true);
    const arguments_ = (call as ts.CallExpression).arguments;
    assert.equal(arguments_.length, 2);
    assert.equal(ts.isStringLiteral(arguments_[1]) && arguments_[1].text === "window.devicePixelRatio", true);
  }

  const baseline = collectNodes(runner, ts.isBinaryExpression).find((expression) => (
    expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    isIdentifier(expression.left, "referenceBaseline") &&
    ts.isCallExpression(expression.right)
  ));
  assert.notEqual(baseline, undefined);
  const everyCall = baseline!.right as ts.CallExpression;
  assert.equal(ts.isPropertyAccessExpression(everyCall.expression) && everyCall.expression.name.text === "every", true);
  const predicate = everyCall.arguments[0];
  assert.equal(ts.isArrowFunction(predicate), true);
  assert.equal(ts.isBinaryExpression((predicate as ts.ArrowFunction).body), true);
  const equality = (predicate as ts.ArrowFunction).body as ts.BinaryExpression;
  assert.equal(equality.operatorToken.kind, ts.SyntaxKind.EqualsEqualsEqualsToken);
  assert.equal(ts.isNumericLiteral(equality.right) && equality.right.text === "1", true);

  const printer = ts.createPrinter({ removeComments: true });
  const legacyChecks = collectNodes(runner, ts.isBinaryExpression).filter((expression) => (
    expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isPropertyAccessExpression(expression.left) &&
    isIdentifier(expression.left.expression, "checks") &&
    !["referenceBaseline", "sendPromptFadesQuickly"].includes(expression.left.name.text)
  )).map((expression) => printer.printNode(ts.EmitHint.Unspecified, expression, runner));
  assert.equal(legacyChecks.length, 46);
  assert.equal(createHash("sha256").update(legacyChecks.join("\n")).digest("hex"), "2bd8cd3dfa0ef256fcfb5e344a2052f5a2abfdb349626379b378d6e919a420f6");
});

function propertyNames(object: ts.ObjectLiteralExpression) {
  return object.properties.map((property) => (
    ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
      ? property.name.text
      : ts.isShorthandPropertyAssignment(property)
        ? property.name.text
      : null
  ));
}

function callsNamed(source: ts.SourceFile, name: string) {
  return collectNodes(source, ts.isCallExpression).filter((call) => isIdentifier(call.expression, name));
}

test("P2-89 timing diagnosis emits only the safe renderer-rAF schema and removes its strict listener", () => {
  const runner = parseScript(resolve("scripts/p2-89-settings-information-architecture-real-ui.mjs"));
  const declarations = collectNodes(runner, ts.isVariableDeclaration);
  const diagnosis = declarations.find((declaration) => isIdentifier(declaration.name, "sendPromptTiming"));
  assert.notEqual(diagnosis, undefined);
  assert.equal(ts.isAwaitExpression(diagnosis!.initializer), true);
  const evaluateCall = (diagnosis!.initializer as ts.AwaitExpression).expression;
  assert.equal(ts.isCallExpression(evaluateCall), true);
  assert.equal(isIdentifier((evaluateCall as ts.CallExpression).expression, "evaluate"), true);
  const evaluateArguments = (evaluateCall as ts.CallExpression).arguments;
  assert.equal(evaluateArguments.length, 2);
  assert.equal(isIdentifier(evaluateArguments[0], "chat"), true);
  assert.equal(ts.isNoSubstitutionTemplateLiteral(evaluateArguments[1]), true);
  const diagnosticRenderer = ts.createSourceFile(
    "p2-89-send-prompt-timing-diagnostic.js",
    (evaluateArguments[1] as ts.NoSubstitutionTemplateLiteral).text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  const submitEvaluations = collectNodes(runner, ts.isCallExpression).filter((call) => {
    if (!isIdentifier(call.expression, "evaluate") || !ts.isNoSubstitutionTemplateLiteral(call.arguments[1])) {
      return false;
    }
    const renderer = ts.createSourceFile("p2-89-submit.js", call.arguments[1].text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    return collectNodes(renderer, ts.isCallExpression).some((innerCall) => (
      ts.isPropertyAccessExpression(innerCall.expression) && innerCall.expression.name.text === "requestSubmit"
    ));
  });
  assert.equal(submitEvaluations.length, 1);
  assert.equal(submitEvaluations[0].getStart(runner), (evaluateCall as ts.CallExpression).getStart(runner));

  const targetDeclaration = collectNodes(diagnosticRenderer, ts.isVariableDeclaration).find((declaration) => (
    isIdentifier(declaration.name, "sampleTargets") && ts.isArrayLiteralExpression(declaration.initializer)
  ));
  assert.notEqual(targetDeclaration, undefined);
  assert.deepEqual(
    (targetDeclaration!.initializer as ts.ArrayLiteralExpression).elements.map((element) => (
      ts.isNumericLiteral(element) ? Number(element.text) : null
    )),
    [0, 50, 100.874, 140, 200]
  );

  const performanceNowCalls = collectNodes(diagnosticRenderer, ts.isCallExpression).filter((call) => (
    ts.isPropertyAccessExpression(call.expression) &&
    isIdentifier(call.expression.expression, "performance") &&
    call.expression.name.text === "now"
  ));
  assert.equal(performanceNowCalls.length >= 2, true);
  assert.equal(callsNamed(diagnosticRenderer, "requestAnimationFrame").length >= 1, true);

  const listenerRegistrations = collectNodes(diagnosticRenderer, ts.isCallExpression).filter((call) => (
    ts.isPropertyAccessExpression(call.expression) &&
    isIdentifier(call.expression.expression, "input") &&
    call.expression.name.text === "addEventListener" &&
    ts.isStringLiteral(call.arguments[0]) && call.arguments[0].text === "animationstart"
  ));
  const submits = collectNodes(diagnosticRenderer, ts.isCallExpression).filter((call) => (
    ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "requestSubmit"
  ));
  assert.equal(listenerRegistrations.length, 1);
  assert.equal(submits.length, 1);
  assert.equal(listenerRegistrations[0].getStart(diagnosticRenderer) < submits[0].getStart(diagnosticRenderer), true);

  const strictFilters = collectNodes(diagnosticRenderer, ts.isBinaryExpression).filter((expression) => (
    expression.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
    ts.isPropertyAccessExpression(expression.left) &&
    isIdentifier(expression.left.expression, "event") &&
    ts.isStringLiteral(expression.right)
  ));
  assert.deepEqual(
    strictFilters.map((expression) => [
      (expression.left as ts.PropertyAccessExpression).name.text,
      (expression.right as ts.StringLiteral).text
    ]),
    [
      ["animationName", "figma-send-placeholder-opacity"],
      ["pseudoElement", "::placeholder"]
    ]
  );

  const cleanups = collectNodes(diagnosticRenderer, ts.isCallExpression).filter((call) => (
    ts.isPropertyAccessExpression(call.expression) &&
    isIdentifier(call.expression.expression, "input") &&
    call.expression.name.text === "removeEventListener" &&
    ts.isStringLiteral(call.arguments[0]) && call.arguments[0].text === "animationstart"
  ));
  assert.equal(cleanups.length, 1);
  assert.equal(collectNodes(diagnosticRenderer, ts.isTryStatement).some((statement) => (
    statement.finallyBlock !== undefined &&
    cleanups[0].getStart(diagnosticRenderer) >= statement.finallyBlock.getStart(diagnosticRenderer) &&
    cleanups[0].getEnd() <= statement.finallyBlock.getEnd()
  )), true);

  const pushedSamples = collectNodes(diagnosticRenderer, ts.isCallExpression).filter((call) => (
    ts.isPropertyAccessExpression(call.expression) &&
    isIdentifier(call.expression.expression, "samples") &&
    call.expression.name.text === "push" &&
    ts.isObjectLiteralExpression(call.arguments[0])
  ));
  assert.equal(pushedSamples.length, 1);
  assert.deepEqual(propertyNames(pushedSamples[0].arguments[0] as ts.ObjectLiteralExpression), [
    "targetOffsetMs",
    "actualOffsetMs",
    "animationStartOffsetMs",
    "classIsSending",
    "animationName",
    "animationDurationMs",
    "animationDelayMs",
    "animationPlayState",
    "placeholderOpacity"
  ]);

  const diagnosticReturns = collectNodes(diagnosticRenderer, ts.isReturnStatement).filter((statement) => ts.isObjectLiteralExpression(statement.expression));
  assert.equal(diagnosticReturns.length, 1);
  assert.deepEqual(propertyNames(diagnosticReturns[0].expression as ts.ObjectLiteralExpression), ["reducedMotion", "visibilityState", "samples"]);

  const result = declarations.find((declaration) => isIdentifier(declaration.name, "result"));
  assert.equal(ts.isObjectLiteralExpression(result?.initializer), true);
  const resultProperties = propertyNames(result!.initializer as ts.ObjectLiteralExpression);
  assert.equal(resultProperties.includes("timing"), true);
  assert.equal(resultProperties.filter((name) => ["reducedMotion", "visibilityState", "samples"].includes(name ?? "")).length, 0);

  const timing = declarations.find((declaration) => isIdentifier(declaration.name, "timing"));
  assert.equal(ts.isObjectLiteralExpression(timing?.initializer), true);
  assert.deepEqual(propertyNames(timing!.initializer as ts.ObjectLiteralExpression), ["sendPromptTiming"]);
  const failureStage = declarations.find((declaration) => isIdentifier(declaration.name, "failureStage"));
  assert.equal(failureStage !== undefined, true);

  const catches = collectNodes(runner, ts.isTryStatement).map((statement) => statement.catchClause).filter(Boolean);
  assert.equal(catches.length, 1);
  assert.equal(catches[0]!.variableDeclaration, undefined);
  const failureJson = collectNodes(catches[0]!.block, ts.isCallExpression).find((call) => (
    ts.isPropertyAccessExpression(call.expression) &&
    isIdentifier(call.expression.expression, "JSON") &&
    call.expression.name.text === "stringify" &&
    ts.isObjectLiteralExpression(call.arguments[0])
  ));
  assert.notEqual(failureJson, undefined);
  assert.deepEqual(propertyNames(failureJson!.arguments[0] as ts.ObjectLiteralExpression), ["ok", "checks", "dpr", "referenceBaseline", "timing", "stage"]);

  const fadeCheck = collectNodes(runner, ts.isBinaryExpression).find((expression) => (
    expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isPropertyAccessExpression(expression.left) &&
    isIdentifier(expression.left.expression, "checks") &&
    expression.left.name.text === "sendPromptFadesQuickly"
  ));
  assert.notEqual(fadeCheck, undefined);
  assert.equal(ts.isBinaryExpression(fadeCheck!.right), true);
  const fadeThreshold = fadeCheck!.right as ts.BinaryExpression;
  assert.equal(fadeThreshold.operatorToken.kind, ts.SyntaxKind.LessThanEqualsToken);
  assert.equal(ts.isNumericLiteral(fadeThreshold.right) && fadeThreshold.right.text === "0.05", true);
  const sameSubmit140 = collectNodes(fadeThreshold.left, ts.isBinaryExpression).some((expression) => (
    expression.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
    ts.isPropertyAccessExpression(expression.left) &&
    expression.left.name.text === "targetOffsetMs" &&
    ts.isNumericLiteral(expression.right) && expression.right.text === "140"
  ));
  assert.equal(sameSubmit140, true);

  const delay140 = collectNodes(runner, ts.isCallExpression).filter((call) => (
    isIdentifier(call.expression, "setTimeout") &&
    ts.isNumericLiteral(call.arguments[1]) && call.arguments[1].text === "140"
  ));
  assert.equal(delay140.length, 0);
});

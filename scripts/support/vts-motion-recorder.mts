import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { basename, isAbsolute, parse, relative, resolve, sep } from "node:path";
import { parseMotion3Segments, type CanonicalMotion3 } from "./motion3-canonicalizer.mts";

const API_NAME = "VTubeStudioPublicAPI";
const API_VERSION = "1.0";
const PLUGIN_NAME = "AI Desktop Pet Motion Recorder v3";
const PLUGIN_DEVELOPER = "AI Desktop Pet";
const DEFAULT_REQUEST_TIMEOUT_MS = 3_000;
const AUTHORIZATION_TIMEOUT_MS = 180_000;
const STATIC_ZONE_SECONDS = 0.3;

export const YAWN_SEMANTIC_GESTURE_ALLOWLIST = [
  "ParamAngleX",
  "ParamAngleY",
  "ParamAngleZ",
  "ParamEyeLOpen",
  "ParamEyeROpen",
  "ParamBrowLY",
  "ParamBrowLForm",
  "ParamMouthOpenY",
  "ParamMouthForm"
] as const;

type JsonRecord = Record<string, unknown>;

export type VtsResponse = {
  requestID: string;
  messageType: string;
  timestamp: number;
  data: JsonRecord;
};

export interface VtsRequestAdapter {
  request(messageType: string, data?: JsonRecord, timeoutMs?: number): Promise<VtsResponse>;
  close?(): void | Promise<void>;
}

export interface TokenStore {
  load(): Promise<string | undefined>;
  save(token: string): Promise<void>;
  remove(): Promise<void>;
}

export type RecorderRuntime = {
  now(): number;
  sleep(milliseconds: number): Promise<void>;
  confirmStart(): Promise<boolean>;
  onCountdown?(cue: 3 | 2 | 1 | "开始"): void | Promise<void>;
  onRecordingStart?(): void | Promise<void>;
};

export type RecorderInspection = {
  apiActive: true;
  authenticated: true;
  modelLoaded: true;
  parameterCount: number;
  semanticParameterCount: number;
};

export type RecorderResult = {
  motion: CanonicalMotion3;
  summary: {
    safeSummaryOnly: true;
    status: "recorded";
    fps: number;
    sampleCount: number;
    curveCount: number;
    durationSeconds: number;
    consistencyCheck: true;
  };
};

export class VtsRecorderError extends Error {
  readonly code: string;

  constructor(code: string, message: string = code) {
    super(message);
    this.name = "VtsRecorderError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function requireResponse(response: VtsResponse, expectedType: string): JsonRecord {
  if (response.messageType !== expectedType || !finiteNumber(response.timestamp) || !isRecord(response.data)) {
    throw new VtsRecorderError("invalid-vts-response");
  }
  return response.data;
}

type Parameter = {
  name: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
};

type Session = {
  modelID: string;
  parameters: Parameter[];
  parameterSignature: string;
};

function parseParameters(data: JsonRecord): { modelID: string; parameters: Parameter[] } {
  if (data.modelLoaded !== true || typeof data.modelID !== "string" || data.modelID.length === 0) {
    throw new VtsRecorderError("no-model-loaded");
  }
  if (!Array.isArray(data.parameters) || data.parameters.length === 0) {
    throw new VtsRecorderError("invalid-parameter-list");
  }

  const names = new Set<string>();
  const parameters = data.parameters.map((candidate): Parameter => {
    if (!isRecord(candidate)) throw new VtsRecorderError("invalid-parameter-list");
    const { name, value, min, max, defaultValue } = candidate;
    if (
      typeof name !== "string" || name.length === 0 || names.has(name) ||
      !finiteNumber(value) || !finiteNumber(min) || !finiteNumber(max) || !finiteNumber(defaultValue) ||
      min > max
    ) {
      throw new VtsRecorderError("invalid-parameter-sample");
    }
    names.add(name);
    return { name, value, min, max, defaultValue };
  });

  return { modelID: data.modelID, parameters };
}

function signature(parameters: Parameter[]): string {
  return [...parameters]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(({ name, min, max }) => `${name}\u0000${min}\u0000${max}`)
    .join("\u0001");
}

function isWithin(base: string, candidate: string): boolean {
  const child = relative(base, candidate);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

function validAuthenticationToken(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4_096 &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

async function authenticate(adapter: VtsRequestAdapter, token: string, timeoutMs: number): Promise<boolean> {
  try {
    const authData = requireResponse(
      await adapter.request("AuthenticationRequest", {
        pluginName: PLUGIN_NAME,
        pluginDeveloper: PLUGIN_DEVELOPER,
        authenticationToken: token
      }, timeoutMs),
      "AuthenticationResponse"
    );
    return authData.authenticated === true;
  } catch (error) {
    const safeCodes = new Set(["connection-closed", "invalid-vts-response", "request-timeout", "vts-api-error"]);
    const code = error instanceof VtsRecorderError && safeCodes.has(error.code)
      ? error.code
      : "authentication-denied";
    throw new VtsRecorderError(code);
  }
}

async function withSessionTimeout<T>(operation: () => Promise<T>, timeoutCode: string): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof VtsRecorderError && error.code === "request-timeout") {
      throw new VtsRecorderError(timeoutCode);
    }
    throw error;
  }
}

async function loadToken(tokenStore?: TokenStore): Promise<string | undefined> {
  if (!tokenStore) return undefined;
  try {
    const token = await tokenStore.load();
    if (token === undefined || validAuthenticationToken(token)) return token;
  } catch {
    // Token persistence is best-effort and must never block an in-memory session.
  }
  await removeToken(tokenStore);
  return undefined;
}

async function saveToken(tokenStore: TokenStore | undefined, token: string): Promise<void> {
  try {
    await tokenStore?.save(token);
  } catch {
    // The current authentication attempt can continue without persistence.
  }
}

async function removeToken(tokenStore?: TokenStore): Promise<void> {
  try {
    await tokenStore?.remove();
  } catch {
    // A failed cleanup must not expose or preserve token data in an error.
  }
}

async function openSession(
  adapter: VtsRequestAdapter,
  timeoutMs: number,
  tokenStore?: TokenStore
): Promise<Session> {
  const apiState = requireResponse(
    await withSessionTimeout(
      () => adapter.request("APIStateRequest", undefined, timeoutMs),
      "api-state-timeout"
    ),
    "APIStateResponse"
  );
  if (apiState.active !== true) throw new VtsRecorderError("vts-api-inactive");

  const cachedToken = await loadToken(tokenStore);
  if (cachedToken !== undefined) {
    if (await withSessionTimeout(
      () => authenticate(adapter, cachedToken, timeoutMs),
      "authentication-timeout"
    )) {
      return await loadSessionModel(adapter, timeoutMs);
    }
    await removeToken(tokenStore);
  }

  const tokenData = requireResponse(
    await withSessionTimeout(
      () => adapter.request("AuthenticationTokenRequest", {
        pluginName: PLUGIN_NAME,
        pluginDeveloper: PLUGIN_DEVELOPER
      }, AUTHORIZATION_TIMEOUT_MS),
      "authentication-token-timeout"
    ),
    "AuthenticationTokenResponse"
  );
  if (!validAuthenticationToken(tokenData.authenticationToken)) {
    throw new VtsRecorderError("authentication-denied");
  }
  const token = tokenData.authenticationToken;
  await saveToken(tokenStore, token);
  if (!await withSessionTimeout(
    () => authenticate(adapter, token, timeoutMs),
    "authentication-timeout"
  )) {
    await removeToken(tokenStore);
    throw new VtsRecorderError("authentication-denied");
  }

  return await loadSessionModel(adapter, timeoutMs);
}

async function loadSessionModel(adapter: VtsRequestAdapter, timeoutMs: number): Promise<Session> {
  const currentModel = requireResponse(
    await withSessionTimeout(
      () => adapter.request("CurrentModelRequest", undefined, timeoutMs),
      "current-model-timeout"
    ),
    "CurrentModelResponse"
  );
  if (currentModel.modelLoaded !== true || typeof currentModel.modelID !== "string" || currentModel.modelID.length === 0) {
    throw new VtsRecorderError("no-model-loaded");
  }

  const parameterData = requireResponse(
    await withSessionTimeout(
      () => adapter.request("Live2DParameterListRequest", undefined, timeoutMs),
      "parameter-list-timeout"
    ),
    "Live2DParameterListResponse"
  );
  const parsed = parseParameters(parameterData);
  if (parsed.modelID !== currentModel.modelID) throw new VtsRecorderError("model-changed");

  const available = new Set(parsed.parameters.map(({ name }) => name));
  if (YAWN_SEMANTIC_GESTURE_ALLOWLIST.some((name) => !available.has(name))) {
    throw new VtsRecorderError("semantic-profile-unavailable");
  }

  return {
    modelID: parsed.modelID,
    parameters: parsed.parameters,
    parameterSignature: signature(parsed.parameters)
  };
}

export async function inspectVts(
  adapter: VtsRequestAdapter,
  options: number | { requestTimeoutMs?: number; tokenStore?: TokenStore } = {}
): Promise<RecorderInspection> {
  const normalized = typeof options === "number" ? { requestTimeoutMs: options } : options;
  const session = await openSession(
    adapter,
    normalized.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    normalized.tokenStore
  );
  return {
    apiActive: true,
    authenticated: true,
    modelLoaded: true,
    parameterCount: session.parameters.length,
    semanticParameterCount: YAWN_SEMANTIC_GESTURE_ALLOWLIST.length
  };
}

function defaultRuntime(): RecorderRuntime {
  return {
    now: Date.now,
    sleep: (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
    confirmStart: async () => false
  };
}

function sampleOffsets(durationSeconds: number, fps: number): number[] {
  const offsets = [0];
  for (let frame = 1; frame / fps < durationSeconds; frame += 1) offsets.push(frame / fps);
  offsets.push(durationSeconds);
  return offsets;
}

function removeSingleFrameSpikes(values: number[], range: number): number[] {
  const output = [...values];
  const neighborTolerance = Math.max(range * 0.002, 1e-7);
  const spikeThreshold = Math.max(range * 0.05, 1e-6);
  for (let index = 1; index < values.length - 1; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    const next = values[index + 1];
    if (Math.abs(previous - next) <= neighborTolerance && Math.abs(current - (previous + next) / 2) >= spikeThreshold) {
      output[index] = (previous + next) / 2;
    }
  }
  return output;
}

function buildMotion(session: Session, samples: Parameter[][], offsets: number[], fps: number): CanonicalMotion3 {
  const byName = new Map(session.parameters.map((parameter) => [parameter.name, parameter]));
  const valueMaps = samples.map((sample) => new Map(sample.map((parameter) => [parameter.name, parameter.value])));
  const duration = STATIC_ZONE_SECONDS + offsets[offsets.length - 1] + STATIC_ZONE_SECONDS;
  const curves: CanonicalMotion3["Curves"] = [];

  for (const id of YAWN_SEMANTIC_GESTURE_ALLOWLIST) {
    const definition = byName.get(id)!;
    const values = removeSingleFrameSpikes(
      valueMaps.map((valuesByName) => valuesByName.get(id)!),
      definition.max - definition.min
    );
    const observedSpan = Math.max(...values) - Math.min(...values);
    if (observedSpan <= Math.max((definition.max - definition.min) * 0.001, 1e-7)) continue;

    const segments = [0, values[0], 0, STATIC_ZONE_SECONDS, values[0]];
    for (let index = 1; index < values.length; index += 1) {
      segments.push(0, STATIC_ZONE_SECONDS + offsets[index], values[index]);
    }
    segments.push(0, duration, values[values.length - 1]);
    curves.push({ Target: "Parameter", Id: id, Segments: segments });
  }

  if (curves.length === 0) throw new VtsRecorderError("no-semantic-gesture-detected");

  const summaries = curves.map((curve) => parseMotion3Segments(curve.Segments, duration));
  const totalSegmentCount = summaries.reduce((total, item) => total + item.segmentCount, 0);
  const totalPointCount = summaries.reduce((total, item) => total + item.pointCount, 0);
  if (summaries.some((item) => !item.validEncoding || !item.validTime)) {
    throw new VtsRecorderError("motion-consistency-check-failed");
  }

  const motion: CanonicalMotion3 = {
    Version: 3,
    Meta: {
      Duration: duration,
      Fps: fps,
      Loop: false,
      AreBeziersRestricted: false,
      CurveCount: curves.length,
      TotalSegmentCount: totalSegmentCount,
      TotalPointCount: totalPointCount,
      UserDataCount: 0,
      TotalUserDataSize: 0
    },
    Curves: curves,
    UserData: []
  };

  const reparsed = motion.Curves.map((curve) => parseMotion3Segments(curve.Segments, motion.Meta.Duration));
  if (
    reparsed.some((item) => !item.validEncoding || !item.validTime) ||
    reparsed.reduce((total, item) => total + item.segmentCount, 0) !== motion.Meta.TotalSegmentCount ||
    reparsed.reduce((total, item) => total + item.pointCount, 0) !== motion.Meta.TotalPointCount
  ) {
    throw new VtsRecorderError("motion-consistency-check-failed");
  }
  return motion;
}

export async function recordVtsMotion(
  adapter: VtsRequestAdapter,
  options: {
    durationSeconds: number;
    fps?: number;
    requestTimeoutMs?: number;
    runtime?: RecorderRuntime;
    tokenStore?: TokenStore;
  }
): Promise<RecorderResult> {
  const fps = options.fps ?? 30;
  if (!finiteNumber(options.durationSeconds) || options.durationSeconds <= 0 || options.durationSeconds > 60) {
    throw new VtsRecorderError("invalid-duration");
  }
  if (!Number.isInteger(fps) || fps < 1 || fps > 30) throw new VtsRecorderError("invalid-fps");

  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const runtime = options.runtime ?? defaultRuntime();
  const session = await openSession(adapter, timeoutMs, options.tokenStore);
  if (!await runtime.confirmStart()) throw new VtsRecorderError("recording-not-confirmed");
  for (let seconds = 3; seconds > 0; seconds -= 1) {
    await runtime.onCountdown?.(seconds as 3 | 2 | 1);
    await runtime.sleep(1_000);
  }
  await runtime.onCountdown?.("开始");

  const offsets = sampleOffsets(options.durationSeconds, fps);
  const samples: Parameter[][] = [];
  let previousTimestamp = -Infinity;
  await runtime.onRecordingStart?.();
  const startedAt = runtime.now();

  for (const offset of offsets) {
    const delay = startedAt + offset * 1_000 - runtime.now();
    if (delay > 0) await runtime.sleep(delay);
    const response = await adapter.request("Live2DParameterListRequest", undefined, timeoutMs);
    const data = requireResponse(response, "Live2DParameterListResponse");
    if (response.timestamp <= previousTimestamp) throw new VtsRecorderError("out-of-order-sample");
    previousTimestamp = response.timestamp;

    const parsed = parseParameters(data);
    if (parsed.modelID !== session.modelID) throw new VtsRecorderError("model-changed");
    if (signature(parsed.parameters) !== session.parameterSignature) {
      throw new VtsRecorderError("parameter-set-changed");
    }
    samples.push(parsed.parameters);
  }

  const motion = buildMotion(session, samples, offsets, fps);
  return {
    motion,
    summary: {
      safeSummaryOnly: true,
      status: "recorded",
      fps,
      sampleCount: samples.length,
      curveCount: motion.Curves.length,
      durationSeconds: motion.Meta.Duration,
      consistencyCheck: true
    }
  };
}

type WebSocketEventTarget = {
  readyState: number;
  addEventListener(type: string, listener: (event: any) => void): void;
  removeEventListener(type: string, listener: (event: any) => void): void;
  send(data: string): void;
  close(): void;
};

export function vtsUrl(port: number = 8001): string {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new VtsRecorderError("invalid-port");
  return `ws://127.0.0.1:${port}`;
}

export async function createNodeWebSocketAdapter(
  port: number = 8001,
  WebSocketConstructor: new (url: string) => WebSocketEventTarget = globalThis.WebSocket as unknown as new (url: string) => WebSocketEventTarget,
  connectTimeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS
): Promise<VtsRequestAdapter> {
  if (typeof WebSocketConstructor !== "function") throw new VtsRecorderError("websocket-unavailable");
  const socket = new WebSocketConstructor(vtsUrl(port));
  await new Promise<void>((resolveOpen, rejectOpen) => {
    let failed = false;
    const timer = setTimeout(() => fail(new VtsRecorderError("connection-timeout")), connectTimeoutMs);
    const closeSocket = () => {
      try {
        socket.close();
      } catch {
        // Connection cleanup must preserve the sanitized recorder error.
      }
    };
    const onOpen = () => {
      if (failed) {
        socket.removeEventListener("open", onOpen);
        closeSocket();
        return;
      }
      finish();
    };
    const onError = () => fail(new VtsRecorderError("connection-failed"));
    function fail(error: Error): void {
      if (failed) return;
      failed = true;
      clearTimeout(timer);
      socket.removeEventListener("error", onError);
      closeSocket();
      rejectOpen(error);
    }
    function finish(error?: Error): void {
      clearTimeout(timer);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      error ? rejectOpen(error) : resolveOpen();
    }
    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onError);
  });

  let sequence = 0;
  let inFlight = false;
  return {
    async request(messageType, data, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<VtsResponse> {
      if (inFlight) throw new VtsRecorderError("request-already-in-flight");
      inFlight = true;
      const requestID = `p2-63b-${++sequence}`;
      try {
        return await new Promise<VtsResponse>((resolveResponse, rejectResponse) => {
          const timer = setTimeout(() => finish(new VtsRecorderError("request-timeout")), timeoutMs);
          const onClose = () => finish(new VtsRecorderError("connection-closed"));
          const onMessage = (event: { data: unknown }) => {
            if (event.data === "") return;
            let candidate: unknown;
            try {
              candidate = JSON.parse(String(event.data));
            } catch {
              finish(new VtsRecorderError("invalid-vts-response"));
              return;
            }
            if (!isRecord(candidate) || candidate.requestID !== requestID) return;
            if (candidate.messageType === "APIError") {
              finish(new VtsRecorderError("vts-api-error"));
              return;
            }
            if (
              typeof candidate.messageType !== "string" || !finiteNumber(candidate.timestamp) ||
              !isRecord(candidate.data)
            ) {
              finish(new VtsRecorderError("invalid-vts-response"));
              return;
            }
            finish(undefined, {
              requestID,
              messageType: candidate.messageType,
              timestamp: candidate.timestamp,
              data: candidate.data
            });
          };
          function finish(error?: Error, response?: VtsResponse): void {
            clearTimeout(timer);
            socket.removeEventListener("message", onMessage);
            socket.removeEventListener("close", onClose);
            if (error) rejectResponse(error);
            else resolveResponse(response!);
          }
          socket.addEventListener("message", onMessage);
          socket.addEventListener("close", onClose);
          try {
            socket.send(JSON.stringify({
              apiName: API_NAME,
              apiVersion: API_VERSION,
              requestID,
              messageType,
              ...(data ? { data } : {})
            }));
          } catch {
            finish(new VtsRecorderError("connection-failed"));
          }
        });
      } finally {
        inFlight = false;
      }
    },
    close: () => socket.close()
  };
}

const FORBIDDEN_DRAFT_SEGMENTS = new Set(["model", "models", "manifest", "catalog", "resources"]);

export async function resolveDraftOutputPath(
  draftRoot: string,
  name: string,
  allowedDraftRoot: string = resolve(process.cwd(), ".tmp")
): Promise<string> {
  if (
    typeof draftRoot !== "string" || draftRoot.trim().length === 0 || !isAbsolute(draftRoot) ||
    typeof allowedDraftRoot !== "string" || allowedDraftRoot.trim().length === 0 || !isAbsolute(allowedDraftRoot)
  ) {
    throw new VtsRecorderError("invalid-draft-root");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name)) throw new VtsRecorderError("invalid-draft-name");

  const requestedAllowedRoot = resolve(allowedDraftRoot);
  const requestedRoot = resolve(draftRoot);
  if (requestedAllowedRoot === parse(requestedAllowedRoot).root || requestedRoot === parse(requestedRoot).root) {
    throw new VtsRecorderError("invalid-draft-root");
  }
  if (FORBIDDEN_DRAFT_SEGMENTS.has(basename(requestedAllowedRoot).toLowerCase())) {
    throw new VtsRecorderError("invalid-draft-root");
  }
  const requestedChild = relative(requestedAllowedRoot, requestedRoot);
  const requestedSegments = requestedChild.split(/[\\/]+/).filter(Boolean).map((part) => part.toLowerCase());
  if (!isWithin(requestedAllowedRoot, requestedRoot) || requestedSegments.some((part) => FORBIDDEN_DRAFT_SEGMENTS.has(part))) {
    throw new VtsRecorderError("invalid-draft-root");
  }

  await mkdir(requestedAllowedRoot, { recursive: true });
  if ((await lstat(requestedAllowedRoot)).isSymbolicLink()) throw new VtsRecorderError("invalid-draft-root");
  const canonicalAllowedRoot = await realpath(requestedAllowedRoot);
  if (
    canonicalAllowedRoot === parse(canonicalAllowedRoot).root ||
    FORBIDDEN_DRAFT_SEGMENTS.has(basename(canonicalAllowedRoot).toLowerCase())
  ) {
    throw new VtsRecorderError("invalid-draft-root");
  }

  let canonicalRoot = canonicalAllowedRoot;
  const childSegments = requestedChild.split(sep).filter(Boolean);
  for (const segment of childSegments) {
    const nextRoot = resolve(canonicalRoot, segment);
    await mkdir(nextRoot, { recursive: true });
    canonicalRoot = await realpath(nextRoot);
    if (!isWithin(canonicalAllowedRoot, canonicalRoot)) throw new VtsRecorderError("invalid-draft-root");
  }
  const canonicalSegments = relative(canonicalAllowedRoot, canonicalRoot)
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase());
  if (
    canonicalSegments.some((part) => FORBIDDEN_DRAFT_SEGMENTS.has(part))
  ) {
    throw new VtsRecorderError("invalid-draft-root");
  }

  const output = resolve(canonicalRoot, `${name}.motion3.json`);
  const child = relative(canonicalRoot, output);
  const outputName = basename(output).toLowerCase();
  if (
    child.startsWith(`..${sep}`) || child === ".." || isAbsolute(child) ||
    [...FORBIDDEN_DRAFT_SEGMENTS].some((segment) => outputName.includes(segment))
  ) {
    throw new VtsRecorderError("draft-path-escape");
  }
  return output;
}

export async function writeMotionDraft(
  draftRoot: string,
  name: string,
  motion: CanonicalMotion3,
  allowedDraftRoot: string = resolve(process.cwd(), ".tmp")
): Promise<string> {
  const output = await resolveDraftOutputPath(draftRoot, name, allowedDraftRoot);
  await writeFile(output, `${JSON.stringify(motion, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return output;
}

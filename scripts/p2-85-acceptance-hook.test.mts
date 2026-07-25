import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const contract = readFileSync("src/shared/ipc-contract.ts", "utf8");
const preload = readFileSync("src/preload/pet-preload.ts", "utf8");
const app = readFileSync("src/main/app.ts", "utf8");

const scenarioIds = [
  "chat_opened_replace_active",
  "reply_visible_generic_once",
  "explicit_game_single_presentation",
  "proactive_suppress_single_defer"
] as const;

test("P2-85 preload bridge exposes only the closed scenario and baseline contracts", () => {
  assert.match(
    contract,
    /export const P2_85_ACCEPTANCE_SCENARIO_IDS = Object\.freeze\(\[/u
  );
  assert.match(
    contract,
    /export type P285AcceptanceScenarioId =\s*\(typeof P2_85_ACCEPTANCE_SCENARIO_IDS\)\[number\]/u
  );
  assert.match(
    contract,
    /runP285ScenarioForAcceptance\(scenarioId: P285AcceptanceScenarioId\): Promise<boolean>/u
  );
  assert.match(contract, /resetP285AcceptanceBaseline\(\): Promise<boolean>/u);

  for (const scenarioId of scenarioIds) {
    assert.match(contract, new RegExp(`"${scenarioId}"`, "u"));
  }

  assert.match(
    preload,
    /async runP285ScenarioForAcceptance\(scenarioId: P285AcceptanceScenarioId\)/u
  );
  assert.match(
    preload,
    /if \(!P2_85_ACCEPTANCE_SCENARIO_IDS\.includes\(scenarioId\)\)\s*\{\s*return false;/su
  );
  assert.match(
    preload,
    /ipcRenderer\.invoke\("pet:p2-85-run-scenario", scenarioId\)/u
  );
  assert.match(preload, /async resetP285AcceptanceBaseline\(\)/u);
  assert.match(preload, /ipcRenderer\.invoke\("pet:p2-85-reset-baseline"\)/u);
  assert.doesNotMatch(
    preload,
    /runP285ScenarioForAcceptance\([^)]*Record<string, unknown>/u
  );
  assert.doesNotMatch(
    preload,
    /runP285ScenarioForAcceptance\([^)]*\{/u
  );
});

test("P2-85 built preload has no shared runtime import and rejects unknown scenarios", async () => {
  const builtPreload = readFileSync("dist/preload/pet-preload.js", "utf8");
  assert.doesNotMatch(
    builtPreload,
    /require\(["']\.\.\/shared\/ipc-contract["']\)/u
  );

  let petApi: {
    runP285ScenarioForAcceptance(scenarioId: string): Promise<boolean>;
  } | undefined;
  const invocations: unknown[][] = [];
  const contextBridge = {
    exposeInMainWorld(name: string, value: unknown) {
      if (name === "petApi") {
        petApi = value as typeof petApi;
      }
    }
  };
  const ipcRenderer = {
    invoke(...args: unknown[]) {
      invocations.push(args);
      return Promise.resolve(true);
    }
  };
  const module = { exports: {} };
  new Function("require", "exports", "module", builtPreload)(
    (id: string) => {
      assert.equal(id, "electron");
      return { contextBridge, ipcRenderer };
    },
    module.exports,
    module
  );

  assert.ok(petApi);
  assert.equal(await petApi.runP285ScenarioForAcceptance("unknown"), false);
  assert.deepEqual(invocations, []);
});

test("P2-85 main hook imports the acceptance controller and keeps the triple gate plus closed diagnostics", () => {
  assert.match(
    app,
    /const isAcceptanceTelemetryEnabled = process\.env\.AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY === "1";/u
  );
  assert.match(
    app,
    /const isP285AcceptanceObservationEnabled = isAcceptanceTelemetryEnabled &&\s*process\.env\.AI_DESKTOP_PET_P2_85_SAFE_OBSERVATION === "1";/su
  );
  assert.match(
    app,
    /const isP285AcceptanceFixtureEnabled = isP285AcceptanceObservationEnabled &&\s*process\.env\.AI_DESKTOP_PET_P2_85_SAFE_FIXTURE === "1";/su
  );
  assert.match(
    app,
    /import \{\s*createP285AcceptanceScenarioController,[\s\S]*type P285AcceptanceScenarioController\s*\} from "\.\/services\/companion-context\/p2-85-acceptance-scenarios";/su
  );
  assert.match(
    app,
    /ipcMain\.handle\("pet:p2-85-run-scenario", \(event, scenarioId: unknown\) => \{/u
  );
  assert.match(app, /!isPetSender\(event\)/u);
  assert.match(app, /!isP285AcceptanceFixtureEnabled/u);
  assert.match(app, /typeof scenarioId !== "string"/u);
  assert.match(
    app,
    /P2_85_ACCEPTANCE_SCENARIO_IDS\.includes\(scenarioId as P285AcceptanceScenarioId\)/u
  );
});

test("P2-85 pre-ready hardware fallback requires all four acceptance gates and stays outside normal startup", () => {
  const hardwareGateMatch = app.match(
    /const isP285HardwareAccelerationDisabledForAcceptance = isP285AcceptanceFixtureEnabled &&\s*process\.env\.AI_DESKTOP_PET_P2_85_DISABLE_HARDWARE_ACCELERATION === "1";/su
  );
  assert.ok(hardwareGateMatch);
  assert.match(app, /AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY === "1"/u);
  assert.match(app, /AI_DESKTOP_PET_P2_85_SAFE_OBSERVATION === "1"/u);
  assert.match(app, /AI_DESKTOP_PET_P2_85_SAFE_FIXTURE === "1"/u);

  const callIndex = app.indexOf("app.disableHardwareAcceleration();");
  const whenReadyIndex = app.indexOf("app.whenReady()");
  const petWindowCreationIndex = app.indexOf("petWindow = createRecoverablePetWindow();");
  const chatWindowCreationIndex = app.indexOf("chatWindow = createChatWindow({");
  assert.ok(callIndex >= 0);
  assert.ok(callIndex < whenReadyIndex);
  assert.ok(callIndex < petWindowCreationIndex);
  assert.ok(callIndex < chatWindowCreationIndex);
  assert.match(
    app,
    /if \(isP285HardwareAccelerationDisabledForAcceptance\) \{\s*app\.disableHardwareAcceleration\(\);\s*\}/su
  );
  assert.equal((app.match(/app\.disableHardwareAcceleration\(\)/gu) ?? []).length, 1);
});

test("P2-85 app retains only gated bridges, lifecycle forwarding, adapters and telemetry", () => {
  const handlerStart = app.indexOf('ipcMain.handle("pet:p2-85-run-scenario"');
  const handlerEnd = app.indexOf('ipcMain.handle("pet:p2-83a-inject-candidate"');
  const handler = app.slice(handlerStart, handlerEnd);

  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  assert.match(handler, /p285AcceptanceScenarioController\?\.runScenario\(acceptedScenarioId\)/u);
  assert.match(handler, /p285AcceptanceScenarioController\?\.resetBaseline\(\)/u);
  assert.match(app, /ipcMain\.handle\("pet:p2-85-reset-baseline", async \(event\) => \{/u);
  assert.match(app, /chatWindow\?\.hide\(\);/u);
  assert.match(app, /petActionDispatchCoordinator\?\.cancelActive\(\);/u);
  assert.match(app, /proactiveBubbleCoordinator\?\.clear\(\);/u);
  assert.doesNotMatch(app, /lifecycleEvents/u);
  assert.doesNotMatch(app, /terminalEvent/u);
  assert.doesNotMatch(app, /logTelemetry\(\s*["']pet_interaction_action_(?:started|finished|skipped)["']/u);
  assert.match(app, /ipcMain\.on\("pet:telemetry", \(event, rendererEvent: unknown\) => \{/u);
  assert.match(app, /p285AcceptanceScenarioController\?\.observeRendererActionLifecycle\(/u);
  assert.match(app, /reportDecision\(decision\)\s*\{\s*p285AcceptanceScenarioController\?\.observeProactiveDecision\(decision\);/su);
  assert.match(app, /queueExplicitGameCandidate\(\)\s*\{\s*proactiveBubbleCoordinator\?\.queueSafeCandidateForAcceptance\("explicit_game_started"\);/su);
  assert.match(app, /reportObservation\(observation\)\s*\{\s*logTelemetry\("p2_85_acceptance_observation", observation\);/su);
  assert.doesNotMatch(app, /function startP285ChatOpenedReplaceActiveObservation/u);
  assert.doesNotMatch(app, /function observeP285RendererActionLifecycle/u);
  assert.doesNotMatch(app, /function runP285AcceptanceScenario/u);
  assert.doesNotMatch(handler, /scenarioId ===/u);
});

test("P2-85 closed baseline bridge uses the production chat hide lifecycle", () => {
  const openChatStart = app.indexOf("function openChatWindow(): void");
  const openChatEnd = app.indexOf("function isPetSender", openChatStart);
  const openChat = app.slice(openChatStart, openChatEnd);

  assert.ok(openChatStart >= 0 && openChatEnd > openChatStart);
  assert.match(openChat, /sendPetActionTrigger\("chat_opened", \{ supersessionPolicy: "replace_active" \}\);/u);
  assert.doesNotMatch(openChat, /petActionDispatchCoordinator\?\.reset\(\)/u);
  assert.match(app, /async resetLiveBaseline\(\)\s*\{[\s\S]*chatWindow\?\.once\("hide", resolve\);[\s\S]*setImmediate\(resolve\)[\s\S]*return !isChatVisible\(\)/u);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isClientPointInsideVisibleBubble } from "../src/renderer/pet/proactive-bubble-pointer-hit.ts";
import { isScreenPointInOverlayHitRegion } from "../src/main/services/overlay-hit-region.ts";
import { parsePetRendererTelemetryEvent, parsePetTelemetryEvent } from "../src/shared/pet-telemetry-contract.ts";

const rendererSource = readFileSync("src/renderer/pet/main.ts", "utf8");
const pointerControllerSource = readFileSync("src/main/services/pointer-controller.ts", "utf8");
const preloadSource = readFileSync("src/preload/pet-preload.ts", "utf8");
const appSource = readFileSync("src/main/app.ts", "utf8");

test("forwarded client movement uses the visible bubble rectangle", () => {
  const rect = { left: 10, top: 20, right: 110, bottom: 70 };
  assert.equal(isClientPointInsideVisibleBubble(10, 20, rect, true), true);
  assert.equal(isClientPointInsideVisibleBubble(110, 70, rect, true), true);
  assert.equal(isClientPointInsideVisibleBubble(9, 40, rect, true), false);
  assert.equal(isClientPointInsideVisibleBubble(40, 40, rect, false), false);
  assert.equal(isClientPointInsideVisibleBubble(Number.NaN, 40, rect, true), false);
});

test("renderer listens globally, clears on lifecycle exits, and deduplicates IPC", () => {
  assert.match(rendererSource, /window\.addEventListener\("mousemove",[\s\S]*updateBubblePointerHit/);
  assert.match(rendererSource, /window\.addEventListener\("pointermove",[\s\S]*updateBubblePointerHit/);
  assert.match(rendererSource, /window\.addEventListener\("blur", clearBubblePointerHit\)/);
  assert.match(rendererSource, /document\.addEventListener\("mouseleave", clearBubblePointerHit\)/);
  assert.match(rendererSource, /proactiveSpeechBubble\.addEventListener\("pointerenter"/);
  assert.match(rendererSource, /if \(nextIsHit === isBubblePointerHit\) \{\s*return;/);
  assert.match(pointerControllerSource, /if \(nextIsHit === isOverlayHit\) \{\s*return;/);
});

test("main poll converts screen coordinates into the local overlay region", () => {
  const region = { left: 10, top: 20, right: 110, bottom: 70 };
  const bounds = { x: 500, y: 300 };
  assert.equal(isScreenPointInOverlayHitRegion({ x: 510, y: 320 }, bounds, region), true);
  assert.equal(isScreenPointInOverlayHitRegion({ x: 610, y: 370 }, bounds, region), true);
  assert.equal(isScreenPointInOverlayHitRegion({ x: 509, y: 340 }, bounds, region), false);
  assert.equal(isScreenPointInOverlayHitRegion({ x: 550, y: 340 }, bounds, null), false);
});

test("renderer publishes a stable region and clears it on hide and resize lifecycle", () => {
  assert.match(rendererSource, /requestAnimationFrame\(\(\) => \{[\s\S]*requestAnimationFrame/);
  assert.match(rendererSource, /getBoundingClientRect\(\)[\s\S]*setBubbleHitRegion\(\{[\s\S]*left: rect\.left/);
  assert.match(rendererSource, /function clearProactiveSpeechBubble\(\)[\s\S]*setBubbleHitRegion\(null\)/);
  assert.match(rendererSource, /window\.addEventListener\("resize",[\s\S]*scheduleBubbleHitRegionUpdate\(\)/);
  assert.doesNotMatch(rendererSource, /reportTelemetry\("proactive_bubble_overlay_hit_changed"/);
});

test("preload and main keep the overlay region IPC closed and bounded", () => {
  assert.match(preloadSource, /Object\.keys\(region\)\.length !== 4/);
  assert.match(preloadSource, /Number\.isFinite\(item\) && item >= 0/);
  assert.match(preloadSource, /region\.right! <= region\.left!/);
  assert.match(preloadSource, /ipcRenderer\.send\("pet:bubble-hit-region-change", parsed\)/);
  assert.match(appSource, /ipcMain\.on\("pet:bubble-hit-region-change"/);
  assert.match(appSource, /if \(!isPetSender\(event\) \|\| !petWindow \|\| petWindow\.isDestroyed\(\)\)/);
  assert.match(appSource, /petWindow\.getContentSize\(\)/);
  assert.match(appSource, /region\.right! > contentWidth \|\| region\.bottom! > contentHeight/);
  assert.match(appSource, /pointerController\?\.setOverlayHitRegion\(region\)/);
  assert.match(appSource, /proactive_bubble_overlay_region_changed/);
  assert.match(appSource, /regionState: region \? "registered" : "rejected"/);
  assert.match(appSource, /regionState: "cleared"/);
  assert.match(appSource, /authority: "main"/);
  assert.doesNotMatch(appSource, /proactive_bubble_overlay_region_changed", \{[\s\S]{0,180}(rect|left|top|right|bottom|width|height)/);
});

test("pointer controller polls the authoritative region independently from renderer hover", () => {
  assert.match(pointerControllerSource, /POINTER_POLL_INTERVAL_MS = 50/);
  assert.match(pointerControllerSource, /setOverlayHitRegion\(region: PetOverlayHitRegion \| null\)/);
  assert.match(pointerControllerSource, /screen\.getCursorScreenPoint\(\)/);
  assert.match(pointerControllerSource, /isScreenPointInOverlayHitRegion\(cursor, bounds, overlayHitRegion\)/);
  assert.match(pointerControllerSource, /onOverlayRegionHitChanged\?\.\(nextIsHit\)/);
  assert.match(appSource, /onOverlayRegionHitChanged: \(isHit\) =>/);
  assert.match(appSource, /overlayHitAuthority: "main_poll"/);
});

test("main overlay hit diagnostic keeps only authority and state enums", () => {
  assert.deepEqual(parsePetTelemetryEvent({
    type: "proactive_bubble_overlay_hit_changed",
    payload: { overlayHitState: "active", overlayHitAuthority: "main_poll", clientX: 40, text: "private" }
  }), {
    type: "proactive_bubble_overlay_hit_changed",
    payload: { overlayHitState: "active", overlayHitAuthority: "main_poll" }
  });
  assert.equal(parsePetRendererTelemetryEvent({
    type: "proactive_bubble_overlay_hit_changed",
    payload: { overlayHitState: "active", overlayHitAuthority: "main_poll" }
  }), null);
  assert.deepEqual(parsePetTelemetryEvent({
    type: "proactive_bubble_overlay_hit_changed",
    payload: { overlayHitState: "unknown", overlayHitAuthority: "renderer" }
  }), { type: "proactive_bubble_overlay_hit_changed" });
});

test("main overlay region diagnostic keeps registered cleared rejected as a closed privacy enum", () => {
  for (const regionState of ["registered", "cleared", "rejected"] as const) {
    assert.deepEqual(parsePetTelemetryEvent({
      type: "proactive_bubble_overlay_region_changed",
      payload: {
        regionState,
        authority: "main",
        left: 10,
        top: 20,
        right: 30,
        bottom: 40,
        text: "private"
      }
    }), {
      type: "proactive_bubble_overlay_region_changed",
      payload: { regionState, authority: "main" }
    });
  }
  assert.deepEqual(parsePetTelemetryEvent({
    type: "proactive_bubble_overlay_region_changed",
    payload: { regionState: "unknown", authority: "renderer" }
  }), { type: "proactive_bubble_overlay_region_changed" });
  assert.equal(parsePetRendererTelemetryEvent({
    type: "proactive_bubble_overlay_region_changed",
    payload: { regionState: "registered", authority: "main" }
  }), null);
});

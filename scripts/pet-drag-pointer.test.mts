import assert from "node:assert/strict";
import test from "node:test";
import { getScreenDragDelta, shouldSuppressScaleWheelDuringDrag } from "../src/renderer/pet/drag-pointer.ts";

test("first pointer movement beyond the drag threshold carries its window delta", () => {
  assert.deepEqual(
    getScreenDragDelta(
      { screenX: 240, screenY: 160 },
      { screenX: 310, screenY: 220 }
    ),
    { deltaX: 70, deltaY: 60 }
  );
});

test("drag interaction suppresses scale wheel input while pressed or dragging", () => {
  assert.equal(shouldSuppressScaleWheelDuringDrag({ pointerDown: false, isDragging: false }), false);
  assert.equal(shouldSuppressScaleWheelDuringDrag({ pointerDown: true, isDragging: false }), true);
  assert.equal(shouldSuppressScaleWheelDuringDrag({ pointerDown: false, isDragging: true }), true);
});

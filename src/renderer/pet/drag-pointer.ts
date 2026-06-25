import type { PetDragDelta } from "../../shared/ipc-contract";

export type ScreenPoint = {
  screenX: number;
  screenY: number;
};

export function getScreenDragDelta(previous: ScreenPoint, current: ScreenPoint): PetDragDelta {
  return {
    deltaX: current.screenX - previous.screenX,
    deltaY: current.screenY - previous.screenY
  };
}

export function shouldSuppressScaleWheelDuringDrag(state: { pointerDown: boolean; isDragging: boolean }): boolean {
  return state.pointerDown || state.isDragging;
}

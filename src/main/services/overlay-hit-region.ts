import type { PetOverlayHitRegion } from "../../shared/ipc-contract";

type ScreenPoint = { x: number; y: number };
type WindowBounds = { x: number; y: number };

export function isScreenPointInOverlayHitRegion(
  cursor: ScreenPoint,
  windowBounds: WindowBounds,
  region: PetOverlayHitRegion | null
): boolean {
  if (!region) {
    return false;
  }
  const clientX = cursor.x - windowBounds.x;
  const clientY = cursor.y - windowBounds.y;
  return clientX >= region.left && clientX <= region.right &&
    clientY >= region.top && clientY <= region.bottom;
}

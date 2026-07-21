export type ClientRectLike = Pick<DOMRect, "left" | "top" | "right" | "bottom">;

export function isClientPointInsideVisibleBubble(
  clientX: number,
  clientY: number,
  rect: ClientRectLike,
  isVisible: boolean
): boolean {
  return isVisible &&
    Number.isFinite(clientX) &&
    Number.isFinite(clientY) &&
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom;
}

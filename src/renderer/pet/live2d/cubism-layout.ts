export type CubismModelBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
};

export type CubismFitLayout = {
  scale: number;
  translateX: number;
  translateY: number;
};

export type CubismProjectionViewSize = {
  width: number;
  height: number;
};

type DrawableBoundsModel = {
  getCanvasWidth(): number;
  getCanvasHeight(): number;
  getDrawableCount(): number;
  getDrawableVertexCount(drawableIndex: number): number;
  getDrawableVertices(drawableIndex: number): Float32Array;
};

const FALLBACK_BOUNDS: CubismModelBounds = {
  minX: -1,
  maxX: 1,
  minY: -1,
  maxY: 1,
  width: 2,
  height: 2
};

const PADDING_RATIO = 0.1;

export function calculateCubismModelBounds(model: DrawableBoundsModel): CubismModelBounds {
  const drawableBounds = calculateDrawableBounds(model);

  if (drawableBounds) {
    return drawableBounds;
  }

  const canvasWidth = model.getCanvasWidth();
  const canvasHeight = model.getCanvasHeight();

  if (isPositiveFinite(canvasWidth) && isPositiveFinite(canvasHeight)) {
    return {
      minX: -canvasWidth / 2,
      maxX: canvasWidth / 2,
      minY: -canvasHeight / 2,
      maxY: canvasHeight / 2,
      width: canvasWidth,
      height: canvasHeight
    };
  }

  console.warn("[pet-live2d-layout] failed to calculate model bounds; using fallback");
  return FALLBACK_BOUNDS;
}

export function calculateCubismFitLayout(
  bounds: CubismModelBounds,
  canvasWidth: number,
  canvasHeight: number
): CubismFitLayout {
  if (!isPositiveFinite(bounds.width) || !isPositiveFinite(bounds.height)) {
    return calculateCubismFitLayout(FALLBACK_BOUNDS, canvasWidth, canvasHeight);
  }

  const viewSize = getProjectionViewSize(canvasWidth, canvasHeight);
  const availableWidth = viewSize.width * (1 - PADDING_RATIO * 2);
  const availableHeight = viewSize.height * (1 - PADDING_RATIO * 2);
  const scale = Math.min(availableWidth / bounds.width, availableHeight / bounds.height);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  const fit = {
    scale,
    translateX: -centerX * scale,
    translateY: -centerY * scale
  };

  if (!isPositiveFinite(viewSize.width) || !isPositiveFinite(viewSize.height) || !isPositiveFinite(fit.scale)) {
    return {
      scale: 0.8,
      translateX: 0,
      translateY: 0
    };
  }

  return fit;
}

function calculateDrawableBounds(model: DrawableBoundsModel): CubismModelBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const drawableCount = model.getDrawableCount();

  for (let drawableIndex = 0; drawableIndex < drawableCount; drawableIndex += 1) {
    const vertexCount = model.getDrawableVertexCount(drawableIndex);
    const vertices = model.getDrawableVertices(drawableIndex);

    for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
      const x = vertices[vertexIndex * 2];
      const y = vertices[vertexIndex * 2 + 1];

      if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
        continue;
      }

      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }

  const width = maxX - minX;
  const height = maxY - minY;

  if (!isPositiveFinite(width) || !isPositiveFinite(height)) {
    return null;
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    width,
    height
  };
}

export function getProjectionViewSize(canvasWidth: number, canvasHeight: number): CubismProjectionViewSize {
  if (!isPositiveFinite(canvasWidth) || !isPositiveFinite(canvasHeight)) {
    return {
      width: 2,
      height: 2
    };
  }

  if (canvasWidth > canvasHeight) {
    return {
      width: 2 * (canvasWidth / canvasHeight),
      height: 2
    };
  }

  return {
    width: 2,
    height: 2 * (canvasHeight / canvasWidth)
  };
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

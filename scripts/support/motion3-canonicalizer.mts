type JsonRecord = Record<string, unknown>;

const SEGMENT_LENGTHS = [3, 7, 3, 3] as const;
const ROOT_FIELDS = new Set(["Version", "Meta", "Curves", "UserData"]);
const META_FIELDS = new Set([
  "Duration",
  "Fps",
  "Loop",
  "AreBeziersRestricted",
  "CurveCount",
  "TotalSegmentCount",
  "TotalPointCount",
  "UserDataCount",
  "TotalUserDataSize",
  "FadeInTime",
  "FadeOutTime"
]);
const CURVE_FIELDS = new Set(["Target", "Id", "Segments", "FadeInTime", "FadeOutTime"]);

export type Motion3CanonicalizerBlocker =
  | "invalid-candidate"
  | "invalid-version"
  | "unsupported-motion-field"
  | "invalid-meta"
  | "unsupported-meta-field"
  | "source-meta-count-mismatch"
  | "invalid-duration"
  | "invalid-fps"
  | "invalid-curves"
  | "invalid-curve"
  | "unsupported-curve-field"
  | "invalid-segments"
  | "invalid-segment-time"
  | "unsupported-curve-target"
  | "invalid-parameter-id"
  | "unknown-parameter-id"
  | "duplicate-parameter-id"
  | "non-empty-user-data"
  | "invalid-model-parameter-ids"
  | "invalid-allowlist"
  | "allowlist-id-not-known"
  | "allowlist-id-not-present"
  | "canonical-consistency-check-failed";

const BLOCKER_ORDER: readonly Motion3CanonicalizerBlocker[] = [
  "invalid-candidate",
  "invalid-version",
  "unsupported-motion-field",
  "invalid-meta",
  "unsupported-meta-field",
  "source-meta-count-mismatch",
  "invalid-duration",
  "invalid-fps",
  "invalid-curves",
  "invalid-curve",
  "unsupported-curve-field",
  "invalid-segments",
  "invalid-segment-time",
  "unsupported-curve-target",
  "invalid-parameter-id",
  "unknown-parameter-id",
  "duplicate-parameter-id",
  "non-empty-user-data",
  "invalid-model-parameter-ids",
  "invalid-allowlist",
  "allowlist-id-not-known",
  "allowlist-id-not-present",
  "canonical-consistency-check-failed"
];

export type Motion3SegmentSummary = {
  segmentCount: number;
  pointCount: number;
  validEncoding: boolean;
  validTime: boolean;
};

export type CanonicalMotion3 = {
  Version: 3;
  Meta: {
    Duration: number;
    Fps: number;
    Loop: false;
    AreBeziersRestricted: boolean;
    CurveCount: number;
    TotalSegmentCount: number;
    TotalPointCount: number;
    UserDataCount: 0;
    TotalUserDataSize: 0;
    FadeInTime?: number;
    FadeOutTime?: number;
  };
  Curves: Array<{
    Target: "Parameter";
    Id: string;
    Segments: number[];
    FadeInTime?: number;
    FadeOutTime?: number;
  }>;
  UserData: [];
};

export type Motion3CanonicalizerSummary = {
  safeSummaryOnly: true;
  status: "blocked" | "canonicalized";
  sourceVersion: number | null;
  outputVersion: 3 | null;
  sourceCurveCount: number;
  sourceSegmentCount: number;
  sourcePointCount: number;
  retainedCurveCount: number;
  retainedSegmentCount: number;
  retainedPointCount: number;
  consistencyCheck: boolean;
  blockers: Motion3CanonicalizerBlocker[];
};

export type Motion3CanonicalizerResult =
  | { status: "blocked"; summary: Motion3CanonicalizerSummary }
  | { status: "canonicalized"; motion: CanonicalMotion3; summary: Motion3CanonicalizerSummary };

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function hasOnlyFields(value: JsonRecord, fields: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => fields.has(key));
}

function isOptionalNonNegativeNumber(value: unknown): boolean {
  return value === undefined || isFiniteNumber(value) && value >= 0;
}

export function parseMotion3Segments(value: unknown, durationSeconds: number): Motion3SegmentSummary {
  if (!Array.isArray(value) || value.length < 5) {
    return { segmentCount: 0, pointCount: 0, validEncoding: false, validTime: false };
  }

  if (!value.every(isFiniteNumber)) {
    return { segmentCount: 0, pointCount: 0, validEncoding: false, validTime: false };
  }

  const values = value as number[];
  let previousTime = values[0];
  let segmentCount = 0;
  let pointCount = 1;
  let validEncoding = true;
  let validTime = (
    isFiniteNumber(durationSeconds) &&
    durationSeconds > 0 &&
    previousTime >= 0 &&
    previousTime <= durationSeconds
  );
  let cursor = 2;

  while (cursor < values.length) {
    const segmentType = values[cursor];
    const segmentLength = Number.isInteger(segmentType)
      ? SEGMENT_LENGTHS[segmentType as 0 | 1 | 2 | 3]
      : undefined;

    if (segmentLength === undefined || cursor + segmentLength > values.length) {
      validEncoding = false;
      break;
    }

    for (let pointOffset = 1; pointOffset < segmentLength; pointOffset += 2) {
      const time = values[cursor + pointOffset];

      if (time < previousTime || time < 0 || time > durationSeconds) {
        validTime = false;
      }

      previousTime = time;
      pointCount += 1;
    }

    segmentCount += 1;
    cursor += segmentLength;
  }

  if (cursor !== values.length) {
    validEncoding = false;
  }

  return { segmentCount, pointCount, validEncoding, validTime };
}

function addInvalidStringListBlockers(
  value: unknown,
  invalidBlocker: Motion3CanonicalizerBlocker,
  blockers: Set<Motion3CanonicalizerBlocker>
): Set<string> | null {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || item.length === 0) ||
    new Set(value).size !== value.length
  ) {
    blockers.add(invalidBlocker);
    return null;
  }

  return new Set(value as string[]);
}

function createSummary(
  status: Motion3CanonicalizerSummary["status"],
  sourceVersion: number | null,
  sourceCurveCount: number,
  sourceSegmentCount: number,
  sourcePointCount: number,
  retainedCurveCount: number,
  retainedSegmentCount: number,
  retainedPointCount: number,
  consistencyCheck: boolean,
  blockers: Set<Motion3CanonicalizerBlocker>
): Motion3CanonicalizerSummary {
  return {
    safeSummaryOnly: true,
    status,
    sourceVersion,
    outputVersion: status === "canonicalized" ? 3 : null,
    sourceCurveCount,
    sourceSegmentCount,
    sourcePointCount,
    retainedCurveCount,
    retainedSegmentCount,
    retainedPointCount,
    consistencyCheck,
    blockers: BLOCKER_ORDER.filter((blocker) => blockers.has(blocker))
  };
}

function hasValidMetaShape(meta: JsonRecord): boolean {
  return (
    typeof meta.Loop === "boolean" &&
    typeof meta.AreBeziersRestricted === "boolean" &&
    isNonNegativeInteger(meta.CurveCount) &&
    isNonNegativeInteger(meta.TotalSegmentCount) &&
    isNonNegativeInteger(meta.TotalPointCount) &&
    isNonNegativeInteger(meta.UserDataCount) &&
    isNonNegativeInteger(meta.TotalUserDataSize) &&
    isOptionalNonNegativeNumber(meta.FadeInTime) &&
    isOptionalNonNegativeNumber(meta.FadeOutTime)
  );
}

function hasCubismCountConsistency(motion: CanonicalMotion3): boolean {
  let segmentCount = 0;
  let pointCount = 0;

  for (const curve of motion.Curves) {
    const values = curve.Segments;
    let cursor = 2;
    pointCount += 1;

    while (cursor < values.length) {
      const segmentLength = SEGMENT_LENGTHS[values[cursor] as 0 | 1 | 2 | 3];

      if (segmentLength === undefined || cursor + segmentLength > values.length) {
        return false;
      }

      segmentCount += 1;
      pointCount += (segmentLength - 1) / 2;
      cursor += segmentLength;
    }

    if (cursor !== values.length) {
      return false;
    }
  }

  return (
    motion.Meta.CurveCount === motion.Curves.length &&
    motion.Meta.TotalSegmentCount === segmentCount &&
    motion.Meta.TotalPointCount === pointCount
  );
}

export function canonicalizeMotion3(
  candidate: unknown,
  modelParameterIds: unknown,
  semanticAllowlist: unknown
): Motion3CanonicalizerResult {
  const blockers = new Set<Motion3CanonicalizerBlocker>();
  const modelIds = addInvalidStringListBlockers(
    modelParameterIds,
    "invalid-model-parameter-ids",
    blockers
  );
  const allowlist = addInvalidStringListBlockers(semanticAllowlist, "invalid-allowlist", blockers);

  if (!isRecord(candidate)) {
    blockers.add("invalid-candidate");
    return { status: "blocked", summary: createSummary("blocked", null, 0, 0, 0, 0, 0, 0, false, blockers) };
  }

  const sourceVersion = isFiniteNumber(candidate.Version) ? candidate.Version : null;

  if (candidate.Version !== 0) {
    blockers.add("invalid-version");
  }

  if (!hasOnlyFields(candidate, ROOT_FIELDS)) {
    blockers.add("unsupported-motion-field");
  }

  const meta = isRecord(candidate.Meta) ? candidate.Meta : null;
  const curves = Array.isArray(candidate.Curves) ? candidate.Curves : null;

  if (!meta) {
    blockers.add("invalid-meta");
  } else {
    if (!hasOnlyFields(meta, META_FIELDS)) {
      blockers.add("unsupported-meta-field");
    }
    if (!hasValidMetaShape(meta)) {
      blockers.add("invalid-meta");
    }
    if (!isFiniteNumber(meta.Duration) || meta.Duration <= 0) {
      blockers.add("invalid-duration");
    }
    if (!isFiniteNumber(meta.Fps) || meta.Fps <= 0) {
      blockers.add("invalid-fps");
    }
  }

  if (!curves || curves.length === 0) {
    blockers.add("invalid-curves");
  }

  const userData = candidate.UserData;
  if (
    userData !== undefined && (!Array.isArray(userData) || userData.length > 0) ||
    meta && (meta.UserDataCount !== 0 || meta.TotalUserDataSize !== 0)
  ) {
    blockers.add("non-empty-user-data");
  }

  if (allowlist && modelIds) {
    for (const id of allowlist) {
      if (!modelIds.has(id)) {
        blockers.add("allowlist-id-not-known");
      }
    }
  }

  const durationSeconds = meta && isFiniteNumber(meta.Duration) && meta.Duration > 0
    ? meta.Duration
    : null;
  const parsedCurves: Array<{
    curve: JsonRecord;
    segmentSummary: Motion3SegmentSummary;
  }> = [];
  let sourceSegmentCount = 0;
  let sourcePointCount = 0;

  if (curves) {
    // Parse every source curve before any semantic allowlist filtering.
    for (const value of curves) {
      if (!isRecord(value)) {
        blockers.add("invalid-curve");
        continue;
      }

      if (!hasOnlyFields(value, CURVE_FIELDS)) {
        blockers.add("unsupported-curve-field");
      }
      if (!isOptionalNonNegativeNumber(value.FadeInTime) || !isOptionalNonNegativeNumber(value.FadeOutTime)) {
        blockers.add("invalid-curve");
      }

      const segmentSummary = parseMotion3Segments(value.Segments, durationSeconds ?? Number.NaN);
      parsedCurves.push({ curve: value, segmentSummary });
      sourceSegmentCount += segmentSummary.segmentCount;
      sourcePointCount += segmentSummary.pointCount;

      if (!segmentSummary.validEncoding) {
        blockers.add("invalid-segments");
      }
      if (!segmentSummary.validTime) {
        blockers.add("invalid-segment-time");
      }
    }
  }

  if (
    candidate.Version === 0 &&
    meta &&
    curves &&
    isNonNegativeInteger(meta.CurveCount) &&
    isNonNegativeInteger(meta.TotalSegmentCount) &&
    isNonNegativeInteger(meta.TotalPointCount) &&
    (
      meta.CurveCount !== curves.length ||
      meta.TotalSegmentCount !== sourceSegmentCount ||
      meta.TotalPointCount !== sourcePointCount
    )
  ) {
    blockers.add("source-meta-count-mismatch");
  }

  const sourceIds = new Set<string>();
  for (const { curve } of parsedCurves) {
    if (curve.Target !== "Parameter") {
      blockers.add("unsupported-curve-target");
    }
    if (typeof curve.Id !== "string" || curve.Id.length === 0) {
      blockers.add("invalid-parameter-id");
      continue;
    }
    if (sourceIds.has(curve.Id)) {
      blockers.add("duplicate-parameter-id");
    }
    sourceIds.add(curve.Id);
    if (modelIds && !modelIds.has(curve.Id)) {
      blockers.add("unknown-parameter-id");
    }
  }

  if (allowlist) {
    for (const id of allowlist) {
      if (!sourceIds.has(id)) {
        blockers.add("allowlist-id-not-present");
      }
    }
  }

  if (blockers.size > 0 || !meta || !curves || !modelIds || !allowlist || durationSeconds === null) {
    return {
      status: "blocked",
      summary: createSummary(
        "blocked",
        sourceVersion,
        curves?.length ?? 0,
        sourceSegmentCount,
        sourcePointCount,
        0,
        0,
        0,
        false,
        blockers
      )
    };
  }

  const retained = parsedCurves.filter(({ curve }) => allowlist.has(curve.Id as string));
  const retainedSegmentCount = retained.reduce((count, item) => count + item.segmentSummary.segmentCount, 0);
  const retainedPointCount = retained.reduce((count, item) => count + item.segmentSummary.pointCount, 0);
  const outputMeta: CanonicalMotion3["Meta"] = {
    Duration: durationSeconds,
    Fps: meta.Fps as number,
    Loop: false,
    AreBeziersRestricted: meta.AreBeziersRestricted as boolean,
    CurveCount: retained.length,
    TotalSegmentCount: retainedSegmentCount,
    TotalPointCount: retainedPointCount,
    UserDataCount: 0,
    TotalUserDataSize: 0
  };

  if (meta.FadeInTime !== undefined) outputMeta.FadeInTime = meta.FadeInTime as number;
  if (meta.FadeOutTime !== undefined) outputMeta.FadeOutTime = meta.FadeOutTime as number;

  const motion: CanonicalMotion3 = {
    Version: 3,
    Meta: outputMeta,
    Curves: retained.map(({ curve }) => {
      const outputCurve: CanonicalMotion3["Curves"][number] = {
        Target: "Parameter",
        Id: curve.Id as string,
        Segments: [...curve.Segments as number[]]
      };
      if (curve.FadeInTime !== undefined) outputCurve.FadeInTime = curve.FadeInTime as number;
      if (curve.FadeOutTime !== undefined) outputCurve.FadeOutTime = curve.FadeOutTime as number;
      return outputCurve;
    }),
    UserData: []
  };

  const reparsed = motion.Curves.map((curve) => parseMotion3Segments(curve.Segments, motion.Meta.Duration));
  const consistencyCheck = (
    reparsed.every((summary) => summary.validEncoding && summary.validTime) &&
    reparsed.reduce((count, summary) => count + summary.segmentCount, 0) === motion.Meta.TotalSegmentCount &&
    reparsed.reduce((count, summary) => count + summary.pointCount, 0) === motion.Meta.TotalPointCount &&
    hasCubismCountConsistency(motion)
  );

  if (!consistencyCheck) {
    blockers.add("canonical-consistency-check-failed");
    return {
      status: "blocked",
      summary: createSummary(
        "blocked",
        sourceVersion,
        curves.length,
        sourceSegmentCount,
        sourcePointCount,
        retained.length,
        retainedSegmentCount,
        retainedPointCount,
        false,
        blockers
      )
    };
  }

  return {
    status: "canonicalized",
    motion,
    summary: createSummary(
      "canonicalized",
      sourceVersion,
      curves.length,
      sourceSegmentCount,
      sourcePointCount,
      retained.length,
      retainedSegmentCount,
      retainedPointCount,
      true,
      blockers
    )
  };
}

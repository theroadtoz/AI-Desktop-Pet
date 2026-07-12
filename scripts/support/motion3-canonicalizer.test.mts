import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  canonicalizeMotion3,
  parseMotion3Segments
} from "./motion3-canonicalizer.mts";

const ALLOWLIST = [
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

function validCandidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Version: 0,
    Meta: {
      Duration: 1.8,
      Fps: 60,
      Loop: true,
      AreBeziersRestricted: false,
      CurveCount: 1,
      TotalSegmentCount: 1,
      TotalPointCount: 2,
      UserDataCount: 0,
      TotalUserDataSize: 0
    },
    Curves: [
      {
        Target: "Parameter",
        Id: "ParamAngleX",
        Segments: [0, 1000, 0, 1.8, -1000]
      }
    ],
    ...overrides
  };
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

test("canonicalizer blocks the current yawn fixture's inconsistent source Meta without mutating it", () => {
  const repositoryRoot = resolve(import.meta.dirname, "..", "..");
  const candidate = readJson(resolve(repositoryRoot, "model", "yawn.motion3.json"));
  const displayInfo = readJson(resolve(repositoryRoot, "model", "魔女.cdi3.json"));
  const modelParameterIds = (displayInfo.Parameters as Array<{ Id: string }>).map(({ Id }) => Id);
  const before = JSON.stringify(candidate);

  const result = canonicalizeMotion3(candidate, modelParameterIds, ALLOWLIST);

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.summary, {
    safeSummaryOnly: true,
    status: "blocked",
    sourceVersion: 0,
    outputVersion: null,
    sourceCurveCount: 237,
    sourceSegmentCount: 3361,
    sourcePointCount: 10320,
    retainedCurveCount: 0,
    retainedSegmentCount: 0,
    retainedPointCount: 0,
    consistencyCheck: false,
    blockers: ["source-meta-count-mismatch"]
  });
  assert.equal(JSON.stringify(candidate), before);
});

test("strict parser completely consumes all four Cubism segment encodings", () => {
  const summary = parseMotion3Segments([
    0, 0,
    1, 0.2, 1, 0.4, 2, 0.6, 3,
    2, 0.8, 4,
    3, 1, 5,
    0, 1.8, 6
  ], 1.8);

  assert.deepEqual(summary, {
    segmentCount: 4,
    pointCount: 7,
    validEncoding: true,
    validTime: true
  });
  assert.deepEqual(parseMotion3Segments([0, 0, 0, 1, 1], Number.NaN), {
    segmentCount: 1,
    pointCount: 2,
    validEncoding: true,
    validTime: false
  });
});

test("canonicalizer preserves finite parameter values without clamping", () => {
  const result = canonicalizeMotion3(validCandidate(), ["ParamAngleX"], ["ParamAngleX"]);

  assert.equal(result.status, "canonicalized");
  if (result.status === "canonicalized") {
    assert.deepEqual(result.motion.Curves[0].Segments, [0, 1000, 0, 1.8, -1000]);
  }
});

test("canonicalizer blocks each inconsistent source Meta count before canonicalization", () => {
  const countFields = [
    "CurveCount",
    "TotalSegmentCount",
    "TotalPointCount"
  ] as const;

  for (const field of countFields) {
    const candidate = validCandidate();
    candidate.Meta = {
      ...(candidate.Meta as Record<string, unknown>),
      [field]: 999
    };

    const result = canonicalizeMotion3(candidate, ["ParamAngleX"], ["ParamAngleX"]);

    assert.equal(result.status, "blocked", field);
    assert.deepEqual(result.summary.blockers, ["source-meta-count-mismatch"], field);
    assert.equal(result.summary.outputVersion, null, field);
  }
});

test("canonicalizer rejects non-Version-0 input and unsupported fields", () => {
  const wrongVersion = canonicalizeMotion3(
    validCandidate({ Version: 3 }),
    ["ParamAngleX"],
    ["ParamAngleX"]
  );
  const unknownRootField = canonicalizeMotion3(
    validCandidate({ SourcePath: "private.motion3.json" }),
    ["ParamAngleX"],
    ["ParamAngleX"]
  );

  assert.deepEqual(wrongVersion.summary.blockers, ["invalid-version"]);
  assert.deepEqual(unknownRootField.summary.blockers, ["unsupported-motion-field"]);
  assert.equal(JSON.stringify(unknownRootField.summary).includes("private"), false);
});

test("canonicalizer strictly parses every source curve before allowlist filtering", () => {
  const candidate = validCandidate();
  candidate.Meta = {
    ...(candidate.Meta as Record<string, unknown>),
    CurveCount: 2,
    TotalSegmentCount: 2,
    TotalPointCount: 4
  };
  candidate.Curves = [
    ...(candidate.Curves as unknown[]),
    {
      Target: "Parameter",
      Id: "ParamEyeLOpen",
      Segments: [0, 1]
    }
  ];

  const result = canonicalizeMotion3(
    candidate,
    ["ParamAngleX", "ParamEyeLOpen"],
    ["ParamAngleX"]
  );

  assert.equal(result.status, "blocked");
  assert.equal(result.summary.blockers.includes("invalid-segments"), true);
});

test("strict parser rejects missing, malformed, non-finite, and invalid-time segments", () => {
  const cases: Array<[unknown, "invalid-segments" | "invalid-segment-time"]> = [
    [[0, 0], "invalid-segments"],
    [[0, 0, 1, 0.2, 1], "invalid-segments"],
    [[0, 0, 9, 1.8, 1], "invalid-segments"],
    [[0, 0, 0, 1.8, Number.POSITIVE_INFINITY], "invalid-segments"],
    [[-0.1, 0, 0, 1.8, 1], "invalid-segment-time"],
    [[0, 0, 0, 1.2, 1, 0, 0.8, 2], "invalid-segment-time"],
    [[0, 0, 0, 1.81, 1], "invalid-segment-time"]
  ];

  for (const [Segments, blocker] of cases) {
    const result = canonicalizeMotion3(
      validCandidate({
        Curves: [{ Target: "Parameter", Id: "ParamAngleX", Segments }]
      }),
      ["ParamAngleX"],
      ["ParamAngleX"]
    );
    assert.equal(result.summary.blockers.includes(blocker), true);
  }
});

test("canonicalizer validates Parameter targets, known IDs, and duplicate IDs", () => {
  const unsupportedTarget = canonicalizeMotion3(
    validCandidate({ Curves: [{ Target: "Model", Id: "ParamAngleX", Segments: [0, 0, 0, 1.8, 1] }] }),
    ["ParamAngleX"],
    ["ParamAngleX"]
  );
  const unknownId = canonicalizeMotion3(validCandidate(), ["ParamEyeLOpen"], ["ParamEyeLOpen"]);
  const duplicateCandidate = validCandidate({
    Curves: [
      { Target: "Parameter", Id: "ParamAngleX", Segments: [0, 0, 0, 1.8, 1] },
      { Target: "Parameter", Id: "ParamAngleX", Segments: [0, 0, 0, 1.8, 2] }
    ]
  });
  duplicateCandidate.Meta = {
    ...(duplicateCandidate.Meta as Record<string, unknown>),
    CurveCount: 2,
    TotalSegmentCount: 2,
    TotalPointCount: 4
  };
  const duplicateId = canonicalizeMotion3(duplicateCandidate, ["ParamAngleX"], ["ParamAngleX"]);

  assert.equal(unsupportedTarget.summary.blockers.includes("unsupported-curve-target"), true);
  assert.equal(unknownId.summary.blockers.includes("unknown-parameter-id"), true);
  assert.equal(duplicateId.summary.blockers.includes("duplicate-parameter-id"), true);
});

test("canonicalizer rejects non-empty UserData and invalid allowlists", () => {
  const withUserData = validCandidate({ UserData: [{ Time: 0, Value: "event" }] });
  withUserData.Meta = {
    ...(withUserData.Meta as Record<string, unknown>),
    UserDataCount: 1,
    TotalUserDataSize: 5
  };

  const nonEmptyUserData = canonicalizeMotion3(withUserData, ["ParamAngleX"], ["ParamAngleX"]);
  const duplicateAllowlist = canonicalizeMotion3(
    validCandidate(),
    ["ParamAngleX"],
    ["ParamAngleX", "ParamAngleX"]
  );
  const unknownAllowlist = canonicalizeMotion3(
    validCandidate(),
    ["ParamAngleX"],
    ["ParamEyeLOpen"]
  );
  const absentAllowlistId = canonicalizeMotion3(
    validCandidate(),
    ["ParamAngleX", "ParamEyeLOpen"],
    ["ParamEyeLOpen"]
  );

  assert.deepEqual(nonEmptyUserData.summary.blockers, ["non-empty-user-data"]);
  assert.deepEqual(duplicateAllowlist.summary.blockers, ["invalid-allowlist"]);
  assert.equal(unknownAllowlist.summary.blockers.includes("allowlist-id-not-known"), true);
  assert.equal(absentAllowlistId.summary.blockers.includes("allowlist-id-not-present"), true);
});

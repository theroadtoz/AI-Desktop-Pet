import {
  CURIOUS_FOCUS_PULSE_PROFILE,
  getCuriousFocusPulseProfileDigest
} from "./p2-88d-curious-low-preview-profile.ts";

export const APPROVED_ATTENTION_MICRO_CUE_PROFILE = Object.freeze({
  schemaVersion: 1,
  id: "attention-micro-cue-v1",
  status: "approved",
  sourceProfileId: CURIOUS_FOCUS_PULSE_PROFILE.id,
  sourceProfileDigest: getCuriousFocusPulseProfileDigest(),
  durationMs: CURIOUS_FOCUS_PULSE_PROFILE.durationMs,
  lookTarget: CURIOUS_FOCUS_PULSE_PROFILE.lookTarget
});

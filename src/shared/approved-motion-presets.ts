import type { ModelMotionPreset } from "./model-manifest";

// Generated from resources/models/witch/model-manifest.json by P2-65.
export const APPROVED_MOTION_PRESETS: readonly ModelMotionPreset[] = Object.freeze(
  [
    {
      "id": "yawn-once",
      "path": "motions/yawn-once.motion3.json",
      "semanticKind": "sleep",
      "loop": false,
      "fadeInSeconds": 0.2,
      "fadeOutSeconds": 0.2,
      "durationHintSeconds": 5.1,
      "priority": 50,
      "cooldownMs": 2000,
      "restorePolicy": "restore-current-state",
      "allowedStates": ["sleep"],
      "allowedPresenceModes": ["sleep"],
      "allowedDialogueModes": ["default"],
      "visualRisk": "needs-visual-check",
      "assetLicenseStatus": "user-provided"
    },
    {
      "id": "happy-small",
      "path": "motions/happy-small.motion3.json",
      "semanticKind": "reaction",
      "loop": false,
      "fadeInSeconds": 0.15,
      "fadeOutSeconds": 0.2,
      "durationHintSeconds": 3,
      "priority": 30,
      "cooldownMs": 2500,
      "restorePolicy": "restore-expression-pose-accessory",
      "allowedStates": ["idle"],
      "allowedPresenceModes": ["default", "focus", "quiet"],
      "allowedDialogueModes": ["default", "work", "game", "reading"],
      "visualRisk": "needs-visual-check",
      "assetLicenseStatus": "user-provided"
    },
    {
      "id": "surprised-small",
      "path": "motions/surprised-small.motion3.json",
      "semanticKind": "reaction",
      "loop": false,
      "fadeInSeconds": 0.15,
      "fadeOutSeconds": 0.2,
      "durationHintSeconds": 2.6,
      "priority": 30,
      "cooldownMs": 2500,
      "restorePolicy": "restore-expression-pose-accessory",
      "allowedStates": ["idle"],
      "allowedPresenceModes": ["default", "focus", "quiet"],
      "allowedDialogueModes": ["default", "work", "game", "reading"],
      "visualRisk": "needs-visual-check",
      "assetLicenseStatus": "user-provided"
    },
    {
      "id": "flustered-small",
      "path": "motions/flustered-small.motion3.json",
      "semanticKind": "reaction",
      "loop": false,
      "fadeInSeconds": 0.15,
      "fadeOutSeconds": 0.2,
      "durationHintSeconds": 3.2,
      "priority": 30,
      "cooldownMs": 2500,
      "restorePolicy": "restore-expression-pose-accessory",
      "allowedStates": ["idle"],
      "allowedPresenceModes": ["default", "focus", "quiet"],
      "allowedDialogueModes": ["default", "work", "game", "reading"],
      "visualRisk": "needs-visual-check",
      "assetLicenseStatus": "user-provided"
    }
  ]
);

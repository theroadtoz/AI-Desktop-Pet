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
    "allowedStates": [
      "sleep"
    ],
    "allowedPresenceModes": [
      "sleep"
    ],
    "allowedDialogueModes": [
      "default"
    ],
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
    "allowedStates": [
      "idle"
    ],
    "allowedPresenceModes": [
      "default",
      "focus",
      "quiet"
    ],
    "allowedDialogueModes": [
      "default",
      "work",
      "game",
      "reading"
    ],
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
    "allowedStates": [
      "idle"
    ],
    "allowedPresenceModes": [
      "default",
      "focus",
      "quiet"
    ],
    "allowedDialogueModes": [
      "default",
      "work",
      "game",
      "reading"
    ],
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
    "allowedStates": [
      "idle"
    ],
    "allowedPresenceModes": [
      "default",
      "focus",
      "quiet"
    ],
    "allowedDialogueModes": [
      "default",
      "work",
      "game",
      "reading"
    ],
    "visualRisk": "needs-visual-check",
    "assetLicenseStatus": "user-provided"
  },
  {
    "id": "head-pat-linger",
    "path": "motions/head-pat-linger.motion3.json",
    "semanticKind": "reaction",
    "loop": false,
    "fadeInSeconds": 0.2,
    "fadeOutSeconds": 0.25,
    "restorePolicy": "restore-expression-pose-accessory",
    "allowedPresenceModes": [
      "default",
      "focus",
      "quiet"
    ],
    "allowedDialogueModes": [
      "default",
      "work",
      "game",
      "reading"
    ],
    "visualRisk": "needs-visual-check",
    "assetLicenseStatus": "user-provided",
    "durationHintSeconds": 6.4,
    "priority": 50,
    "cooldownMs": 20000,
    "allowedStates": [
      "idle"
    ]
  },
  {
    "id": "body-attention-turn",
    "path": "motions/body-attention-turn.motion3.json",
    "semanticKind": "reaction",
    "loop": false,
    "fadeInSeconds": 0.2,
    "fadeOutSeconds": 0.25,
    "restorePolicy": "restore-expression-pose-accessory",
    "allowedPresenceModes": [
      "default",
      "focus",
      "quiet"
    ],
    "allowedDialogueModes": [
      "default",
      "work",
      "game",
      "reading"
    ],
    "visualRisk": "needs-visual-check",
    "assetLicenseStatus": "user-provided",
    "durationHintSeconds": 6.2,
    "priority": 50,
    "cooldownMs": 15000,
    "allowedStates": [
      "idle"
    ]
  },
  {
    "id": "dialogue-open-welcome",
    "path": "motions/dialogue-open-welcome.motion3.json",
    "semanticKind": "greeting",
    "loop": false,
    "fadeInSeconds": 0.2,
    "fadeOutSeconds": 0.25,
    "restorePolicy": "restore-expression-pose-accessory",
    "allowedPresenceModes": [
      "default",
      "focus",
      "quiet"
    ],
    "allowedDialogueModes": [
      "default",
      "work",
      "game",
      "reading"
    ],
    "visualRisk": "needs-visual-check",
    "assetLicenseStatus": "user-provided",
    "durationHintSeconds": 6.4,
    "priority": 40,
    "cooldownMs": 90000,
    "allowedStates": [
      "listen"
    ]
  },
  {
    "id": "reply-warm-settle",
    "path": "motions/reply-warm-settle.motion3.json",
    "semanticKind": "transition",
    "loop": false,
    "fadeInSeconds": 0.2,
    "fadeOutSeconds": 0.25,
    "restorePolicy": "restore-expression-pose-accessory",
    "allowedPresenceModes": [
      "default",
      "focus",
      "quiet"
    ],
    "allowedDialogueModes": [
      "default",
      "work",
      "game",
      "reading"
    ],
    "visualRisk": "needs-visual-check",
    "assetLicenseStatus": "user-provided",
    "durationHintSeconds": 6.2,
    "priority": 35,
    "cooldownMs": 45000,
    "allowedStates": [
      "reply-sustain"
    ]
  },
  {
    "id": "music-listen-sway",
    "path": "motions/music-listen-sway.motion3.json",
    "semanticKind": "idle",
    "loop": false,
    "fadeInSeconds": 0.2,
    "fadeOutSeconds": 0.25,
    "restorePolicy": "restore-expression-pose-accessory",
    "allowedPresenceModes": [
      "default",
      "focus",
      "quiet"
    ],
    "allowedDialogueModes": [
      "default",
      "work",
      "game",
      "reading"
    ],
    "visualRisk": "needs-visual-check",
    "assetLicenseStatus": "user-provided",
    "durationHintSeconds": 8.4,
    "priority": 10,
    "cooldownMs": 1800000,
    "allowedStates": [
      "idle"
    ]
  },
  {
    "id": "game-presence-glance",
    "path": "motions/game-presence-glance.motion3.json",
    "semanticKind": "game",
    "loop": false,
    "fadeInSeconds": 0.2,
    "fadeOutSeconds": 0.25,
    "restorePolicy": "restore-expression-pose-accessory",
    "allowedPresenceModes": [
      "default",
      "focus",
      "quiet"
    ],
    "allowedDialogueModes": [
      "default",
      "work",
      "game",
      "reading"
    ],
    "visualRisk": "needs-visual-check",
    "assetLicenseStatus": "user-provided",
    "durationHintSeconds": 7.2,
    "priority": 15,
    "cooldownMs": 3600000,
    "allowedStates": [
      "game"
    ]
  },
  {
    "id": "search-note-settle",
    "path": "motions/search-note-settle.motion3.json",
    "semanticKind": "reading",
    "loop": false,
    "fadeInSeconds": 0.2,
    "fadeOutSeconds": 0.25,
    "restorePolicy": "restore-expression-pose-accessory",
    "allowedPresenceModes": [
      "default",
      "focus",
      "quiet"
    ],
    "allowedDialogueModes": [
      "default",
      "work",
      "game",
      "reading"
    ],
    "visualRisk": "needs-visual-check",
    "assetLicenseStatus": "user-provided",
    "durationHintSeconds": 6.4,
    "priority": 30,
    "cooldownMs": 60000,
    "allowedStates": [
      "search-cited"
    ]
  },
  {
    "id": "return-from-idle",
    "path": "motions/return-from-idle.motion3.json",
    "semanticKind": "greeting",
    "loop": false,
    "fadeInSeconds": 0.2,
    "fadeOutSeconds": 0.25,
    "restorePolicy": "restore-expression-pose-accessory",
    "allowedPresenceModes": [
      "default",
      "focus",
      "quiet"
    ],
    "allowedDialogueModes": [
      "default",
      "work",
      "game",
      "reading"
    ],
    "visualRisk": "needs-visual-check",
    "assetLicenseStatus": "user-provided",
    "durationHintSeconds": 6.6,
    "priority": 20,
    "cooldownMs": 7200000,
    "allowedStates": [
      "idle"
    ]
  },
  {
    "id": "evening-window-glance",
    "path": "motions/evening-window-glance.motion3.json",
    "semanticKind": "idle",
    "loop": false,
    "fadeInSeconds": 0.2,
    "fadeOutSeconds": 0.25,
    "restorePolicy": "restore-expression-pose-accessory",
    "allowedPresenceModes": [
      "default",
      "focus",
      "quiet"
    ],
    "allowedDialogueModes": [
      "default",
      "work",
      "game",
      "reading"
    ],
    "visualRisk": "needs-visual-check",
    "assetLicenseStatus": "user-provided",
    "durationHintSeconds": 7.8,
    "priority": 5,
    "cooldownMs": 86400000,
    "allowedStates": [
      "idle"
    ]
  },
  {
    "id": "long-work-recovery",
    "path": "motions/long-work-recovery.motion3.json",
    "semanticKind": "transition",
    "loop": false,
    "fadeInSeconds": 0.2,
    "fadeOutSeconds": 0.25,
    "restorePolicy": "restore-expression-pose-accessory",
    "allowedPresenceModes": [
      "default",
      "focus",
      "quiet"
    ],
    "allowedDialogueModes": [
      "default",
      "work",
      "game",
      "reading"
    ],
    "visualRisk": "needs-visual-check",
    "assetLicenseStatus": "user-provided",
    "durationHintSeconds": 7.6,
    "priority": 20,
    "cooldownMs": 14400000,
    "allowedStates": [
      "work"
    ]
  }
]
);

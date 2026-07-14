# Greet Small Profile V1

| 字段 | 固定值 |
| --- | --- |
| `id` / `revision` / `status` | `greet-small` / `v1` / `ready` |
| `label` / `templateKind` | `轻量问候` / `gesture.one-shot` |
| `fps` / `draftLoop` | `30` / `false` |
| `capture_duration` | `2.0s`（固定） |
| `padding` / `motion_duration` | start `0.2s` + end `0.2s` / `2.4s` |
| `draft.intent` / `productionLoopCandidate` | `one-shot-draft` / `false` |
| `outputPrefix` | `greet-small` |
| `parameterOwnership` | `approved-greet-small-face-tracked-nod-smile` |
| `gates.endpoint` / `gates.seam` | `not-required` / `not-required` |
| `semanticAliases` | `[]` |

## Allowlist And Ownership

只允许以下 10 项，CurrentModel 参数表缺少任一项即阻塞，不得静默删减或扩大：

```text
ParamAngleX
ParamAngleY
ParamAngleZ
ParamEyeLOpen
ParamEyeROpen
ParamEyeLSmile
ParamEyeRSmile
ParamBrowLY
ParamBrowLForm
ParamMouthForm
```

只允许摄像头面捕驱动上述参数。明确排除 `Param28`、`Param30`、所有手部专属参数、所有 `ParamBodyAngle*`、眼球注视参数、`ParamBreath`、`ParamMouthOpenY`、voice/lip-sync 参数、physics destination、配件、服装、发型和任何未列参数。

## Profile Gates

- arm 前确认摄像头面捕已启用，并确认当前模型身份、能力快照和完整 10 项 allowlist 与 take contract 一致。
- 倒数显示 `开始` 后：从中性姿态开始，轻柔向下点头，不做大幅左右摆头；抬回时保持闭口微笑、眉眼放松；自然回到中性基线。
- 固定采集 `2.0s`，并保留前后各 `0.2s` padding；预期 Motion3 `Meta.Duration=2.4s`、`Loop=false`。
- VTube Studio 只读采样；不要按动画热键，不要触发 `HotkeyTriggerRequest`，不要播放或重采样 `Scene1.motion3.json`。
- 结果始终是 one-shot draft。parser、人工视觉、Cubism Animator 精修和具体 production intake 批准均未完成前，不得写入模型目录、manifest 或 production catalog。

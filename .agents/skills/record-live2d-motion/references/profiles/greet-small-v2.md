# Greet Small Profile V2

| 字段 | 固定值 |
| --- | --- |
| `id` / `revision` / `status` | `greet-small` / `v2` / `ready` |
| `label` / `templateKind` | `轻量问候` / `gesture.one-shot` |
| `fps` / `draftLoop` | `30` / `false` |
| `capture_duration` | 录制器 UI 固定 `3.0s` |
| `padding` / `motion_duration` | start `0.2s` + end `0.2s` / `3.4s` |
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

## Performance Timing

以下均为 `3.0s` 主体采集窗口；导出 Motion3 时间整体加上 `0.2s` leading padding：

| 采集时段 | 表演要求 |
| --- | --- |
| `0.00-0.25s` | 保持中性基线，不预动、不眨眼抢拍。 |
| `0.25-1.15s` | 轻柔向下点头，`ParamAngleY` 主导，速度逐渐进入。 |
| `1.15-1.35s` | 到达低点并短暂缓停，不继续拖到后半段。 |
| `1.35-2.55s` | 平顺抬回，闭口微笑逐渐形成；不得把主要回正挤到最后 `0.2s`。 |
| `2.55-3.00s` | 已回到中性附近，只做自然收势和稳定保持。 |

`ParamAngleX` / `ParamAngleZ` 只做轻微自然从属，不形成侧摆主语义；双眼协调、眉毛放松、嘴部全程闭合。不要把延长至 `3.0s` 误作旧节奏的等比例放慢。

## Profile Gates

- arm 前确认摄像头面捕已启用，并确认当前模型身份、能力快照和完整 10 项 allowlist 与 take contract 一致。
- UI 录制时长必须为 `3.0s`，固定保留前后各 `0.2s` padding；预期 Motion3 `Meta.Duration=3.4s`、`Loop=false`。
- VTube Studio 只读采样；不要按动画热键，不要触发 `HotkeyTriggerRequest`，不要播放或重采样 `Scene1.motion3.json`。
- 旧 profile ID `greet-small` revision `v1` 及三份 `2.4s` 历史 draft 都是未采用候选，不得复用、精修、intake 或自动 fallback。用户视觉否决优先于 agent 多数意见和既有自动/结构证据。
- 结果始终是 one-shot draft。parser、人工视觉、Cubism Animator 精修和具体 production intake 批准均未完成前，不得写入模型目录、manifest 或 production catalog。

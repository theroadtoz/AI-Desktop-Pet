# Sleep Enter Profile V1

| 字段 | 固定值 |
| --- | --- |
| `id` / `revision` / `status` | `sleep-enter` / `v1` / `ready` |
| `label` / `templateKind` | `进入睡眠` / `state.enter` |
| `fps` / `draftLoop` | `30` / `false` |
| `capture_duration` | 录制器 UI 固定 `2.4s` |
| `padding` / `motion_duration` | start `0.3s` + end `0.3s` / `3.0s` |
| `cycle_duration` | 不适用 |
| `draft.intent` / `productionLoopCandidate` | `state-enter-draft` / `false` |
| `outputPrefix` | `sleep-enter` |
| `parameterOwnership` | `approved-sleep-enter-draft-only` |
| `gates.endpoint` / `gates.seam` | `not-required` / `not-required` |
| `semanticAliases` | `[]` |

该 `ready` 只表示 `ready-for-draft-recording`，不表示 sleep runtime、production intake 或任何后续 sleep profile 已开放。

## Allowlist And Ownership

只允许以下 3 项，CurrentModel 参数表缺少任一项即阻塞，不得静默删减或扩大：

```text
ParamAngleY
ParamEyeLOpen
ParamEyeROpen
```

Motion 播放期间独占上述三项。明确排除 `ParamBreath`，基础呼吸仍由 SDK 独占；排除 `ParamMouthOpenY`、`ParamMouthForm` 和所有嘴部参数，以及 `ParamAngleX/Z`、所有 `ParamBodyAngle*`、眼球注视、眉毛、exp3 参数、手部、配件、服装、发型、全部 physics destination 和任何未列参数。physics 只可读取获准源参数产生从属运动，不得录制 physics 输出。

自然完成后的未来 production 语义应直接交接 `sleep-loop-soft`，不能先恢复 idle；当前 profile 不实现该 runtime 交接。中断时必须释放三项 motion ownership，并由未来状态机按目标状态执行一次恢复。

## Performance Timing

以下均为 `2.4s` 主体采集窗口；导出 Motion3 时间整体加上 `0.3s` leading padding：

| 采集时段 | 表演要求 |
| --- | --- |
| `0.00-0.30s` | 正常睁眼，头部中性稳定，不预动。 |
| `0.30-1.10s` | 缓慢低头，双眼同步由睁开过渡到半闭。 |
| `1.10-1.75s` | 双眼平顺闭合，头部到达舒适睡眠低位。 |
| `1.75-2.15s` | 轻柔收势，不反弹、不左右摇摆。 |
| `2.15-2.40s` | 保持闭眼终态，为 trailing padding 提供稳定端点。 |

不要加入哈欠、张嘴、皱眉、侧摆、醒来或夸张低头。

## Profile Gates

- arm 前必须由人工确认摄像头面捕已启用，以同步低头与闭眼时序；不能用 API 可用、参数存在或旧 take 确认替代该人工门禁。
- Live2dREC 仍只读取上述三项 allowlist 参数，不采集、保存或输出摄像头画面、音频或原始脸部数据；不得使用参数注入或 VTS hotkey。
- UI 录制时长必须为 `2.4s`，固定保留前后各 `0.3s` padding；预期 Motion3 `Meta.Duration=3.0s`、`FPS=30`、`Loop=false`。
- agent/自动 human-review 只检查技术播放、三项批准曲线是否存在、参数/通道所有权冲突，以及自然完成或中断后的终态衔接与恢复；Motion3 结构损坏、隐私越界、allowlist/所有权冲突或衔接恢复失败等硬缺陷仍可阻塞。
- 低头与双眼同步是否自然、闭眼终态的幅度和稳定观感、节奏是否舒适、左右摇摆/反弹/嘴部变化及模型从属表现是否美观，均由用户最终审核。agent 视觉意见或投票不得覆盖用户结论，也不得仅因审美偏好自行要求重录。
- 结果始终是 state-enter draft。parser、用户最终审核、Cubism Animator 精修、未来 runtime 交接和具体 production intake 批准均未完成前，不得写入模型目录、manifest 或 production catalog。
- `sleep-loop-soft` 与 `wake-up` 继续为 `planned-blocked`；本 profile ready、draft 生成或用户最终审核通过都不能自动开放它们。

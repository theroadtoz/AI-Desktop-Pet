# Happy Small Profile V1

> **历史/技术说明，非执行契约。** 本文件不得用于 resolve、preflight、arm 或 record，也不得覆盖 `E:\Work-26\Live2dREC` 当前受信 catalog 与 UI resolved profile summary；每次 take 的 revision、duration、padding、FPS、Loop 和 allowlist 仅以该 summary 为准。

| 字段 | 固定值 |
| --- | --- |
| `id` / `revision` / `status` | `happy-small` / `v1` / `ready` |
| `label` / `templateKind` | `轻快开心` / `gesture.one-shot` |
| `fps` / `draftLoop` | `30` / `false` |
| `capture_duration` | 录制器 UI 固定 `1.6s` |
| `padding` / `motion_duration` | start `0.2s` + end `0.2s` / `2.0s` |
| `cycle_duration` | 不适用 |
| `draft.intent` / `productionLoopCandidate` | `one-shot-draft` / `false` |
| `outputPrefix` | `happy-small` |
| `parameterOwnership` | `approved-happy-small-draft-only` |
| `gates.endpoint` / `gates.seam` | `closed-neutral` / `not-required` |
| `semanticAliases` | `[]` |

## Allowlist And Ownership

只允许以下 5 项，CurrentModel 参数表缺少任一项即阻塞，不得静默删减或扩大：

```text
ParamAngleY
ParamAngleZ
ParamEyeLSmile
ParamEyeRSmile
ParamMouthForm
```

Motion 播放期间独占上述五项。明确排除 `ParamBreath`、所有 `ParamBodyAngle*`、眼球注视参数、`ParamEyeLOpen`、`ParamEyeROpen`、`ParamMouthOpenY`、voice/lip-sync、physics destination、ArtMesh 曲线、配件和任何未列参数。不得使用参数注入驱动模型。

## Structural Requirements

- 主体采集窗口为 `1.6s`；导出 Motion3 时间整体加上 `0.2s` leading padding。
- `ParamEyeLSmile`、`ParamEyeRSmile`、`ParamMouthForm` 中**任一项**必须具有有限、时间有序的 semantic variation；这不是三项同时变化的要求。`ParamAngleY` 与 `ParamAngleZ` 是辅助曲线，只有在序列化精度内恒定时可省略；任一微小但非零的已序列化变化都必须保留，并经真实 Motion3 write/read 回读验证，若导出必须结构有效。
- 每条实际导出的 allowlist 曲线都必须结构有效，并以相同中性基线闭合首尾；closed endpoint 阈值内的端点必须在生成时规范化为该中性基线，parser readback 以同一阈值和规范化口径复验；不得用通用、审美幅度、节奏或情绪效果阈值判定变化是否合格。

## Profile Gates

- 每个独立 take 可复用当前有效的会话级 `camera-face-tracking` 许可，不要求再答 `准备好了`；仍须在 arm 前自动重验 CurrentModel 身份、完整 5 项参数签名、allowlist、时长、FPS、Loop 和 outputPrefix 与当前 take contract 一致。旧 take、旧 preflight 和切换前 profile 的 preflight 不可复用。
- VTube Studio 只读采样上述 allowlist；不得播放、注入或触发任何 VTS motion、expression 或 hotkey。
- UI 录制时长必须为 `1.6s`，固定保留前后各 `0.2s` padding；预期 Motion3 `Meta.Duration=2.0s`、`FPS=30`、`Loop=false`。
- 连接或 preflight 失败时，先消费当前 take 的人工前置条件确认，再等待或触发 candidate adapter 清理。
- 每段只在当前 take 的独立 digest 和 profile/take ID 派生的受管相对 output 中暂存一个 candidate；独立 parser readback 必须重验 required variation IDs、mode 和按生成同一阈值规范化的 closed endpoints，不能只比较序列化 JSON 与内存对象；通过后原子发布为 draft，才算输出成功。发布后，以及发布前/readback 失败或取消时，均必须重试本 take 临时 candidate 的 unlink 并追踪 `cleanupPending`；临时 unlink 持续失败时，必须将含 `take_id`、owner、受控临时路径、重试状态和禁止删除 final 标记的结构化 cleanup handle 移交 managed drain。发布成功时合法 final 仍为成功 draft，发布前/readback 失败时保留原始录制失败，且 managed drain 不得删除或改报任何合法 final；完成、失败或取消后停止，等待用户选择下一段，不得自动连录、覆盖或删除其他 take 输出。
- 每个 take 只运行一次内建自动技术 readback：技术播放、active allowlist 曲线的有限且时间有序变化、参数/通道所有权冲突及完成/中断后的衔接与恢复。结构损坏、隐私越界、allowlist/所有权冲突或衔接恢复失败可阻塞；通过时标记 `draft / technical-pass / user-visual-review-pending`。
- 笑容幅度、节奏、自然度、美观和情绪效果由用户批量最终审核；agent 不得重复代码/Skill/profile 审核、进行审美投票或以审美理由要求重录。
- 结果始终是 one-shot draft。parser、用户最终审核、Cubism Animator 精修和具体 production intake 批准均未完成前，不得写入模型目录、manifest 或 production catalog。

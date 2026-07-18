# Profile Schema

Schema version: `live2d-recorder-profile/v1`.

每个 profile 由 Live2dREC main/core 持有并以受信安全摘要提供。renderer 只能提交 `profileId` 与允许时长；不得提交参数、FPS、padding、Loop、路径、状态或 blocker 覆盖值。

## 必填字段

| 字段 | 规则 |
| --- | --- |
| `id` | 稳定 profile ID。 |
| `revision` / `digest` | main/core 对 canonical profile 的版本和摘要；arm 时冻结。 |
| `status` | 仅 `ready` 或 `planned-blocked`。 |
| `templateKind` | `gesture.one-shot`、`state.enter`、`state.loop` 或 `state.exit`。 |
| `duration` | 默认值、允许范围和步进；capture、motion、cycle 三种语义必须明确。 |
| `fps` / `padding` | 受 profile 控制，不能由 renderer 覆盖。 |
| `draftLoop` / `productionLoopCandidate` | draft 必须独立声明；loop candidate 不等于生产 Loop。 |
| `outputPrefix` | 受管相对前缀；不得为绝对路径、上跳路径或用户注入路径。 |
| `allowlist` | P2-64Z-2 v2 的完整 41 参数 ID 集合。未知、缺失或不匹配即阻塞。 |
| `requiredOutputParameterIds` | 必须包含完整 29 个连续参数和 12 个定时组件参数；平坦连续曲线与全零组件组也必须输出。 |
| `variationGroups` | 必须声明连续表演集与定时组件组；连续组保持连续曲线，定时组使用 `0/30` stepped。 |
| `timedAccessoryGroups` | v2 必填的七个定时组件组及精确成员；完整组按采样时间复现 stepped 曲线。 |
| `ownership` | 参数排除项、运行时通道所有权和冲突说明。 |
| `gates` | endpoint、模型、parser、seam、视觉、Cubism 与 intake 门禁。 |
| `blockers` | `planned-blocked` 的可审计原因；不得用猜测 allowlist 填充。 |

## Session Readiness

- `camera-face-tracking` 许可仅是当前 Live2dREC main service 运行内的非持久化人工门禁，不是 profile 字段、active recording session object 或 renderer 权限。
- 当前有效许可仅可用于 Live2dREC 当前受信 catalog 标为 `ready` 的 profile。每个 take 仍必须独立自动检查 CurrentModel、参数签名、当前 summary 的 allowlist、时长、padding、FPS、Loop 和 outputPrefix；本 Skill 的历史 references 不可参与该判断。
- profile prerequisite definition 改变，或 preflight/recording 发现模型身份或参数签名改变时，必须撤销会话许可。take 完成、readback/write 失败、TTL 到期、重新 prepare 或 ready profile 切换不撤销它，只撤销当前 take。

## 模板语义

- `gesture.one-shot`：一次性可恢复动作；draft `Loop=false`。
- `state.enter`：进入持续状态的一次性过渡；draft `Loop=false`。
- `state.loop`：持续状态的周期候选；录制 draft 仍为 `Loop=false`。
- `state.exit`：离开持续状态的一次性过渡；draft `Loop=false`。

loop draft 的首尾数值闭合只证明位置可闭合，不证明速度连续。只有 Cubism Animator 精修、至少三周期人工视觉复核、真实运行 pause/resume 复核和明确 production intake 全部通过后，最终资源才可设为 `Loop=true`。

## 状态选择

- 仅 `ready` profile 可进入 compatibility-check、arm 或 record。
- `planned-blocked` profile 可被 catalog 安全列出，但不得连接、倒数、录制或写 Motion3。
- 不认识的 profile 或 allowlist 一律按 `planned-blocked` 处理；不要推测参数。

## P2-64Z-2 v2 Recording Rules

- 每个 P2-64Z-2 profile 必须升至 revision 2，并绑定 41 参数合同；CurrentModel 缺任一参数时，录制前 preflight 明确失败。
- `requiredOutputParameterIds` 必须逐项覆盖 29 个连续参数与 12 个定时组件参数；连续参数全程平坦也保留曲线，定时组件全程关闭也保留完整全零成员组。
- 连续参数使用连续采样与普通滤波；定时组件值只允许 `0` 或 `30`，使用 stepped、fade=0、不去尖峰，并记录完整组的初始值、切换和最终值。
- `eye-symbol` 的 `Param59/60` 只允许 off/heart/star 三种状态；`held-prop` 的 `Param61/62/72` 状态互斥。身体 X/Y/Z 必须是连续曲线。
- `Param25/26/27/70` 旧泪眼/生气路径保持停用，不得重新猜测或启用。
- 静态 `requiredAccessoryStates` 不得替代时间线；不得从缺失字段猜测组件。
- 播放时 motion-owned 参数优先；动作结束、异常或 release 后恢复下一帧的最新持久状态，不恢复开始快照。
- 旧 `head-pat` 草稿保留并标记 `visual-retry`；修复后必须重录。
- 这些字段仍属于每段内建 parser readback 与原子发布 draft 的安全门禁；P2-64Z-2 延后的仅是全部 10 段人工裁决后、针对用户通过 exact sources 的额外 post-hoc 正式技术验收。

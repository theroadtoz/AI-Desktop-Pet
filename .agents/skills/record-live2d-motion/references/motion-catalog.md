# Motion Catalog

`yawn`、`idle-soft-loop`、`greet-small/v2`、`sleep-enter/v1`、`happy-small/v1`、`surprised-small/v1` 与 `flustered-small/v1` 是当前可录的 `ready` draft profile；其他所有项均为 `planned-blocked`。catalog 只说明规划与 fallback；未知 allowlist 一律阻塞，不能因此连接、倒数、录制或写 Motion3。`sleep-enter` ready 只开放受控 draft，不开放 sleep runtime、production intake 或后续 sleep profile。三个新 reaction profile 的输出都必须在独立 readback 重验 required variation IDs、mode 和 closed endpoints 后原子发布；发布后，以及发布前/readback 失败或取消时，均必须重试本 take 临时 candidate 的 unlink 并追踪 `cleanupPending`；临时 unlink 持续失败时，必须将含 `take_id`、owner、受控临时路径、重试状态和禁止删除 final 标记的结构化 cleanup handle 移交 managed drain。发布成功时合法 final 仍为成功 draft，发布前/readback 失败时保留原始录制失败，且 managed drain 不得删除或改报任何合法 final。

## Session Approval And Independent Takes

- 当前运行中的一次 `camera-face-tracking` 人工许可可复用到上述全部 ready profile；用户仍须手动开始每个独立 take，且不会自动连续录制。
- 每次 profile 选择和每个 take 都自动重跑 CurrentModel、参数签名、allowlist、duration、FPS、Loop 和 outputPrefix preflight，并保留独立 take/digest/output。profile 切换、take 完成、readback/write 失败、TTL 到期或重新 prepare 只影响当前 take。
- 仅应用重启/销毁、用户取消、connection configuration 变化、认证/连接失败、profile prerequisite definition 变化，或检测到模型身份/参数签名变化时撤销会话许可。技术通过后为 `draft / technical-pass / user-visual-review-pending`；用户批量决定视觉结论。

| 顺序 | 动作族 | Canonical 资产或 profile | 模板 | 时长语义 | 别名或 fallback | 是否需要新 Motion | 状态与门禁 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | tired | `yawn` | `gesture.one-shot` | profile 定义 | `yawn-once` | 否，已是 ready profile | `ready`；读 yawn profile。 |
| 1 | base idle | `idle-soft-loop` | `state.loop` | 4.0s cycle | `reading-idle`、`work-focus`、`listen-soft`、`think-soft`、`speak-sustain-soft` | 否，首版共享 idle | `ready`；仅其 profile allowlist。 |
| 2 | sleep | profile ID `sleep-enter`；revision `v1` | `state.enter` | 2.4s capture + 0.3s + 0.3s padding = 3.0s Motion3 | 无 | 是，仅生成 draft | `ready`；读 sleep-enter v1 reference，要求摄像头面捕人工确认、精确三参数和当前 take 确认；runtime/intake 未开放。 |
| 3 | sleep | `sleep-loop-soft` | `state.loop` | 建议 4.0-8.0s cycle | 无 | 是 | `planned-blocked` / 不可录；必须先由已接受 sleep-enter draft 产生真实 `sleepAnchor-v1`，且 SDK breath、专属 allowlist、三周期 seam、pause/resume 和 runtime/loop contracts 仍待批准。 |
| 4 | sleep | `wake-up` | `state.exit` | 建议 2.0-4.0s | 无 | 是 | `planned-blocked` / 不可录；必须先由已接受 sleep-enter draft 产生真实 `neutralAnchor-v1`，并完成与 sleep loop 终点及目标状态恢复的 runtime contract。 |
| 5 | greeting | profile ID `greet-small`；revision `v2` | `gesture.one-shot` | 3.0s capture + 0.2s + 0.2s padding = 3.4s Motion3 | 无；旧 v1/三份 draft 不可复用 | 是，仅生成 draft | `ready`；读 greet-small v2 reference，要求摄像头面捕、完整 allowlist 与当前 take 确认。 |
| 6 | reaction | profile ID `happy-small`；revision `v1` | `gesture.one-shot` | 1.6s capture + 0.2s + 0.2s padding = 2.0s Motion3 | `headPat`、appearance、game cheer 的安全映射候选 | 是，仅生成 draft | `ready`；读 happy-small v1 reference。`EyeLSmile`/`EyeRSmile`/`MouthForm` 任一项 semantic variation、所有导出曲线 closed-neutral；辅助头曲线仅在序列化精度内恒定时可省略，微小非零已序列化变化必须保留，不设通用或审美幅度阈值。复用会话 camera-face-tracking 许可，但每个 take 自动重验 CurrentModel/参数签名且无 VTS motion/expression/hotkey 注入；不自动连录。 |
| 7 | reaction | profile ID `surprised-small`；revision `v1` | `gesture.one-shot` | 1.2s capture + 0.2s + 0.2s padding = 1.6s Motion3 | 同上 | 是，仅生成 draft | `ready`；读 surprised-small v1 reference。`ParamBrowLY` required semantic variation、所有导出曲线 closed-neutral；辅助头眼曲线仅在序列化精度内恒定时可省略，微小非零已序列化变化必须保留，导出时必须结构有效，不设通用或审美幅度阈值。复用会话 camera-face-tracking 许可，但每个 take 自动重验 CurrentModel/参数签名且无 VTS motion/expression/hotkey 注入；不自动连录。 |
| 8 | reaction | profile ID `flustered-small`；revision `v1` | `gesture.one-shot` | 1.8s capture + 0.2s + 0.2s padding = 2.2s Motion3 | 同上 | 是，仅生成 draft | `ready`；读 flustered-small v1 reference。`ParamBrowLForm` required semantic variation、所有导出曲线 closed-neutral；辅助头眼曲线仅在序列化精度内恒定时可省略，微小非零已序列化变化必须保留，导出时必须结构有效，不设通用或审美幅度阈值。复用会话 camera-face-tracking 许可，但每个 take 自动重验 CurrentModel/参数签名且无 VTS motion/expression/hotkey 注入；不自动连录。 |
| 9 | speaking | `speak-enter` | `state.enter` | 建议 0.5-1.2s | 无 | 是 | `planned-blocked` / 不可录；精确 allowlist 与 lip-sync cancel/restore contract 尚未定义。 |
| 10 | speaking | `speak-exit` | `state.exit` | 建议 0.5-1.2s | 无 | 是 | `planned-blocked` / 不可录；精确 allowlist 与 lip-sync cancel/restore contract 尚未定义。 |
| 11 | semantic aliases | 共享 `idle-soft-loop` | `state.loop` | 使用 idle cycle | `listen`、`think`、`reading`、`work`、`speak-sustain` | 否 | 不创建 profile/Motion；运行时仅可在已批准 idle 边界内映射。 |
| 12 | personality/scenario | 无 | fallback | 不适用 | `curiousTilt`、`quietNod`、`shySmile`、`lookAway`、`playGame`、`gameReady`、`readingThink`、`focus`、`edgeGlance` | 否 | 继续使用现有 expression/look/pose/accessory fallback。 |

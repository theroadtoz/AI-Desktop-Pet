# Motion Catalog

除 `yawn`、`idle-soft-loop`、`greet-small` 与 `sleep-enter` 外，所有项均为 `planned-blocked`。catalog 只说明规划与 fallback；未知 allowlist 一律阻塞，不能因此连接、倒数、录制或写 Motion3。`sleep-enter` ready 只开放受控 draft，不开放 sleep runtime、production intake 或后续 sleep profile。

| 顺序 | 动作族 | Canonical 资产或 profile | 模板 | 时长语义 | 别名或 fallback | 是否需要新 Motion | 状态与门禁 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | tired | `yawn` | `gesture.one-shot` | profile 定义 | `yawn-once` | 否，已是 ready profile | `ready`；读 yawn profile。 |
| 1 | base idle | `idle-soft-loop` | `state.loop` | 4.0s cycle | `reading-idle`、`work-focus`、`listen-soft`、`think-soft`、`speak-sustain-soft` | 否，首版共享 idle | `ready`；仅其 profile allowlist。 |
| 2 | sleep | profile ID `sleep-enter`；revision `v1` | `state.enter` | 2.4s capture + 0.3s + 0.3s padding = 3.0s Motion3 | 无 | 是，仅生成 draft | `ready`；读 sleep-enter v1 reference，要求摄像头面捕人工确认、精确三参数和当前 take 确认；runtime/intake 未开放。 |
| 3 | sleep | `sleep-loop-soft` | `state.loop` | 建议 4.0-8.0s cycle | 无 | 是 | `planned-blocked`；不因 sleep-enter ready 自动开放，SDK breath、专属 allowlist、三周期 seam 与 pause/resume 未批准。 |
| 4 | sleep | `wake-up` | `state.exit` | 建议 2.0-4.0s | 无 | 是 | `planned-blocked`；不因 sleep-enter ready 自动开放，必须与 sleep loop 终点和目标状态恢复对齐。 |
| 5 | greeting | profile ID `greet-small`；revision `v2` | `gesture.one-shot` | 3.0s capture + 0.2s + 0.2s padding = 3.4s Motion3 | 无；旧 v1/三份 draft 不可复用 | 是，仅生成 draft | `ready`；读 greet-small v2 reference，要求摄像头面捕、完整 allowlist 与当前 take 确认。 |
| 6 | reaction | `happy-small` | `gesture.one-shot` | 建议 1.0-2.5s | `headPat`、appearance、game cheer 的安全映射候选 | 是 | `planned-blocked`；专属 allowlist 与视觉门禁未批准。 |
| 7 | reaction | `surprised-small` | `gesture.one-shot` | 建议 0.8-1.8s | 同上 | 是 | `planned-blocked`；专属 allowlist 与视觉门禁未批准。 |
| 8 | reaction | `flustered-small` | `gesture.one-shot` | 建议 1.0-2.5s | 同上 | 是 | `planned-blocked`；专属 allowlist 与视觉门禁未批准。 |
| 9 | speaking | `speak-enter` | `state.enter` | 建议 0.5-1.2s | 无 | 是 | `planned-blocked`；口型通道隔离、cancel/restore 未批准。 |
| 10 | speaking | `speak-exit` | `state.exit` | 建议 0.5-1.2s | 无 | 是 | `planned-blocked`；口型通道隔离、cancel/restore 未批准。 |
| 11 | semantic aliases | 共享 `idle-soft-loop` | `state.loop` | 使用 idle cycle | `listen`、`think`、`reading`、`work`、`speak-sustain` | 否 | 不创建 profile/Motion；运行时仅可在已批准 idle 边界内映射。 |
| 12 | personality/scenario | 无 | fallback | 不适用 | `curiousTilt`、`quietNod`、`shySmile`、`lookAway`、`playGame`、`gameReady`、`readingThink`、`focus`、`edgeGlance` | 否 | 继续使用现有 expression/look/pose/accessory fallback。 |

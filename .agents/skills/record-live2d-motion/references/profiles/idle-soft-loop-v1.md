# Idle Soft Loop Profile V1

| 字段 | 固定值 |
| --- | --- |
| `id` / `revision` / `status` | `idle-soft-loop` / `v1` / `ready` |
| `templateKind` | `state.loop` |
| `fps` / `draftLoop` | `30` / `false` |
| `capture_duration` / `motion_duration` / `cycle_duration` | `4.0s` / `4.0s` / `4.0s` |
| `padding` | 无 |
| `outputPrefix` | `motion-drafts/vts-drafts/idle-soft-loop` |

## Allowlist And Ownership

allowlist 仅为 `ParamAngleZ`。排除 `ParamAngleX/Y`、全部 body angle、眼球、眨眼、呼吸、嘴、眉、表情、手臂和旧 `Scene1` 参数；它们保留给 look、drag、pose、physics、blink、expression 或其他系统。

## Profile Gates

- 4.0 秒同时约束真实参数采集、倒数和最终 `Meta.Duration`；不得添加 padding。
- 首尾 `ParamAngleZ` 数值必须闭合。数值闭合不等于速度连续，后者必须由 Cubism Animator 和人工视觉验证。
- draft 固定 `Loop=false`。只有 Cubism 精修、至少三周期人工视觉、真实 runtime pause/resume 复核和 production intake 均通过后，最终 Motion3 才可为 `Loop=true`。
- runtime 必须能在语义动作、拖拽或 pose 时暂停 idle，并从周期起点恢复；此依赖未通过时不得 intake 为 production loop。

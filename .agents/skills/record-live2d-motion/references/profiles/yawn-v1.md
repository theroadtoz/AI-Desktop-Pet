# Yawn Profile V1

| 字段 | 固定值 |
| --- | --- |
| `id` / `revision` / `status` | `yawn` / `v1` / `ready` |
| `templateKind` | `gesture.one-shot` |
| `fps` / `draftLoop` | `30` / `false` |
| `capture_duration` | `5.1s` |
| `padding` / `motion_duration` | start `0.3s` + end `0.3s` / `5.7s` |
| `cycle_duration` | 不适用 |
| `outputPrefix` | `motion-drafts/vts-drafts/yawn` |

## Allowlist And Ownership

只允许以下 9 项：

```text
ParamAngleX
ParamAngleY
ParamAngleZ
ParamEyeLOpen
ParamEyeROpen
ParamBrowLY
ParamBrowLForm
ParamMouthOpenY
ParamMouthForm
```

排除 breath、voice、眼球跟踪、physics 输出、配件、手臂和未列参数。口型参数仅用于本 one-shot，不得推导为 speaking sustain 的所有权。

## Profile Gates

- 可复用当前有效的会话级 `camera-face-tracking` 许可，不要求为此 take 再答 `准备好了`。每个独立 take 仍自动重验 CurrentModel 身份、能力快照、完整 9 项参数签名、allowlist、时长、FPS、Loop 和 outputPrefix；缺失或未知参数即阻塞。
- 保持 `Loop=false`，并检查开头和结尾 `0.3s` 静止区与中性恢复。
- 每个 take 只运行一次内建自动技术 readback；通过时标记 `draft / technical-pass / user-visual-review-pending`，不重复代码/Skill/profile 审核或 agent 审美投票。
- 用户可在批量视觉复核中检查哈欠语义、嘴眼头节奏、脸/头发/帽子/手杖/衣袖/配件、出屏、残留姿态和 `UseBlinking=false` 下的眼部表现，并逐段决定接受或重录。
- parser 技术通过后仍需 Cubism Animator 精修；未获具体 intake 批准不得进入模型目录或 catalog。

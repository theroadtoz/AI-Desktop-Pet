---
name: record-live2d-motion
description: 受控录制、回读、人工复核和 intake Live2D Motion3 草稿。用于通过 Live2dREC 与 VTube Studio 准备或录制已批准 profile、检查既有 Motion3、在 Cubism Animator 精修后接入动作；要求当前 take 明确确认、参数 allowlist、兼容性门禁和零越权清理。
---

# 录制 Live2D 动作

## 受信 Profile 来源

每次录制只读检查 `E:\Work-26\Live2dREC`。在 `resolve-profile` 阶段，必须从 Live2dREC 的受信 catalog 和当前 UI resolved profile 读取本次 profile summary；该 summary 是唯一事实源。

- 仅当 catalog 与 UI 对同一 profile 的 ID、revision、status、duration、padding、FPS、Loop、allowlist、outputPrefix 与 profile digest 一致时继续。任何字段缺失、未知、过期或不一致都阻塞。
- 每个 take 都重新读取并冻结当前 summary。不得从本 Skill、旧 take、旧 draft、模型目录、manifest、候选 Motion3 或用户口述推断、补全或覆盖这些值。
- `references/profiles/` 与 [motion-catalog.md](references/motion-catalog.md) 只保留历史和技术说明；它们不可用于 resolve、preflight、arm、record 或覆盖当前 summary。
- 本 Skill 的本地文本不定义录制参数；当前录制契约由 Live2dREC 解析后的 profile summary 和不可变 take contract 决定。

## 硬边界

- 只读检查 `E:\Work-26\Live2dREC`；不要修改 recorder、桌宠 runtime、模型、manifest、preset、catalog 或 candidate，除非用户另行明确授权。
- 只采集当前受信 summary allowlist 内的 Live2D 参数；不要采集摄像头、音频、原始脸部数据或 VTube Studio 画面，不要使用参数注入驱动模型。
- 会话级人工许可只确认 `camera-face-tracking` 已启用。它只允许用户手动发起当前 catalog 标为 `ready` 的独立 take，不是具体 take 的视觉批准，也绝不启动自动连录。
- 每个 take 仍须独立自动重跑 CurrentModel、完整参数签名、当前 summary 的 allowlist、duration、padding、FPS、Loop 和受管相对 outputPrefix preflight，并独立 arm、digest、staging candidate、readback 与 draft 输出。renderer 不得覆盖这些字段或 runtime 状态。
- VTube Studio 只读采样当前 allowlist；不得播放、注入或触发 motion、expression 或 hotkey。
- 所有实际导出的 allowlist 曲线、required semantic variation、endpoint 或 seam 规则都以当前 summary 和不可变 take contract 为准。parser readback 必须以同一份冻结字段复验；不得以通用或审美阈值替代 profile 门禁。
- P2-64Z 当前阶段的每个 profile 可声明 `timedAccessoryGroups`；录制者可在动作中手动开关配件，配件参数按采样时间量化为 `0`/`30`，输出 Motion3 stepped 曲线。`ParamMouthForm` 与 `ParamMouthOpenY` 必须作为一个 profile `all-of` variation group，并且两者都真实变化；不得要求眼泪或生气旧组件。
- 不得把静态 `requiredAccessoryStates` 当作定时配件时间线；定时组必须以 profile 定义的组成员、采样切换、初始值和最终值为准。
- 每个 take 发布前仍须运行一次 Live2dREC 内建 parser readback 安全门禁，并在通过后原子发布为 `draft / technical-pass / user-visual-review-pending`；该标记只表示内建发布链通过，不等于 P2-64X 式额外 post-hoc 正式技术验收。
- P2-64Z 当前阶段在每段 draft 发布后立即隔离展示并由用户人工裁决，不逐段运行额外 post-hoc 正式技术验收。全部 10 段完成并有人工裁决后，才对用户通过的锁定 exact sources 批量运行 post-hoc 技术验收；不得为每段重复代码审查、Skill/profile 批准、全量测试或 agent 审美投票。
- 未批准产物始终是 `draft`；没有明确 intake 授权时，不要写入 production 目标。
- 真实 VTS 连接只允许 `ws://127.0.0.1:<当前配置端口>`；拒绝非 `ws` 协议或非 `127.0.0.1` 主机。端口属于当前 connection 配置，必须读取并实测，不得写死或探测多个端口。
- token 只可引用 `main + safeStorage` 的可用性，不得读取、打印、复制或记录 token 值。
- 不接受逐 take 的 `准备好了` 作为录制许可；只有当前运行中有效的会话级 `camera-face-tracking` 人工许可可开始新的手动 take。其精确失效条件见 [take-contract.md](references/take-contract.md)。

## 状态机

按顺序执行；任一 gate 失败、受信 summary 或摘要字段变化、用户取消或证据缺失时停止，记录 blocker，并只进入 cleanup。

1. **prepare**：读取当前 handoff 与相关 TASK、RESULT、ACCEPTANCE；建立清理基线和本次 ownership ledger。需要字段定义时读取 [take-contract.md](references/take-contract.md)。
2. **resolve-profile**：只从 `E:\Work-26\Live2dREC` 的受信 catalog 和 UI resolved profile 获取当前 summary。未知、`planned-blocked`、字段不全或不一致 profile 一律停止；本地 reference 不得参与裁决。
3. **compatibility-check**：读取 [compatibility.md](references/compatibility.md)，验证 Live2dREC contract、VTS Public API、模型身份、能力快照和 Motion3/Cubism 门禁。
4. **verify-session-readiness**：首次使用前显示会话级 `camera-face-tracking` 人工确认；它仅存于 Live2dREC main service 当前运行内。确认有效时，用户可手动选择一个当前 `ready` profile；不显示或等待逐 take 的 `准备好了`。
5. **arm**：对每个手动选择的 profile 自动重跑 preflight，并冻结独立 take contract、当前 profile summary、连接配置、模型身份、能力快照、allowlist、时长、padding 和非绝对 outputPrefix；显示不可变 take ID 与短摘要。take TTL 或字段变化只撤销该 take，不撤销会话许可。
6. **countdown**：在仍有效的 armed take 上显示提示音与 `3`、`2`、`1`、`开始`；倒数前再次核对 contract digest，失配即停止。
7. **record**：仅采集当前 profile allowlist；锁定 summary 定义的 capture 时长和 padding，并只写入当前 take ownership ledger 中的 staging candidate。按冻结的 `timedAccessoryGroups` 允许录制者手动开关配件；嘴部 `all-of` 两个参数都必须产生变化。认证/连接失败，或 preflight/录制发现模型身份或参数签名变化时，按 [take-contract.md](references/take-contract.md) 立即撤销会话许可；其他 take 失败只清理该 take。发生参数越界、时长漂移或范围扩大时立即停止，不生成伪成功文件。
8. **parser-readback-and-publish**：用独立 Motion3 parser 回读 Version 3、Meta、冻结的 Duration、FPS、Loop、曲线、单调有限数值和 allowlist；必须独立重验当前 profile summary 要求的 variation、mode、endpoint 与 seam 规则，以及嘴部 `all-of`、定时组完整性、`0/30` 值域、stepped 编码、时间单调、时长范围和 Meta 计数，不能只比较序列化 JSON 和内存对象。结构通过不等于用户视觉通过。只有 readback 成功后才能原子发布 candidate，并把该输出计为成功 draft；发布后，以及发布前/readback 失败或取消时，均必须重试本 take 临时 candidate 的 unlink，并单独追踪 `cleanupPending`。临时 unlink 持续失败时，必须生成含 `take_id`、owner、受控临时路径、重试状态和禁止删除 final 标记的结构化 cleanup handle，移交 managed drain；发布成功时合法 final 仍为成功 draft，发布前/readback 失败时保留原始录制失败，且 managed drain 不得删除或改报任何合法 final。
9. **isolate-display**：每段完成内建 parser readback、原子发布 draft 和本 take cleanup 后，立即隔离展示给用户并记录人工裁决。当前阶段不逐段运行 P2-64X 式额外 post-hoc 正式技术验收；定时配件曲线不得改写为静态 `requiredAccessoryStates`。
10. **batch-post-hoc-technical-acceptance**：仅当 P2-64Z 的全部 10 段均已录制并完成用户人工裁决后，锁定用户通过的 exact sources，再批量运行额外 post-hoc 正式技术验收。验收失败只说明结构/契约问题，不推翻用户视觉裁决，也不改变各 take 已完成的内建发布与 cleanup 事实。
11. **Cubism-refine**：普通路径要求在 Cubism Animator 中精修通过用户最终审核的 draft 并重新导出；不要把 VTS 采样直接视为生产动作。唯一例外是用户明确点名 `exact source` 与 `exact runtime target` 的 `user-authorized-vts-draft` intake：可跳过 Cubism 精修，但必须将 `cubismRefined=false` 固定记录，并不得称为 Cubism refined 或 quality certified。
12. **intake-approve**：普通路径要求用户明确批准具体 draft 和具体 intake 目标，并复核 parser、用户最终审核、Cubism 精修及当前 profile summary 的额外门禁。例外路径还必须满足 [compatibility.md](references/compatibility.md) 的 P2-52 dry-run、用户授权来源证据、safe path、Model CDI3/hash/source-target 相等和批次原子性门禁；不得由 profile、旧批准或默认配置推导授权。
13. **intake**：普通路径仅写入获授权目标并记录批准依据与实际写入。例外路径只有在上述门禁全部通过后才能写入，固定记录 `intakeStatus=user-authorized-vts-draft`、`userVisualReview=passed`、`cubismRefined=false`、`runtimeEnabled=true`，并针对性技术播放；保留原始 VTS 草稿及其来源证据。例外只适用于本次用户明确点名的 source/target，不得泛化为未来默认路径或替代普通 Cubism 路径；任何未满足项只报告 blocker。
14. **cleanup**：依据 ownership ledger 仅停止或删除本 take 创建的 overlay、timer、socket、进程、临时目录、截图和日志；对已发布 draft 的 `cleanupPending` 临时 candidate，只能在显式 drain、下一次写入或主进程关闭时继续清扫，不得将合法 final 改报为失败；不要关闭用户已有 VTube Studio 资源。

P2-64Z 当前阶段不做 runtime intake 或触发映射；它们属于全部 10 段完成、批量 technical-pass 及后续批准之后的下一阶段 TASK。

## 按需读取

- 解析当前受信 summary 的字段语义：读 [profile-schema.md](references/profile-schema.md)。
- 创建、显示、失效或审计当前 take：读 [take-contract.md](references/take-contract.md)。
- 检查 Live2dREC、VTS、Motion3 与 Cubism 兼容性：读 [compatibility.md](references/compatibility.md)。
- 查阅历史规划或技术背景：读 [motion-catalog.md](references/motion-catalog.md) 与 `references/profiles/`；它们不可替代 Live2dREC 当前 catalog 或 UI resolved profile。

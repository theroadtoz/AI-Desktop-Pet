---
name: record-live2d-motion
description: 受控录制、回读、人工复核和 intake Live2D Motion3 草稿。用于通过 Live2dREC 与 VTube Studio 准备或录制已批准 profile、检查既有 Motion3、在 Cubism Animator 精修后接入动作；要求当前 take 明确确认、参数 allowlist、兼容性门禁和零越权清理。
---

# 录制 Live2D 动作

## Release Identity

- Release ID: `record-live2d-motion-2026-07-15.9`
- Profile schema: `live2d-recorder-profile/v1`
- Take contract schema: `live2d-take-contract/v1`
- Package-content-digest: `sha256:500f9618b356a9d90b829ca1b2569b3e7c2a0b672cc1f1ef268f78740e84f904`

只在两个安装副本的 release、schema 和 package digest 完全一致时继续真实录制。按 [compatibility.md](references/compatibility.md) 计算或比对 digest；不一致即阻塞，不要自动同步或修改其他副本。

## 硬边界

- 只读检查 `E:\Work-26\Live2dREC`；不要修改 recorder、桌宠 runtime、模型、manifest、preset 或 catalog，除非用户另行明确授权。
- 只采集已批准 allowlist 的 Live2D 参数；不要采集摄像头、音频、原始脸部数据或 VTube Studio 画面，不要使用参数注入驱动模型。
- 会话级人工许可只确认 `camera-face-tracking` 已启用。当前运行中的有效许可可用于 `yawn`、`idle-soft-loop`、`greet-small/v2`、`sleep-enter/v1`、`happy-small/v1`、`surprised-small/v1` 和 `flustered-small/v1` 的独立手动 take；它不是特定 take 的视觉批准，也绝不启动自动连录。
- 每个 take 仍须自动重跑 CurrentModel、完整参数签名、profile allowlist、时长、FPS、Loop 和受管相对 outputPrefix preflight，并独立 arm、digest、staging candidate、readback 与 draft 输出。renderer 不得借此覆盖 profile 参数、路径、runtime 状态或 intake 目标。
- 对 `greet-small`，VTube Studio 只提供参数采样，绝不按动画热键，也不触发或重采样既有动画。
- 对 profile ID `greet-small` revision `v2`，录制器 UI 采集时长固定为 `3.0s`，前后 padding 均为 `0.2s`，所以预期 Motion3 为 `3.4s`；不要把 UI 采集时长和 Motion3 时长混写。
- 用户对既有 `greet-small` draft 的视觉否决优先于 parser、自动证据或 agent 多数意见；旧 `v1/2.0s` profile 与三份历史 draft 均不可复用或自动 fallback。
- 对 profile ID `sleep-enter` revision `v1`，固定采集 `2.4s`，前后 padding 均为 `0.3s`，预期 Motion3 为 `3.0s`、`30 FPS`、`Loop=false`，且只采集 `ParamAngleY`、`ParamEyeLOpen`、`ParamEyeROpen`。
- `sleep-enter/v1` 只允许生成受控 draft；不得据此开放 sleep runtime、production intake、`sleep-loop-soft` 或 `wake-up`。
- 对 `happy-small/v1`、`surprised-small/v1` 与 `flustered-small/v1`，VTube Studio 只读参数采样，不得注入 motion、expression 或 hotkey；它们的 CurrentModel 身份和参数签名仍按每个 take 自动重验。
- 对上述三个动作，所有实际导出的 allowlist 曲线都必须以同一中性基线闭合首尾；closed endpoint 阈值内的端点必须在生成时规范化为该中性基线，parser readback 必须以同一阈值和规范化口径复验。`happy-small` 的 required semantic variation 是 `ParamEyeLSmile`、`ParamEyeRSmile`、`ParamMouthForm` 的任一项，不是三项同时变化。辅助头眼曲线只有在序列化精度内恒定时才可省略；任一微小但非零的已序列化变化都必须保留，并经真实 Motion3 write/read 回读验证。若导出，必须结构有效；不得使用通用或审美幅度阈值阻塞。
- 每个 take 发布前只运行一次内建自动技术 readback：受管 output、parser/readback、active allowlist、有限且时间有序的曲线、required semantic variation、endpoint 规则和 cleanup。不要为每段重复代码审查、Skill/profile 批准、全量测试或 agent 审美投票。
- 技术通过后标记为 `draft / technical-pass / user-visual-review-pending`。动作自然度、幅度、节奏观感、美观和情绪效果由用户批量决定；agent 不得以审美理由要求重录。
- 未批准产物始终是 `draft`；没有明确 intake 授权时，不要写入 production 目标。
- 真实 VTS 连接只允许 `ws://127.0.0.1:<当前配置端口>`；拒绝非 `ws` 协议或非 `127.0.0.1` 主机。端口属于当前 connection 配置，必须读取并实测，不得写死或探测多个端口。
- token 只可引用 `main + safeStorage` 的可用性，不得读取、打印、复制或记录 token 值。
- 不接受逐 take 的 `准备好了` 作为录制许可；只有当前运行中有效的会话级 `camera-face-tracking` 人工许可可开始新的手动 take。其精确失效条件见 [take-contract.md](references/take-contract.md)。

## 状态机

按顺序执行；任一 gate 失败、摘要字段变化、用户取消或证据缺失时停止，记录 blocker，并只进入 cleanup。

1. **prepare**：读取当前 handoff 与相关 TASK、RESULT、ACCEPTANCE；建立清理基线和本次 ownership ledger。需要字段定义时读取 [take-contract.md](references/take-contract.md)。
2. **resolve-profile**：只从受信 catalog 解析 profile ID 和允许时长；读取 [profile-schema.md](references/profile-schema.md) 与对应 `references/profiles/` 文件。`planned-blocked`、未知或不一致 profile 一律停止。
3. **compatibility-check**：读取 [compatibility.md](references/compatibility.md)，验证两份 Skill identity、Live2dREC contract、VTS Public API、模型身份、能力快照和 Motion3/Cubism 门禁。
4. **verify-session-readiness**：首次使用前显示会话级 `camera-face-tracking` 人工确认；它仅存于 Live2dREC main service 当前运行内。确认有效时，用户可手动选择任一 ready profile；不显示或等待逐 take 的 `准备好了`。
5. **arm**：对每个手动选择的 profile 自动重跑 preflight，并冻结独立 take contract、profile revision/digest、连接配置、模型身份、能力快照、allowlist、时长和非绝对 outputPrefix；显示不可变 take ID 与短摘要。take TTL 或字段变化只撤销该 take，不撤销会话许可。
6. **countdown**：在仍有效的 armed take 上显示提示音与 `3`、`2`、`1`、`开始`；倒数前再次核对 contract digest，失配即停止。
7. **record**：仅采集 profile allowlist；锁定 capture 时长并只写入当前 take ownership ledger 中的 staging candidate。认证/连接失败，或 preflight/录制发现模型身份或参数签名变化时，按 [take-contract.md](references/take-contract.md) 立即撤销会话许可；其他 take 失败只清理该 take。发生参数越界、时长漂移或范围扩大时立即停止，不生成伪成功文件。
8. **parser-readback-and-publish**：用独立 Motion3 parser 回读 Version 3、Meta、Duration、FPS、Loop、曲线、单调有限数值和 allowlist；必须独立重验 active profile 的 required variation IDs、mode 与按生成同一阈值规范化的 closed neutral endpoints，并对每条微小辅助曲线完成真实 write/read 回读验证，不能只比较序列化 JSON 和内存对象。结构通过不等于用户视觉通过。只有 readback 成功后才能原子发布 candidate，并把该输出计为成功 draft；发布后，以及发布前/readback 失败或取消时，均必须重试本 take 临时 candidate 的 unlink，并单独追踪 `cleanupPending`。临时 unlink 持续失败时，必须生成含 `take_id`、owner、受控临时路径、重试状态和禁止删除 final 标记的结构化 cleanup handle，移交 managed drain；发布成功时合法 final 仍为成功 draft，发布前/readback 失败时保留原始录制失败，且 managed drain 不得删除或改报任何合法 final。
9. **technical-readback**：不重复代码、Skill/profile 或 agent 审美审核。每段只保留一次内建自动技术检查结果；通过时记为 `draft / technical-pass / user-visual-review-pending`。用户可在完成多段后批量决定视觉接受或逐段重录；未运行项写 `not-run`，不要补写通过。
10. **Cubism-refine**：要求在 Cubism Animator 中精修通过用户最终审核的 draft 并重新导出；不要把 VTS 采样直接视为生产动作。
11. **intake-approve**：要求用户明确批准具体 draft 和具体 intake 目标；复核 parser、用户最终审核、Cubism 精修及 loop 的额外门禁。
12. **intake**：仅写入获授权目标并记录批准依据与实际写入；任何未满足项只报告 blocker。
13. **cleanup**：依据 ownership ledger 仅停止或删除本 take 创建的 overlay、timer、socket、进程、临时目录、截图和日志；对已发布 draft 的 `cleanupPending` 临时 candidate，只能在显式 drain、下一次写入或主进程关闭时继续清扫，不得将合法 final 改报为失败；不要关闭用户已有 VTube Studio 资源。

## 首次多动作录制顺序

以下顺序仅定义用户可选择的 session 队列，不构成自动连录。完成、失败或取消任一段后，必须停止，保留其独立 draft/digest/output，并等待用户明确选择下一段：

1. `sleep-enter/v1`（`state.enter`）
2. `happy-small/v1`（`gesture.one-shot`）
3. `surprised-small/v1`（`gesture.one-shot`）
4. `flustered-small/v1`（`gesture.one-shot`）

切换 ready profile 只废弃旧 take、断开其 adapter，并为下一段重新运行自动 CurrentModel/参数签名/allowlist/时长/FPS/Loop/outputPrefix preflight、arm 与 digest 展示；不得要求重复 camera-face-tracking 人工确认或 `准备好了`。每段只写入由当前 profile 和唯一 take ID 派生的受管相对 output；后续段失败或取消时不得覆盖、删除或复用先前段的 draft。`sleep-loop-soft` 与 `wake-up` 保持 `planned-blocked`：它们需要已接受 `sleep-enter` draft 产生真实 anchors，且 runtime/loop contracts 仍未完成。

## 按需读取

- 解析 profile、模板、状态或字段约束：读 [profile-schema.md](references/profile-schema.md)。
- 创建、显示、失效或审计当前 take：读 [take-contract.md](references/take-contract.md)。
- 检查版本、API、文件格式与包一致性：读 [compatibility.md](references/compatibility.md)。
- 选择 canonical 动作、共享 idle 别名或 fallback：读 [motion-catalog.md](references/motion-catalog.md)。
- 录制 yawn：读 [yawn-v1.md](references/profiles/yawn-v1.md)。
- 录制 `idle-soft-loop`：读 [idle-soft-loop-v1.md](references/profiles/idle-soft-loop-v1.md)。
- 录制 `greet-small` revision `v2`：读 [greet-small-v2.md](references/profiles/greet-small-v2.md) 并按其中详细节奏表演；关键低点在采集 `1.15-1.35s`，`2.55s` 前抬回中性附近并收稳。产物仍仅为 draft。
- 录制 `sleep-enter` revision `v1`：读 [sleep-enter-v1.md](references/profiles/sleep-enter-v1.md)，人工确认摄像头面捕后按其中节奏同步低头与闭眼；结果只可作为 draft，后续 sleep loop 与 wake 仍阻塞。
- 录制 `happy-small` revision `v1`：读 [happy-small-v1.md](references/profiles/happy-small-v1.md)，复用有效会话许可但重跑独立自动 preflight；结果只可作为独立 draft。
- 录制 `surprised-small` revision `v1`：读 [surprised-small-v1.md](references/profiles/surprised-small-v1.md)，复用有效会话许可但重跑独立自动 preflight；结果只可作为独立 draft。
- 录制 `flustered-small` revision `v1`：读 [flustered-small-v1.md](references/profiles/flustered-small-v1.md)，复用有效会话许可但重跑独立自动 preflight；结果只可作为独立 draft。

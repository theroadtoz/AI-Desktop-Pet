# Take Contract

Schema version: `live2d-take-contract/v1`.

在 arm 阶段生成不可变 contract，并把完整摘要显示在当前界面。contract 只记录安全摘要，绝不包含 token、绝对路径、摄像头/音频/画面或原始脸部数据。

## 必填字段

| 字段 | 要求 |
| --- | --- |
| `take_id` | 本次唯一 ID；旧 ID 不可复用。 |
| `profile` | 由当前 Live2dREC UI resolved profile summary 冻结的 `id`、`revision`、`digest`、`status=ready`。 |
| `template` | 冻结后的 templateKind。 |
| `connection` | 实测的 protocol、host、port、tool 配置来源与 VTS 实际值；port 不写死。 |
| `token_ref` | 仅 `main + safeStorage` 的引用/可用性结果；不得含 token 值。 |
| `model_identity` | CurrentModel 的安全身份、模型参数签名或等价受信标识。 |
| `capabilities` | API state、鉴权、CurrentModel、Live2DParameterList 与允许参数存在性的快照。 |
| `allowlist` | 从 v2 profile 冻结的完整 41 参数 ID 集合；缺任一项即阻塞。 |
| `required_output_parameter_ids` | 完整 41 参数的 exact-output 集合；包含平坦连续曲线与全零组件组。 |
| `variation_groups` | 冻结的连续参数集与定时组件组定义，含连续/stepped 模式边界。 |
| `timed_accessory_groups` | 冻结的七个定时组件组成员、值域和 stepped 规则；不得由静态 `requiredAccessoryStates` 代替。 |
| `capture_duration` | 由当前 profile summary 冻结的实际采集时长。 |
| `motion_duration` | 由当前 profile summary 冻结的预期 Motion3 Meta.Duration。 |
| `cycle_duration` | loop 的周期语义；one-shot/enter/exit 必须明确为不适用。 |
| `outputPrefix` | 当前 summary 派生的相对受管前缀；不得为绝对路径。 |
| `ownership` | 本 take 可创建、可停止、可删除的资源 ledger。 |
| `created_at` / `expires_at` | armed 时间和失效时间。 |

## 会话级 Camera-Face-Tracking 许可

1. `camera-face-tracking` 是当前 Live2dREC main service 运行内唯一可复用的人工前置条件；它不属于 active recording session object，不能持久化、不能复用到应用重启后，也不授予 renderer 覆盖 profile 参数、output path、runtime state 或 intake target 的权限。
2. 用户只需在该会话中确认一次；有效时仅可手动发起 Live2dREC 当前受信 catalog 标为 `ready` 的独立 take。它不批准具体视觉 take，不会自动开始、连续或批量录制，也不能覆盖当前 UI resolved profile summary。
3. 应用重启或被销毁、用户取消/取消勾选、connection configuration 变化、认证或连接失败、profile prerequisite definition 变化，或 preflight/recording 发现 CurrentModel 身份或参数签名变化时，必须立即撤销会话许可。
4. take 完成、readback/write 失败、take TTL 到期、重新 prepare 或切换 ready profile 不撤销会话许可；它们只使当前 take 失效。下一段仍须完成自动 preflight。

## Take Contract 失效

1. 每个 take 自动 arm，且不再等待逐 take 的 `准备好了`。
2. armed take 上限为 10 分钟或 recorder 工具 TTL，以更短者为准。
3. 当前 profile summary 的 revision/digest、template、connection、token 可用性、模型身份、能力快照、allowlist、required output、任一时长、padding、FPS、Loop、outputPrefix 或 ownership 变化时，立即让该 armed contract 失效。
4. take 失效后必须重新 arm、重新显示新 take ID 并重跑自动 preflight；旧 take、连接成功和鉴权成功均不能替代该 preflight。认证/连接失败与模型身份/参数签名漂移还必须按上节撤销会话许可；其他 readback/write 或重新 prepare 失败只清理当前 take candidate。

## Ownership Ledger

在创建资源前追加 `kind`、受控标识、创建时间和 owner=`take_id`；仅清理该 ledger 中仍由本流程拥有的资源。每个清理结果记录 `removed`、`retained-user-owned`、`not-found` 或 `failed`，并给出原因。保留被明确批准保存的 draft。

## Output Publication

录制文件先是当前 take ledger 中的 staging candidate，不是成功 draft。独立 Motion3 parser readback 必须重验完整 41 个 required output、连续/stepped 模式、范围、边界、合法互斥状态、时间与 Meta 计数，并独立验证 motion-owned 参数的播放优先级和最新持久状态恢复，而不只比较序列化 JSON 与内存对象。readback 通过后，才可将它原子发布到 profile/take ID 派生的受管相对 output；原子发布成功是唯一可报告输出成功的时点。发布后，以及发布前/readback 失败或取消时，均必须重试本 take 临时 candidate 的 unlink，并单独追踪 `cleanupPending`。临时 unlink 持续失败时，必须生成含 `take_id`、owner、受控临时路径、重试状态和禁止删除 final 标记的结构化 cleanup handle，移交 managed drain；发布成功时合法 final 仍为成功 draft，发布前/readback 失败时保留原始录制失败，且 managed drain 不得删除或改报任何合法 final。

P2-64Z-2 不改变上述 Output Publication 安全链：每段都必须完成内建 parser readback、原子发布 draft 以及相应 cleanup，随后才可隔离展示并记录用户人工裁决。延后的仅是 P2-64X 式额外 post-hoc 正式技术验收；全部 10 段完成人工裁决后，才锁定用户通过的 exact sources 并批量执行该验收。

## User-Authorized VTS Draft Intake Summary

只有用户明确点名当前 exact source 与 exact runtime target 时，take contract 才能附加此例外摘要：`intakeStatus=user-authorized-vts-draft`、`userVisualReview=passed`、`cubismRefined=false`、`runtimeEnabled=true`。摘要必须同时包含 P2-52 dry-run 结果、用户授权来源证据引用、source/target 的 safe relative path、Model CDI3 摘要、hash 以及 `sourceTargetEqual=true`；这些值必须在写入前重新核对，不能由草稿元数据自报。

例外批次以 all-or-nothing 原子性写入 exact runtime target；失败时不得部分写入。原始 VTS 草稿及上述来源证据必须保留。写入后仅对 exact target 做一次针对性技术播放，且不得把结果称为 Cubism refined、quality certified 或等价质量结论；例外不改变普通路径的 Cubism Animator 精修/重新导出要求，也不成为后续 take 的默认路径。

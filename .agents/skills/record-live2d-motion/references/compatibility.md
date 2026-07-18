# Compatibility Contract

真实录制前必须逐项通过；任一未知、不一致或证据过期都阻塞，不自动修复、降级或猜测。

## Contract Authority

- 本 Skill 不维护 release identity、package digest 或双副本 parity 要求。
- 每次录制均以 `E:\Work-26\Live2dREC` 的受信 catalog 与当前 UI resolved profile 为唯一契约来源。只有其中相互一致的 profile ID、revision、status、duration、padding、FPS、Loop、allowlist、outputPrefix 和 profile digest 可以进入 arm。
- `references/motion-catalog.md` 和 `references/profiles/` 仅用于历史或技术说明，不属于 active contract，不能由 resolve、preflight、arm 或 record 使用，也不得覆盖当前 summary。

### Quick Validation

Windows 默认代码页可能无法读取本 Skill 的中文 UTF-8 内容。运行以下结构校验；它只验证本地 Skill 的格式，不能证明 Live2dREC profile 已通过运行时门禁：

```powershell
python -X utf8 "C:\Users\1\.codex\skills\.system\skill-creator\scripts\quick_validate.py" "E:\Work-26\AI_Desktop_Pet\.agents\skills\record-live2d-motion"
```

## Session Approval Contract

- 只可复用当前 Live2dREC main service 运行内的 `camera-face-tracking` 人工许可；它仅覆盖当前 catalog 标为 `ready` 的手动独立 take，不覆盖任何具体 take 的视觉结论，也不允许自动连录。
- 每个手动选择的 ready profile 仍必须自动比对 CurrentModel、完整参数签名、当前 summary 的 allowlist、duration、padding、FPS、Loop 和 outputPrefix，并生成独立 take contract、digest、candidate 与 output。renderer 不得覆盖这些受信字段。
- 只在应用重启/销毁、用户取消、connection configuration 变化、认证/连接失败、profile prerequisite definition 变化，或 preflight/recording 发现模型身份或参数签名变化时撤销会话许可。take 结束、readback/write 失败、TTL 到期、重新 prepare 或切换 ready profile 只撤销当前 take。
- 每个 take 发布前仅运行一次内建自动技术 readback：managed output、parser/readback、active allowlist、有限有序曲线、当前 summary 要求的 semantic variation、endpoint/seam 规则和 cleanup。通过时原子发布并标记 `draft / technical-pass / user-visual-review-pending`；该结果是 Live2dREC 发布安全门禁，不等于 P2-64X 式额外 post-hoc 正式技术验收。
- P2-64Z 当前阶段覆盖 10 段长动作：每段完成内建 readback、原子发布与 cleanup 后立即隔离展示并由用户人工审查；全部 10 段完成人工裁决后，才对用户通过的锁定 exact sources 批量执行额外 post-hoc 正式技术验收。

## Live2dREC Contract

- 接受 main/core 的受信 current profile summary、revision/digest、允许时长、padding、FPS、Loop、受管相对 outputPrefix 和 immutable take contract。
- 拒绝 unknown、非 `ready`、对象注入、过期 revision/digest、非法时长、参数/路径/Loop/FPS/padding 覆盖和 profile 选择不一致。
- 变化必须撤销 armed take；在 VTS 连接、授权、倒数和写文件前失败。
- 每条实际导出的 allowlist 曲线必须有限、时间有序，并按当前 summary 要求满足 closed endpoint 或 seam 规则。closed endpoint 阈值、规范化口径、required semantic variation 与辅助曲线是否可省略都由当前 summary 决定；parser readback 必须独立复验，不能仅比较序列化 JSON 与内存对象。
- 连接或 preflight 失败时，必须先消费当前 take 的人工前置条件确认，再等待或触发 candidate adapter 清理。
- 输出必须先成为本 take ownership ledger 中的 staging candidate，经独立 parser readback 成功后原子发布。只有原子发布成功才可报告成功 draft；发布后，以及发布前/readback 失败或取消时，均必须重试本 take 临时 candidate 的 unlink，并单独追踪 `cleanupPending`。临时 unlink 持续失败时，必须生成含 `take_id`、owner、受控临时路径、重试状态和禁止删除 final 标记的结构化 cleanup handle，移交 managed drain；发布成功时合法 final 仍为成功 draft，发布前/readback 失败时保留原始录制失败，且 managed drain 不得删除或改报任何合法 final。
- 若 profile 含 `timedAccessoryGroups`，参与组必须以完整成员输出 `0/30` 值域的 Motion3 stepped 曲线，检查初始值、每次切换、最终值、时间单调、时长范围和 Meta 计数；`requiredAccessoryStates` 不得充当该时间线。`ParamMouthForm` 与 `ParamMouthOpenY` 必须作为同一 `all-of` variation group 且均真实变化；不得引入眼泪/生气旧组件要求。

## VTube Studio Public API

- 真实 VTS 连接只允许 `ws://127.0.0.1:<当前配置端口>`；protocol 必须严格为 `ws`，host 必须严格为 `127.0.0.1`，否则在连接前阻塞。
- 从 Live2dREC 当前 connection 配置读取 port，实测并比对 VTS 实际 port；不要写死端口或尝试多个端口。
- 依次验证 `APIStateRequest`、鉴权、`CurrentModelRequest`、`Live2DParameterListRequest`；不要把 `ParameterValueRequest` 当作参数表读取 API。
- CurrentModel 身份、参数签名和 allowlist 存在性必须与冻结的 take contract 一致；token 只能由 `main + safeStorage` 使用。

## Motion3 And Cubism

- parser readback 必须证明 Motion3 `Version: 3`、`Meta`、正且匹配当前 take contract 的 Duration、有限单调曲线、参数 allowlist、计数一致和冻结的 draft Loop 值。
- loop draft 的 `Loop=false`、seam 数值闭合、速度连续、三周期视觉复核和最终 `Loop=true` 是不同门禁，不能互相替代。
- Cubism Animator 精修与重新导出是 production intake 前置条件；parser 通过或 VTS 连接成功都不等于视觉通过。

## P2-65 User-Authorized VTS Draft Exception

默认仍是 `technical readback -> user visual review -> Cubism Animator refine/re-export -> explicit intake`。仅当用户在当前 intake 明确写出一个 exact source 和一个 exact runtime target，才可使用一次 `user-authorized-vts-draft` 例外；它不是 profile 默认值、未来默认路径、批量授权或 Cubism 质量认证。

例外在 intake-approve 前必须完成并记录以下安全摘要；缺一项即阻塞：

- P2-52 motion-resource dry-run 必须通过，且仍为 dry-run；不能以 dry-run 结果直接改写 product manifest 或 runtime catalog。
- 用户授权来源证据必须明确指向本次 exact source、exact runtime target 和本次批次；不得使用口头概括、旧批准或隐含同意替代。
- source 与 target 的 Motion3 路径必须是受管 safe relative path，拒绝绝对路径、上跳路径、符号链接逃逸和用户注入路径。
- source 的 Motion3 parser readback、目标模型的 Model CDI3 身份和文件 hash 必须分别核对；source/target 记录的模型 CDI3 与 hash 必须相等，且 `sourceTargetEqual=true`。这里的相等只表示已核验的来源与运行目标确实相同，不表示动作已由 Cubism 精修。
- 整个批次只能在所有条目门禁通过后原子写入；任何条目失败都不得部分 intake，并保留每个原始 VTS 草稿。
- 写入后只允许对 exact runtime target 做针对性技术播放，核对模型身份、allowlist/ownership 和完成/恢复边界；不得播放、注入或触发其他动作、expression 或 hotkey。

例外结果必须固定为 `intakeStatus=user-authorized-vts-draft`、`userVisualReview=passed`、`cubismRefined=false`、`runtimeEnabled=true`，并保留原始草稿、source/target 摘要、hash、Model CDI3 摘要和用户授权来源证据。该结果不得标记为 `Cubism refined`、`quality certified` 或等价措辞；普通路径的 Cubism 前置条件不因本例外而改变。

# Compatibility Contract

真实录制前必须逐项通过；任一未知、不一致或证据过期都阻塞，不自动修复、降级或猜测。

## Skill Package

- 两个副本必须同为 release `record-live2d-motion-2026-07-15.8`、profile schema `live2d-recorder-profile/v1` 和 take contract schema `live2d-take-contract/v1`。
- 比对 `SKILL.md`、`agents/openai.yaml`、本目录四个通用 references 和七个 profile references 的 canonical content digest。
- 按以下固定顺序，以 UTF-8 无 BOM、LF 行尾读取每个文件：`SKILL.md`、`agents/openai.yaml`、`references/profile-schema.md`、`references/take-contract.md`、`references/compatibility.md`、`references/motion-catalog.md`、`references/profiles/yawn-v1.md`、`references/profiles/idle-soft-loop-v1.md`、`references/profiles/greet-small-v2.md`、`references/profiles/sleep-enter-v1.md`、`references/profiles/happy-small-v1.md`、`references/profiles/surprised-small-v1.md`、`references/profiles/flustered-small-v1.md`。将 `SKILL.md` 的 `Package-content-digest` 值替换为 64 个 `0`，再串联每项的相对路径、LF、内容、LF，并计算 SHA-256 小写十六进制。结果必须等于 SKILL 中声明的 digest。

### Quick Validation

Windows 默认代码页可能无法读取本 Skill 的中文 UTF-8 内容。使用 `-X utf8` 分别验证 source 和 global 副本，每条命令均可独立运行：

```powershell
python -X utf8 "C:\Users\1\.codex\skills\.system\skill-creator\scripts\quick_validate.py" "E:\Work-26\AI_Desktop_Pet\.agents\skills\record-live2d-motion"
python -X utf8 "C:\Users\1\.codex\skills\.system\skill-creator\scripts\quick_validate.py" "C:\Users\1\.codex\skills\record-live2d-motion"
```

## Live2dREC Contract

- 接受 main/core 的受信 profile summary、revision/digest、允许时长、受管相对 outputPrefix 和 immutable take contract。
- 拒绝 unknown、`planned-blocked`、对象注入、过期 revision/digest、非法时长、参数/路径/Loop/FPS/padding 覆盖和 profile 选择不一致。
- 变化必须撤销 armed take；在 VTS 连接、授权、倒数和写文件前失败。
- 对 `happy-small/v1`、`surprised-small/v1` 与 `flustered-small/v1`，每条实际导出的 allowlist 曲线必须有限、时间有序并以同一中性基线闭合首尾。closed endpoint 阈值内的端点必须在生成时规范化为该中性基线，parser readback 必须以同一阈值和规范化口径复验。`happy-small` 只要求 `ParamEyeLSmile`、`ParamEyeRSmile`、`ParamMouthForm` 的任一项有 semantic variation；`surprised-small` 只要求 `ParamBrowLY`，`flustered-small` 只要求 `ParamBrowLForm`。辅助头眼曲线只有在序列化精度内恒定时可省略；任一微小但非零的已序列化变化都必须保留，并经真实 Motion3 write/read 回读验证；若导出则必须结构有效；不得使用通用或审美幅度阈值。
- parser readback 必须独立重验 active profile 的 required variation IDs、mode 与按生成同一阈值规范化的 closed endpoints，不能仅比较序列化 JSON 与内存对象。
- 连接或 preflight 失败时，必须先消费当前 take 的人工前置条件确认，再等待或触发 candidate adapter 清理。
- 输出必须先成为本 take ownership ledger 中的 staging candidate，经独立 parser readback 成功后原子发布。只有原子发布成功才可报告成功 draft；发布后，以及发布前/readback 失败或取消时，均必须重试本 take 临时 candidate 的 unlink，并单独追踪 `cleanupPending`。临时 unlink 持续失败时，必须生成含 `take_id`、owner、受控临时路径、重试状态和禁止删除 final 标记的结构化 cleanup handle，移交 managed drain；发布成功时合法 final 仍为成功 draft，发布前/readback 失败时保留原始录制失败，且 managed drain 不得删除或改报任何合法 final。

## VTube Studio Public API

- 真实 VTS 连接只允许 `ws://127.0.0.1:<当前配置端口>`；protocol 必须严格为 `ws`，host 必须严格为 `127.0.0.1`，否则在连接前阻塞。
- 从 Live2dREC 当前 connection 配置读取 port，实测并比对 VTS 实际 port；不要写死端口或尝试多个端口。
- 依次验证 `APIStateRequest`、鉴权、`CurrentModelRequest`、`Live2DParameterListRequest`；不要把 `ParameterValueRequest` 当作参数表读取 API。
- CurrentModel 身份、参数签名和 allowlist 存在性必须与 take contract 一致；token 只能由 `main + safeStorage` 使用。

## Motion3 And Cubism

- parser readback 必须证明 Motion3 `Version: 3`、`Meta`、正且匹配的 Duration、有限单调曲线、参数 allowlist、计数一致和 profile 的 draft Loop 值。
- loop draft 的 `Loop=false`、seam 数值闭合、速度连续、三周期视觉复核和最终 `Loop=true` 是不同门禁，不能互相替代。
- Cubism Animator 精修与重新导出是 production intake 前置条件；parser 通过或 VTS 连接成功都不等于视觉通过。

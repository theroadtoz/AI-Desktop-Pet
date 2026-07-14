# Compatibility Contract

真实录制前必须逐项通过；任一未知、不一致或证据过期都阻塞，不自动修复、降级或猜测。

## Skill Package

- 两个副本必须同为 release `record-live2d-motion-2026-07-14.1`、profile schema `live2d-recorder-profile/v1` 和 take contract schema `live2d-take-contract/v1`。
- 比对 `SKILL.md`、`agents/openai.yaml`、本目录四个通用 references 和两个 profile references 的 canonical content digest。
- 按以下固定顺序，以 UTF-8 无 BOM、LF 行尾读取每个文件：`SKILL.md`、`agents/openai.yaml`、`references/profile-schema.md`、`references/take-contract.md`、`references/compatibility.md`、`references/motion-catalog.md`、`references/profiles/yawn-v1.md`、`references/profiles/idle-soft-loop-v1.md`。将 `SKILL.md` 的 `Package-content-digest` 值替换为 64 个 `0`，再串联每项的相对路径、LF、内容、LF，并计算 SHA-256 小写十六进制。结果必须等于 SKILL 中声明的 digest。

## Live2dREC Contract

- 接受 main/core 的受信 profile summary、revision/digest、允许时长、受管相对 outputPrefix 和 immutable take contract。
- 拒绝 unknown、`planned-blocked`、对象注入、过期 revision/digest、非法时长、参数/路径/Loop/FPS/padding 覆盖和 profile 选择不一致。
- 变化必须撤销 armed take；在 VTS 连接、授权、倒数和写文件前失败。

## VTube Studio Public API

- 真实 VTS 连接只允许 `ws://127.0.0.1:<当前配置端口>`；protocol 必须严格为 `ws`，host 必须严格为 `127.0.0.1`，否则在连接前阻塞。
- 从 Live2dREC 当前 connection 配置读取 port，实测并比对 VTS 实际 port；不要写死端口或尝试多个端口。
- 依次验证 `APIStateRequest`、鉴权、`CurrentModelRequest`、`Live2DParameterListRequest`；不要把 `ParameterValueRequest` 当作参数表读取 API。
- CurrentModel 身份、参数签名和 allowlist 存在性必须与 take contract 一致；token 只能由 `main + safeStorage` 使用。

## Motion3 And Cubism

- parser readback 必须证明 Motion3 `Version: 3`、`Meta`、正且匹配的 Duration、有限单调曲线、参数 allowlist、计数一致和 profile 的 draft Loop 值。
- loop draft 的 `Loop=false`、seam 数值闭合、速度连续、三周期视觉复核和最终 `Loop=true` 是不同门禁，不能互相替代。
- Cubism Animator 精修与重新导出是 production intake 前置条件；parser 通过或 VTS 连接成功都不等于视觉通过。

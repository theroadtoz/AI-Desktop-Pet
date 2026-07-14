---
name: record-live2d-motion
description: 受控录制、回读、人工复核和 intake Live2D Motion3 草稿。用于通过 Live2dREC 与 VTube Studio 准备或录制已批准 profile、检查既有 Motion3、在 Cubism Animator 精修后接入动作；要求当前 take 明确确认、参数 allowlist、兼容性门禁和零越权清理。
---

# 录制 Live2D 动作

## Release Identity

- Release ID: `record-live2d-motion-2026-07-14.1`
- Profile schema: `live2d-recorder-profile/v1`
- Take contract schema: `live2d-take-contract/v1`
- Package-content-digest: `sha256:46611aac1e14a7b9879b481821c36ac0d7bf166a424df4758a89ac7f5bf95382`

只在两个安装副本的 release、schema 和 package digest 完全一致时继续真实录制。按 [compatibility.md](references/compatibility.md) 计算或比对 digest；不一致即阻塞，不要自动同步或修改其他副本。

## 硬边界

- 只读检查 `E:\Work-26\Live2dREC`；不要修改 recorder、桌宠 runtime、模型、manifest、preset 或 catalog，除非用户另行明确授权。
- 只采集已批准 allowlist 的 Live2D 参数；不要采集摄像头、音频、原始脸部数据或 VTube Studio 画面，不要使用参数注入驱动模型。
- 未批准产物始终是 `draft`；没有明确 intake 授权时，不要写入 production 目标。
- 真实 VTS 连接只允许 `ws://127.0.0.1:<当前配置端口>`；拒绝非 `ws` 协议或非 `127.0.0.1` 主机。端口属于当前 connection 配置，必须读取并实测，不得写死或探测多个端口。
- token 只可引用 `main + safeStorage` 的可用性，不得读取、打印、复制或记录 token 值。
- 只接受当前 take 的完全一致回复 `准备好了`；连接、鉴权、旧聊天或旧 take 的确认都不是许可。

## 状态机

按顺序执行；任一 gate 失败、摘要字段变化、用户取消或证据缺失时停止，记录 blocker，并只进入 cleanup。

1. **prepare**：读取当前 handoff 与相关 TASK、RESULT、ACCEPTANCE；建立清理基线和本次 ownership ledger。需要字段定义时读取 [take-contract.md](references/take-contract.md)。
2. **resolve-profile**：只从受信 catalog 解析 profile ID 和允许时长；读取 [profile-schema.md](references/profile-schema.md) 与对应 `references/profiles/` 文件。`planned-blocked`、未知或不一致 profile 一律停止。
3. **compatibility-check**：读取 [compatibility.md](references/compatibility.md)，验证两份 Skill identity、Live2dREC contract、VTS Public API、模型身份、能力快照和 Motion3/Cubism 门禁。
4. **arm**：冻结 take contract、profile revision/digest、连接配置、模型身份、能力快照、allowlist、时长和非绝对 outputPrefix；显示不可变 take ID 与短摘要。
5. **confirm-current-take**：仅在当前不可变摘要可见后等待用户完全一致回复 `准备好了`。确认有效期取 10 分钟与工具 TTL 中更短者；任何字段变化立即撤销确认。
6. **countdown**：在仍有效的 armed take 上显示提示音与 `3`、`2`、`1`、`开始`；倒数前再次核对 contract digest，失配即停止。
7. **record**：仅采集 profile allowlist；锁定 capture 时长并按 profile 输出 draft。发生参数越界、连接/模型变化、时长漂移或范围扩大时立即停止，不生成伪成功文件。
8. **parser-readback**：用独立 Motion3 parser 回读 Version 3、Meta、Duration、FPS、Loop、曲线、单调有限数值和 allowlist；结构通过不等于视觉通过。
9. **human-review**：分别记录真实工具 UI、VTS 参数证据和人工视觉结论；未运行项写 `not-run`，不要补写通过。
10. **Cubism-refine**：要求在 Cubism Animator 中精修通过人工复核的 draft 并重新导出；不要把 VTS 采样直接视为生产动作。
11. **intake-approve**：要求用户明确批准具体 draft 和具体 intake 目标；复核 parser、人工视觉、Cubism 精修及 loop 的额外门禁。
12. **intake**：仅写入获授权目标并记录批准依据与实际写入；任何未满足项只报告 blocker。
13. **cleanup**：依据 ownership ledger 仅停止或删除本 take 创建的 overlay、timer、socket、进程、临时目录、截图和日志；不要关闭用户已有 VTube Studio 资源。

## 按需读取

- 解析 profile、模板、状态或字段约束：读 [profile-schema.md](references/profile-schema.md)。
- 创建、显示、失效或审计当前 take：读 [take-contract.md](references/take-contract.md)。
- 检查版本、API、文件格式与包一致性：读 [compatibility.md](references/compatibility.md)。
- 选择 canonical 动作、共享 idle 别名或 fallback：读 [motion-catalog.md](references/motion-catalog.md)。
- 录制 yawn：读 [yawn-v1.md](references/profiles/yawn-v1.md)。
- 录制 `idle-soft-loop`：读 [idle-soft-loop-v1.md](references/profiles/idle-soft-loop-v1.md)。

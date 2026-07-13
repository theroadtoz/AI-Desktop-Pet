---
name: record-live2d-motion
description: 受控录制、严格回读和人工复核 Live2D Motion3 草稿。用于为 AI 桌宠通过已有候选动作或 VTube Studio 录制参数轨道、准备演示、回读 Motion3 文件，或进行已批准动作的 intake；要求 VTS API 目标一致、本次 take 的外部确认、已批准参数集合、最小采集范围和零残留清理。
---

# 录制 Live2D 动作

## 边界

- 只把 `E:\Work-26\Live2dREC` 当作独立工具目录；只读检查其实现和配置，除非用户另行明确授权，否则不要修改其中任何代码。
- 不要修改 `E:\Work-26\AI_Desktop_Pet` 的运行代码、`model/`、manifest、preset 或 catalog。
- 只录制 Live2D 参数。不要采集或保存摄像头、麦克风/音频、原始脸部数据或 VTube Studio 画面。
- 将未批准产物标记为 `draft`。未获得明确批准前，不要写入桌宠模型目录、manifest、preset 或 catalog。

## 先读上下文

1. 先只读 `E:\Work-26\AI_Desktop_Pet\docs`。
2. 先读取 handoff 文件，再读取与本次动作相关的 `*TASK*`、`*RESULT*`、`*ACCEPTANCE*` 文件；优先使用当前阶段和最近日期的文件。
3. 记录已确认的模型入口、参数 allowlist、候选文件、动作时长、输出暂存位置和验收结论。不要用旧聊天或旧 take 的结论替代文档证据。
4. 遇到缺失、冲突或未批准的关键事实，标记为未决；不要猜测。

## 识别本次类型

只选择一个主类型，并按对应规则执行。

| 类型 | 允许的工作 | 禁止的工作 |
| --- | --- | --- |
| 准备 | 检查文档、候选、端口、token 路径、allowlist 和清理基线；输出准备清单 | 启动真实录制、触发倒计时、写入 Motion3 |
| 真实录制 | 在本次明确确认后录制一个锁定时长的 take | 复用旧确认、临时改时长、扩大采集范围 |
| 演示 | 显示将要执行的步骤和界面状态；标明未录制 | 声称已录制或已通过人工复核 |
| 回读 | 用 parser 读取既有 Motion3 并报告结构、时长和参数 | 将回读成功视为视觉通过或 intake 批准 |
| intake | 审核已批准的 draft，按用户明确授权接入 | 在批准前写模型、manifest、preset 或 catalog |

## 未准备好时停止

在用户尚未明确表示本次 take 已准备好时，只给出准备清单并停止。准备清单必须包括：

1. 已读文档和仍缺的事实。
2. 候选文件及严格检查结果。
3. Live2dREC 配置的 VTS API 目标地址/端口与 VTS 实际 API 地址/端口的实测值。
4. 本次 take 的固定时长、allowlist、暂存输出位置和仅参数采集范围。
5. token 的 `main + safeStorage` 可用性检查结果，但不得输出 token 值。
6. 录制前需由用户完成的 VTube Studio 状态和人工视觉观察位置。

当前工具没有一次性的 current-take confirmation 字段。把用户对本次 take 的“准备好了”作为 agent 维护的外部门禁；收到前绝不能调用 `startRecording`。连接成功、授权成功或 token 成功绝不等于录制许可。不要把“可以开始”“上次准备好了”或任意旧确认当作许可。只有用户针对当前 take 明确回复完全一致的“准备好了”后，才进入真实录制。

## 候选优先

1. 先枚举已有 candidate，不要先启动 VTube Studio fallback。
2. 对每个 candidate 严格用 Motion3 parser 回读：确认 `Version: 3`、`Meta` 存在、`Meta.Duration` 为正且与本次锁定时长相容、曲线参数全在 allowlist 内、数值可解析且时间单调。
3. 只在能无损且可回读地安全规范化时规范化 candidate；保留原文件，不覆盖，并将结果标记为 `draft`。
4. 出现版本不为 3、缺失 Meta/Duration、未知参数、损坏曲线、无法证明时长一致或规范化后无法 parser 回读时，判定为不能安全规范化。
5. 只有在所有可用 candidate 都不能安全规范化时，才允许进入 VTube Studio fallback。
6. 确认当前 recorder core 固定使用 `YAWN_SEMANTIC_GESTURE_ALLOWLIST`。只在本次动作的已批准参数集合与该固定集合完全一致时使用 recorder；不要将 yawn allowlist 复用于 wave 等新动作。
7. 本次动作缺少专属 allowlist，或其已批准集合与工具固定集合不同时，诚实报告 `blocked`，不要录制；先新建 Live2dREC 工具通用化实现任务，再等待该任务完成和批准。

## VTube Studio 和 Live2dREC 预检

1. 在 `E:\Work-26\Live2dREC` 只读检查其配置的 VTS API 目标地址和端口；不要把工具描述为监听独立端口，也不要只根据说明、旧配置或记忆判断。
2. 将 Live2dREC 配置的 VTS API 目标地址/端口与 VTS 实际 API 地址/端口逐项比对。当前实现默认目标是 `127.0.0.1:8001`；用户此前可能使用过 `8002`。
3. 任一地址或端口不一致时，立即停止，报告两端实测值，并等待用户修正。不要猜测端口、自动改端口或尝试多个端口。
4. 只使用工具既有的 `main + safeStorage` token 流程。确认 token 可解封和可鉴权，但不要读取、打印、复制、写入日志或回显 token。
5. 明确关闭摄像头、音频、原始脸部数据和 VTube Studio 画面采集；只启用 allowlist 中的参数轨道。
6. 检查无遗留 overlay、timer、socket、临时目录、截图、日志和本流程启动的多余进程；确认基线为 0 后再继续。

## 真实录制

仅在本次 take 已收到用户明确的“准备好了”后执行以下步骤。

1. 再次显示并锁定 take 名称、固定时长、allowlist、输出暂存路径和 `draft` 状态。开始后不得修改时长。
2. 确认提示音已启用，并向用户显示 `3`、`2`、`1`、`开始` 的倒计时状态。
3. 在倒计时结束时开始只参数录制；按 `0.1s` 更新 timecode 直到显示 `00.0`，并在 deadline 到达时停止。不要在剩余 `0.1s` 时提前停止。
4. 单独验证真实 UI 中 `00.0` 可见。当前服务可能在 `00.0` 渲染前停止；真实验收无法证明 `00.0` 可见时，将该项标记为 `not-run` 或失败，并新建 timecode 修复任务。
5. 为本次 take 分别记录：工具真实 UI 证据、VTube Studio 连接/参数证据、人工观察结论。不要把其中任何一类替代为另一类。
6. 若 UI、VTube Studio 或人工观察未运行，将该项写为 `not-run`，不要补写成功结论。
7. 发生端口变化、token 失败、参数越出 allowlist、时长漂移、采集范围扩大或用户取消时，立即停止并保留失败原因；不要生成伪成功文件。

## 回读和视觉复核

1. 用 Motion3 parser 回读输出，确认 `Version: 3`、`Meta`、`Meta.Duration`、锁定时长和所有参数 allowlist 均符合要求。
2. 将 parser 结果与录制时的参数证据分开报告。parser 通过仅表示文件结构通过。
3. 将动作保持为 `draft`，安排人工视觉复核：检查时长、起止、表情/姿态连续性、非预期抖动和与预期动作的匹配。
4. 将人工视觉结论单独标记为通过、未通过或 `not-run`；没有人工通过时，不要宣称动作可交付。
5. 要求在 Cubism Animator 中精修已通过视觉复核的 draft，再导出最终 Motion3。不要将 VTube Studio 录制直接当作最终生产动作。

## Intake 门禁

1. 仅在用户明确批准具体 draft 并明确授权 intake 后执行接入。
2. 在写入前再次确认 Motion3 parser、人工视觉复核和 Cubism Animator 精修均已通过。
3. 未满足任一条件时，只报告阻塞项，不要写入 `model/`、manifest、preset 或 catalog。
4. 执行获批 intake 时，仅修改用户明确授权的目标；将实际写入路径和批准依据分开记录。

## 清理和结论

1. 停止本流程启动的 overlay、timer、socket 和多余进程；不要终止用户自有的 VTube Studio 会话。
2. 删除本次临时截图、tmp、日志和未需保留的录制残留；保留获准保留的 `draft` 或批准产物。
3. 逐项复查并报告：`screenshot=0`、`tmp=0`、`log=0`、`overlay=0`、`timer=0`、`socket=0`、`extra-process=0`。无法清为 0 时报告准确路径或进程及原因，不要声称已清理。
4. 用固定顺序报告：本次类型、文档证据、candidate 结论、端口/token 预检、采集范围、take 结果、parser 回读、真实 UI 结论、VTube Studio 结论、人工结论、draft/intake 状态、清理计数和阻塞项。

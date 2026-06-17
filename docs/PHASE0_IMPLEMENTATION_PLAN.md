# Phase 0 实施计划 — Electron + Live2D 桌面技术门禁

> 日期：2026-06-16
> 当前交付边界：毕业设计、本机演示，不公开发布、不收费、不上架应用商店
> 测试模型：`E:\Work-26\AI_Desktop_Pet\魔女`

## 1. Phase 0 目标

Phase 0 不做完整产品，只验证最关键风险：

1. Electron 透明置顶窗口是否能稳定承载 WebGL / Cubism 渲染。
2. 系统级点击穿透、角色命中、拖拽是否能共存。
3. 官方 Cubism SDK for Web 能否加载当前“魔女”模型并驱动待机、表情、视线。
4. WebGL context 丢失、渲染进程崩溃、睡眠恢复是否有可接受恢复策略。
5. 是否能做出第一个最小垂直切片：角色显示 -> 点击角色 -> 打开聊天面板 -> 假对话回复 -> 表情变化。

Phase 0 成功后，才进入真实 AI、SQLite、配置面板、性能优化和论文实验工具。

## 2. 已确定决策

| 决策 | 结论 | 原因 |
|---|---|---|
| 运行时 | Electron 42.x 作为主实现版本；41.x 只做回归对照 | Electron 30 已过期，不能作为新项目基础 |
| Live2D 路线 | 官方 Cubism SDK for Web R5 + 原生 WebGL | 单角色不需要 PixiJS，先减少 GPU 生命周期复杂度 |
| 窗口模式 | 双窗口：角色窗口 + 聊天窗口 | 角色窗口可穿透且不抢焦点，聊天窗口正常输入 |
| 置顶级别 | 默认 `floating`，不用周期性抢占置顶 | 符合低打扰定位 |
| 穿透策略 | 整窗 `setIgnoreMouseEvents(true, { forward: true })` + 命中区动态关闭穿透 | CSS `pointer-events` 不能实现系统级穿透 |
| 命中策略 | Phase 0 使用自定义矩形命中区，不做逐像素命中 | 当前模型无 `HitAreas`，逐像素检测性能风险高 |
| 模型处理 | 不修改原模型文件；新增项目侧 manifest | 遵守模型使用规范，方便替换模型 |
| 对话 | 先用 `FakeProvider`，不接真实 AI | 消除网络/API Key 干扰，先验证桌面 + 表情闭环 |
| 发布 | 不做签名、自动更新、公开分发 | 当前只用于毕业设计本机演示 |

## 3. 模型状态

模型目录：`E:\Work-26\AI_Desktop_Pet\魔女`

### 3.1 可用内容

- `魔女.model3.json`
- `魔女.moc3`
- `魔女.8192/texture_00.png`，8192 x 8192
- `魔女.8192/texture_01.png`，4096 x 8192
- `魔女.physics3.json`
- `魔女.cdi3.json`
- `Scene1.motion3.json`
- 12 个 `*.exp3.json` 表情/切换文件
- `魔女.vtube.json` 中记录了 VTube Studio 热键和表情名称

### 3.2 限制

- 没有 README / license 文件，授权信息来自商品页描述。
- 版权归属：雪熊企划。
- 当前仅用于毕业设计本机演示。
- 禁止二改模型和原画；禁止转赠；禁止二次贩卖；禁止公开分发模型本体。
- `model3.json` 未引用表情和动作，需要项目侧 manifest。
- 没有 `HitAreas`，Phase 0 使用自定义矩形命中区。
- 纹理偏大，不适合直接论证低资源；Phase 0 可用，后续需要性能对比或降采样方案。

## 4. 推荐工程结构

Phase 0 可以直接作为未来项目骨架，不要做一次性脚本。

```text
src/
  main/
    app.ts
    windows/
      pet-window.ts
      chat-window.ts
    services/
      pointer-controller.ts
      display-placement.ts
      recovery-supervisor.ts
      telemetry.ts
      asset-protocol.ts
    ipc/
      register-ipc.ts
  preload/
    pet-preload.ts
    chat-preload.ts
  renderer/
    pet/
      index.html
      main.ts
      live2d/
        cubism-runtime.ts
        cubism-model.ts
        context-recovery.ts
        interaction-controller.ts
      hit-test.ts
      drag-gesture.ts
    chat/
      index.html
      main.ts
      fake-provider.ts
  shared/
    ipc-contract.ts
    emotion.ts
    model-manifest.ts
    app-state.ts
resources/
  models/
    witch/
      model-manifest.json
      README.local-only.md
```

模型原始文件可以暂时保留在 `魔女/`，实现时通过 manifest 指向它。若未来公开仓库，必须把 `魔女/` 加入忽略列表。

## 5. 模型 manifest 草案

新增 `resources/models/witch/model-manifest.json`，不要修改原始 `魔女.model3.json`。

```json
{
  "id": "witch",
  "displayName": "魔女",
  "usage": "local-graduation-demo-only",
  "sourceDir": "../../魔女",
  "model3": "魔女.model3.json",
  "idleMotion": "Scene1.motion3.json",
  "expressions": {
    "sad": "ku.exp3.json",
    "angry": "sq.exp3.json",
    "happy": "x.exp3.json",
    "excited": "xx.exp3.json",
    "dark": "h.exp3.json",
    "ghost": "cw.exp3.json",
    "bow": "hdj.exp3.json",
    "glasses": "yj.exp3.json",
    "staff": "fz.exp3.json",
    "hat": "mz.exp3.json",
    "gestureGame": "zs1.exp3.json",
    "gestureMic": "zs2.exp3.json"
  },
  "emotionMap": {
    "neutral": null,
    "happy": "happy",
    "sad": "sad",
    "angry": "angry",
    "surprised": "excited",
    "confused": "dark"
  },
  "hitAreas": {
    "head": { "x": 0.25, "y": 0.05, "width": 0.5, "height": 0.28 },
    "body": { "x": 0.22, "y": 0.28, "width": 0.56, "height": 0.55 }
  }
}
```

命中区域用归一化窗口坐标，后续通过实际渲染调整。

## 6. 任务拆分

### P0-0：项目脚手架与版本固定

**目标**：创建 Electron + TypeScript + Vite 基础项目。

**实现要求**

- 固定 Electron 42.x 最新补丁版本。
- 配置 `npm run dev`、`npm run build`。
- 主进程、preload、renderer 分离。
- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- 建立 `shared/ipc-contract.ts`，禁止通用任意 channel IPC。

**验收**

- `npm run dev` 能启动空 Electron 应用。
- `npm run build` 通过。
- DevTools 只在开发模式打开。

### P0-1A：透明窗口 + 简单 WebGL

**目标**：不用 Live2D，先验证透明窗口和 WebGL 透明背景。

**实现要求**

- 创建角色窗口：
  - `transparent: true`
  - `backgroundColor: '#00000000'`
  - `frame: false`
  - `hasShadow: false`
  - `skipTaskbar: true`
  - `focusable: false`
- 创建后调用：
  - `setAlwaysOnTop(true, 'floating')`
  - `setIgnoreMouseEvents(true, { forward: true })`
- WebGL clear alpha 为 0。
- 绘制一个简单半透明角色占位图形。

**验收**

- 窗口背景透明，无黑底。
- 普通窗口不能盖住角色窗口。
- 空白区域点击可落到底层窗口。
- 不要求压过独占全屏游戏。

### P0-1B：系统级穿透、命中和拖拽

**目标**：验证“空白穿透、命中可点、角色可拖拽”。

**实现要求**

- 默认整窗穿透。
- 鼠标进入自定义 `head/body` 命中区域时关闭穿透。
- 离开命中区 60ms 后恢复穿透。
- 命中区域外扩 8 DIP，减少 IPC 竞态。
- `pointerdown` 后移动超过 4 DIP 才进入拖拽。
- 拖拽由主进程调用 `BrowserWindow.setPosition()`。
- 不使用 `-webkit-app-region: drag`。

**验收**

- 空白区域点击连续 100 次，全部穿透到底层窗口。
- 命中区域点击连续 50 次，不误穿透。
- 拖拽 30 次无卡死，释放后恢复穿透。
- 拖拽最终位置误差 <= 4 DIP。

### P0-2A：模型清单与许可记录

**目标**：把“魔女”模型纳入可控资源管理。

**实现要求**

- 新增 `resources/models/witch/model-manifest.json`。
- 新增 `resources/models/witch/README.local-only.md`，记录：
  - 来源：用户提供的免费模型页面信息
  - 版权：雪熊企划
  - 用途：毕业设计本机演示
  - 禁止：公开分发、转赠、二改、二次贩卖
- 记录表情、动作、纹理尺寸、是否有 HitAreas。

**验收**

- 运行时可以从 manifest 读取模型信息。
- 原始模型文件未被修改。

### P0-3A：官方 Cubism SDK 接入

**目标**：加载真实 Cubism 模型。

**实现要求**

- 使用官方 Cubism SDK for Web R5。
- 暂不引入 PixiJS。
- 注册只读资源协议或统一资源加载器，不直接在渲染器写死绝对路径。
- 加载 `魔女.model3.json`、`.moc3`、纹理、物理。
- 待机动作 `Scene1.motion3.json` 循环播放。
- 输出模型能力摘要：纹理、表达式、物理、眼睛、口型、动作。

**验收**

- 角色能显示在透明窗口中。
- 背景保持透明。
- 待机动作循环。
- 无 `file not found` 和跨环境路径错误。

### P0-3B：表情、视线和手动触发

**目标**：验证模型能被程序控制。

**实现要求**

- 支持清空表情回到 `neutral`。
- 支持至少 3 个情绪：
  - `happy`
  - `sad`
  - `angry`
- 支持扩展到 6 个情绪。
- 鼠标移动映射到视线/头部参数。
- 提供开发调试快捷键或页面按钮触发表情。

**验收**

- 三种情绪可肉眼区分。
- 清空表情后能回到普通状态。
- 视线/头部跟随鼠标有反馈。

### P0-4：最小聊天窗口 + FakeProvider

**目标**：做出第一条端到端产品闭环，但不接真实 AI。

**实现要求**

- 点击角色打开聊天窗口。
- 聊天窗口包含：
  - 消息列表
  - 输入框
  - 发送按钮
  - 中断按钮占位
- `FakeProvider` 根据关键词返回固定文本和情绪：
  - “开心/好/喜欢” -> `happy`
  - “难过/哭/伤心” -> `sad`
  - “生气/烦/讨厌” -> `angry`
  - 默认 -> `neutral`
- 模拟流式输出，每 30-50ms 输出一段文本。
- 状态链路：`IDLE -> LISTENING -> THINKING -> SPEAKING -> IDLE`。

**验收**

- 发送消息后聊天窗口出现假回复。
- 回复期间角色进入 thinking/speaking 可见状态。
- 回复结束后按情绪切换表情。
- 连续 20 轮交互不卡死。

### P0-5：Context 恢复与故障注入

**目标**：验证 WebGL/Cubism 基础恢复能力。

**实现要求**

- 监听 `webglcontextlost` 并 `preventDefault()`。
- 监听 `webglcontextrestored`。
- 保存模型 URL、当前表情、当前状态。
- 恢复时重建 WebGL/Cubism 资源。
- 若 5 秒内未恢复，重载角色窗口。
- 主进程监听 `render-process-gone`。
- 主进程监听 `child-process-gone` 并筛选 GPU 子进程。
- 60 秒内最多自动恢复 3 次，超过进入安全失败状态。

**验收**

- 使用 `WEBGL_lose_context` 注入 10 次，均能恢复显示。
- renderer crash 后 10 秒内恢复角色窗口。
- 恢复后至少能回到 idle 动作和当前语义表情。

### P0-6：基础诊断与性能基线

**目标**：为后续论文实验和调试留下证据。

**实现要求**

- JSONL 日志，10MB 滚动，保留 5 份。
- 记录：
  - Electron/Chromium/Node 版本
  - Windows build
  - GPU 信息
  - display bounds/workArea/scaleFactor
  - 窗口 bounds、可见、置顶、穿透状态
  - 首帧时间
  - FPS 心跳
  - `app.getAppMetrics()` 进程内存
  - context lost/restored
  - renderer/GPU gone
- 日志不得记录 API Key、真实对话正文或敏感用户路径。

**验收**

- 启动后生成一份诊断日志。
- 可用日志复盘一次 context loss 恢复过程。
- 能输出 P0 性能基线报告。

## 7. Phase 0 成功标准

Phase 0 完成时，应能演示：

1. 桌面上出现“魔女”Live2D 角色。
2. 透明背景正常，没有黑底。
3. 空白区域点击能穿透到底层窗口。
4. 角色命中区域可点击，点击打开聊天窗口。
5. 角色可拖拽，拖拽后恢复穿透。
6. 聊天窗口能输入，FakeProvider 能流式回复。
7. 回复能驱动至少 3 种表情。
8. context loss 注入后能恢复。
9. 有日志记录首帧、状态变化、故障恢复。

## 8. Phase 0 不做事项

- 不接真实 DeepSeek / OpenAI API。
- 不做 SQLite。
- 不做 API Key 加密保存。
- 不做 Ollama。
- 不做 TTS / ASR。
- 不做长期记忆。
- 不做用户模型导入。
- 不做窗口吸附。
- 不做自动更新、签名、安装包发布。
- 不做完整 UI 美化。
- 不做 24 小时 soak 作为早期门禁。

## 9. 风险与备选路线

| 风险 | 处理 |
|---|---|
| 透明窗口出现黑底 | 先确认 WebGL alpha、clearColor、Electron transparent；仍失败则测试 Electron 41.x |
| 点击穿透有竞态 | 扩大命中区域、增加 60ms 防抖、减少 IPC 频率 |
| 角色命中不准 | Phase 0 调整矩形命中；后续考虑自定义 HitAreas 或参数化热区 |
| Cubism 加载路径在打包后失败 | 使用统一资源协议，禁止 renderer 写死绝对路径 |
| 8192 纹理导致性能差 | Phase 0 记录基线；Phase 1 准备降采样纹理做对比 |
| context restore 不稳定 | 优先重建整个角色窗口，不在原 renderer 中强行恢复 |
| 模型授权不允许扩散 | 继续只做本机演示；公开仓库时忽略模型目录 |

## 10. 后续进入 Phase 1 的条件

满足以下条件后再进入真实 AI 和持久化：

- Phase 0 成功标准全部通过。
- “魔女”模型的本机演示授权记录已写入项目文档。
- 选择是否继续使用该模型作为论文截图/录屏素材。
- 明确真实 AI 提供方：DeepSeek、OpenAI 兼容接口或继续 FakeProvider。
- 明确毕业设计演示日期和可用测试设备。


## P0-2A 完成记录

- 已建立 project-side manifest：`resources/models/witch/model-manifest.json`。
- 已建立本地许可记录：`resources/models/witch/README.local-only.md`。
- 原始模型文件未修改。
- 原始模型目录 `魔女/` 仍被 `.gitignore` 排除，不进入仓库。
- 当前仅记录授权边界、模型文件清单、表情映射、矩形命中区和模型能力。
- 当前不接入 Live2D/Cubism SDK，不加载 `.moc3`，不接入渲染，不接真实 AI。

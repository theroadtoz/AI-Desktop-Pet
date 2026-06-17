# 任务表 — AI 对话虚拟桌宠 (v1)

> **版本**：v1 规划，2026-05-31
> **变更**：整合技术审查 + 竞品分析结论。仅 Windows，新增 Phase 0 原型验证，削减 Android。
>
> **任务状态**：`TODO` | `IN_PROGRESS` | `DONE` | `BLOCKED`

---

## Phase 0: 技术原型验证 ⚠️ 阻断点

> **此阶段为阻断点。如果 P0-1 失败，需重新评估技术方案。**

### P0-1 Electron 透明窗口 + WebGL 穿透原型
- **状态**：TODO
- **依赖**：无
- **描述**：
  1. 搭建最小 Electron 项目，验证当前最近三个受支持稳定版本
  2. 创建透明窗口（transparent + frame: false + alwaysOnTop: 'screen-saver'）
  3. 在窗口中渲染一个简单透明图形（先不加载 Live2D）
  4. 使用 `setIgnoreMouseEvents(true, { forward: true })` 测试系统级点击穿透
  5. 测试：拖拽窗口是否正常
  6. 测试：窗口置顶是否被其他应用抢占
  7. 测试：GPU 进程崩溃后的恢复行为
  8. 覆盖 Intel/AMD/NVIDIA、混合显卡、DPI、多显示器、睡眠唤醒和 RDP
  9. 测试：24 小时连续运行稳定性
- **验收**：
  - 点击穿透和拖拽在 Win10/Win11 均正常
  - 24 小时不出现渲染冻结/黑屏/鼠标闪烁
  - 若失败：启动备选方案（单窗口离屏渲染 或 原生覆盖层）
- **估时**：2-3 天

### P0-2 Live2D 模型表情清单验证
- **状态**：TODO
- **依赖**：无
- **描述**：
  1. 下载可用于测试的 Cubism 5 `model3.json` 模型，并核对模型许可
  2. 用 l2d-viewer 逐个触发表情，记录实际可用的表情名称
  3. 确认 ≥ 6 个表情（覆盖我们的 6 个情绪标签）
  4. 若不够 6 个，评估用参数直接控制（addParameterValueById）的可行性
- **验收**：
  - 输出表情名称清单
  - 6 个情绪标签均有对应映射方案
- **估时**：0.5 天

### P0-3 官方 Cubism 5 SDK 集成可行性
- **状态**：TODO
- **依赖**：P0-1
- **描述**：
  1. 在 P0-1 原型中集成官方 Cubism 5 SDK for Web
  2. 加载经过许可核验的测试模型
  3. 测试：开发和打包环境下的模型资源加载
  4. 测试：表情切换 API 是否正常
  5. 测试：动作播放 API 是否正常
  6. 测试透明渲染，不默认启用 `preserveDrawingBuffer`
  7. 模拟 WebGL context 丢失→恢复流程
  8. 将 pixi-live2d-display 仅作为遗留兼容备选进行对照
- **验收**：
  - 模型在透明窗口中正常渲染
  - 表情/动作切换 API 工作正常
  - context 恢复流程可手动触发并成功
- **估时**：1-2 天

---

## Phase 1: 项目搭建 + 核心引擎

### T-1.1 项目脚手架
- **状态**：TODO
- **依赖**：Phase 0 全部通过
- **描述**：
  1. 初始化 Phase 0 验证通过的受支持 Electron 版本
  2. 集成官方 Cubism 5 SDK；仅在需要场景图时引入 PixiJS
  3. 配置主进程 main.js：双窗口（角色窗口+聊天面板窗口）
  4. 配置 preload.js（contextBridge 安全暴露 API）
  5. 安全配置：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`
  6. 使用 `setIgnoreMouseEvents` 实现系统级穿透，CSS 仅处理网页内部命中
  7. 构建脚本：开发热重载 + 生产打包
- **验收**：
  - `npm run dev` 启动双窗口
  - 角色窗口透明置顶，聊天面板窗口正常
  - DevTools 可调试
- **估时**：1 天

### T-1.2 类型系统 + 共享接口
- **状态**：TODO
- **依赖**：T-1.1
- **描述**：
  1. 定义 `EmotionTag` 枚举（6 个标签）
  2. 定义 `ChatMessage`、`ConversationState`、`CharacterConfig` 接口
  3. 定义 `AIResponse` 接口（text: string, emotion?: EmotionTag）
  4. 定义 `EmotionClassifier` 抽象接口（本地 fallback 实现）
  5. 定义 `LLMProvider` 抽象接口（DeepSeek 实现 + Ollama 预留）
  6. 定义 `TTSInterface` 抽象（v1 预留，不做实现）
  7. 定义 `StorageInterface`、`AvatarRenderer` 接口
- **验收**：
  - TypeScript 编译无错误
  - 接口覆盖所有 MVP 功能路径
- **估时**：0.5 天

### T-1.3 AI 对话引擎
- **状态**：TODO
- **依赖**：T-1.2
- **描述**：
  1. 实现通用 `OpenAICompatibleProvider`，供应商作为可替换适配器
  2. 实现 `PersonaBuilder`（三层嵌套 system prompt 生成器）
     - 基础人设 + 行为契约 + 输出格式（自由文本，不强制 JSON）
     - 每轮 prompt 注入角色卡信息作为 context anchor（防幻觉）
     - 参数通过固定测试集调校，不预设未经验证的最佳区间
  3. 实现 `ChatEngine`：
     - `sendMessage(userText, history)` → 流式返回
     - 滑动窗口上下文管理（保留最近 20 轮完整消息 + 更早消息压缩摘要）
     - 会话长度上限 50-60 轮触发摘要/重置
     - 指数退避重试（429、503）
     - 供应商特定字段由对应 Provider 适配器处理
     - AbortController 中断链（用户可取消生成）
  4. 实现 `EmotionClassifier`：
     - 主：LLM 输出中提取情感关键词
     - Fallback：sentiment.js 本地情感分析
     - 三层防御：提取→校验→降级文本模式
  5. 单元测试
- **验收**：
  - 发送消息 → 流式返回文本 → 情感分类器输出情绪标签
  - 中断功能正常（AbortController）
  - 重试机制在 mock 429 时触发
- **估时**：3 天

### T-1.4 角色状态机 (FSM)
- **状态**：TODO
- **依赖**：T-1.2
- **描述**：
  1. 实现 7 状态 FSM：IDLE / LISTENING / THINKING / SPEAKING / SLEEPING / INTERRUPTED / ERROR
  2. 状态转换规则（见 CONTEXT.md FSM 图）
  3. 每个状态 onEnter/onExit 钩子
  4. 空闲 5 分钟自动进入 SLEEPING
  5. SLEEPING 时帧率降至 5fps
  6. 状态变更 EventEmitter
  7. 单元测试覆盖所有转换
- **验收**：
  - 完整状态转换链路测试通过
  - 5 分钟空闲 → SLEEPING；用户点击 → IDLE
  - INTERRUPTED 和 ERROR 状态可触发并恢复
- **估时**：2 天

### T-1.5 数据持久化
- **状态**：TODO
- **依赖**：T-1.2
- **描述**：
  1. 实现 `SqliteStorage`（better-sqlite3）：sessions、messages、config 三张表
  2. 数据库路径：`%APPDATA%/desktop-pet/data.db`
  3. 实现 `KeyStore`（electron-store + safeStorage）：API Key 加密存储
  4. BYOK 模式下引导用户输入 API Key（不硬编码、不打包进 asar）
  5. 对话历史本地存储；提供删除和自动清理选项
  6. 明确说明云端模式会将请求发送给所选供应商
- **验收**：
  - 数据重启后不丢失
  - API Key 通过 Windows DPAPI 加密
  - 单元测试通过
- **估时**：1.5 天

---

## Phase 2: Live2D 渲染 + 桌面集成

### T-2.1 Live2D 角色渲染
- **状态**：TODO
- **依赖**：T-1.1、P0-3
- **描述**：
  1. 在角色窗口初始化官方 Cubism 5 Web 渲染
  2. 加载经过许可核验的测试模型
  3. 渐进式加载策略：
     - 并行加载 Cubism Core + 模型文件
     - 首帧只加载 idle 动作 + 默认纹理
     - 目标：< 2 秒到首帧显示
  4. 默认 IDLE 状态：自动播放待机动作 + 随机眨眼
  5. 窗口位置记忆（electron-store）
  6. 多显示器边界检测
- **验收**：
  - 启动后 < 2 秒看到角色
  - IDLE 状态正常循环
  - 重启后窗口位置恢复
- **估时**：2 天

### T-2.2 WebGL Context 恢复机制
- **状态**：TODO
- **依赖**：T-2.1
- **描述**：
  1. 监听 `webglcontextlost` + `webglcontextrestored`
  2. 监听主进程 `child-process-gone`，筛选 GPU 子进程
  3. context 恢复流程：销毁旧 Application → 重建 → 重新加载模型
  4. GPU crash 时自动 reload 角色窗口
  5. 恢复后恢复表情/动作状态
- **验收**：
  - 模拟 context 丢失 → 自动恢复 → 角色正常渲染
  - 睡眠唤醒、多显示器切换后不出现黑屏
- **估时**：1.5 天

### T-2.3 表情与动作控制器
- **状态**：TODO
- **依赖**：T-1.3、T-1.4、T-2.1
- **描述**：
  1. 读取模型表情列表，建立 6 标签映射表
  2. 实现 `ExpressionController`（面部表情）：
     - `setEmotion(tag)` → 模型表情 + 过渡动画
     - 优先级队列（强制 > LLM 驱动 > 自动 > 待机）
     - 防抖（同表情 3 秒内不重复触发）
     - 冷却（不同表情切换间隔 ≥ 1 秒）
  3. 实现 `MotionController`（身体动作）：
     - 独立于表情触发
     - 动作组映射（开心→挥手、困惑→歪头、惊讶→后仰）
     - 动作完成回调
  4. 自动回退：表情/动作播放完毕后回 IDLE
- **验收**：
  - `setEmotion('happy')` → 角色微笑 + 开心动作
  - 连续触发同情绪 → 防抖生效
  - 表情和动作独立运行不冲突
- **估时**：2 天

### T-2.4 桌面穿透与窗口管理
- **状态**：TODO
- **依赖**：T-2.1
- **描述**：
  1. `setIgnoreMouseEvents(true, { forward: true })` 实现系统级穿透
  2. 根据转发的鼠标移动和角色命中区域动态关闭穿透
  3. CSS pointer-events 仅用于窗口内部 DOM 命中
  3. alwaysOnTop: 'screen-saver' 级别
  4. 周期置顶刷新（对抗其他应用抢占层级）
  5. 系统托盘：右键菜单（显隐、面板、退出）
  6. 开机自启选项
- **验收**：
  - 角色不阻挡桌面图标点击
  - 可拖拽角色，拖拽后恢复穿透
  - 系统托盘功能正常
- **估时**：1.5 天

### T-2.5 聊天面板窗口
- **状态**：TODO
- **依赖**：T-1.1、T-1.3
- **描述**：
  1. 聊天面板 UI（React 或 Vanilla HTML）：
     - 消息列表（用户右对齐，AI 左对齐 + 情绪图标）
     - 输入框 + 发送按钮
     - 新建会话按钮
     - 会话切换下拉
  2. 流式显示（打字机效果逐 token 渲染）
  3. 中断按钮（AbortController → INTERRUPTED）
  4. 角色窗口联动：点击角色 → 面板聚焦输入框
  5. 窗口定位：启动时靠右 1/4 处
- **验收**：
  - 发送消息 → 流式逐字显示 → 表情图标更新
  - 中断按钮可取消生成
  - 角色和面板联动正常
- **估时**：2 天

### T-2.6 低资源模式 + 性能优化
- **状态**：TODO
- **依赖**：T-2.1、T-1.4
- **描述**：
  1. FSM IDLE/SLEEPING → 在 Cubism/Pixi ticker 或 `requestAnimationFrame` 层降频
  2. 用户交互时恢复目标帧率
  3. 暂停不必要的动作更新，不使用仅适用于离屏渲染的绘制 API
  4. 内存监控：`process.memoryUsage()` > 200MB 告警
  5. 渲染进程内存上限 512MB，超限 reload
  6. 窗口关闭时手动解绑所有事件（防泄漏）
- **验收**：
  - IDLE 状态 CPU < 1%
  - 1 小时运行内存不持续增长
- **估时**：1 天

---

## Phase 3: 集成 + 联调 + 调校

### T-3.1 全链路联调
- **状态**：TODO
- **依赖**：Phase 1、Phase 2 全部
- **描述**：
  1. 端到端：用户输入 → ChatEngine → DeepSeek API → 流式返回 → 情感分类 → 表情切换 → Live2D 渲染
  2. 6 个情绪标签逐一触发测试
  3. 异常场景测试：API Key 无效、网络断开、余额不足、API 500/503
  4. 中断流程测试
  5. 50 轮连续对话稳定性
  6. 1 小时运行性能监控
- **验收**：
  - 完整对话流程流畅，所有情绪可触发
  - 异常场景有友好提示（非崩溃）
  - 50 轮不卡顿、不内存泄漏
- **估时**：2 天

### T-3.2 人格预设精调
- **状态**：TODO
- **依赖**：T-3.1
- **描述**：
  1. 用户提供元气伙伴详细人格设定
  2. 编写三层嵌套 system prompt
  3. 准备 20 条测试对话
  4. 检查每条情绪合理性（≥ 18/20 通过）
  5. 调优参数：temperature、top_p、max_tokens
  6. Bad case 处理：
     - 情绪不当 → prompt 补示例
     - 人设崩塌 → 强化否定约束 + 角色卡注入
     - 幻觉 → 温度控制 + few-shot
  7. 30 轮不崩塌验证
- **验收**：
  - 20 条测试 ≥ 18 条情绪合理
  - 30 轮连续对话不出现人设崩塌
- **估时**：2 天

### T-3.3 配置管理界面
- **状态**：TODO
- **依赖**：T-3.1
- **描述**：
  1. Web 配置页面（轻量 HTML/CSS/JS）
  2. 功能：角色名称、人格描述编辑、API Key 管理、模型选择、temperature、情绪标签预览
  3. 访问：托盘菜单 → "设置"
  4. 配置实时生效
- **验收**：
  - 配置面板可修改并保存
  - 修改后对话行为立即变化
- **估时**：1 天

---

## Phase 4: 打磨 + 发布

### T-4.1 包体构建 + 优化
- **状态**：TODO
- **依赖**：Phase 3
- **描述**：
  1. electron-builder 配置
  2. 包体 < 200MB（含 Live2D 模型 + Cubism Core）
  3. 自动更新机制（electron-updater）
  4. 安装包签名
- **验收**：
  - 安装包可正常安装运行
- **估时**：1 天

### T-4.2 用户文档
- **状态**：TODO
- **依赖**：Phase 3
- **描述**：
  1. 安装说明
  2. 配置说明（API Key、模型设置）
  3. Live2D 模型导入指南
  4. FAQ
  5. README.md
- **验收**：
  - 新用户 10 分钟内完成安装+配置
- **估时**：1 天

---

## 依赖关系总览

```
Phase 0 (阻断点，2-5.5 天)
├── P0-1 透明窗口穿透原型 (2-3天)
├── P0-2 模型表情清单 (0.5天，可并行)
└── P0-3 官方 Cubism 5 SDK 集成 (1-2天，依赖 P0-1)
         │
         ▼ (全部通过)
Phase 1 (核心引擎，8 天)
├── T-1.1 脚手架 (1天)
├── T-1.2 类型系统 (0.5天) ←─┐
├── T-1.3 AI 引擎 (3天) ──────┤ 可部分并行
├── T-1.4 FSM (2天) ──────────┤
└── T-1.5 持久化 (1.5天) ─────┘
         │
         ▼
Phase 2 (Live2D 渲染，10 天)
├── T-2.1 角色渲染 (2天)
├── T-2.2 Context 恢复 (1.5天)
├── T-2.3 表情动作控制 (2天)
├── T-2.4 穿透+窗口管理 (1.5天)
├── T-2.5 聊天面板 (2天)
└── T-2.6 低资源模式 (1天)
         │
         ▼
Phase 3 (联调，5 天)
├── T-3.1 全链路 (2天)
├── T-3.2 人格调校 (2天)
└── T-3.3 配置界面 (1天)
         │
         ▼
Phase 4 (发布，2 天)
├── T-4.1 打包 (1天)
└── T-4.2 文档 (1天)
```

**估时说明**：原 25-30.5 天仅保留为历史规划，不作为交付承诺。当前估计为技术原型 1-2 周、垂直切片 3-5 周、可发布 MVP 8-12 周，兼容性与发布稳定化另计。

---

## v2 规划（暂存）

以下功能明确推迟到 v2：

| 功能 | 推迟原因 |
|------|---------|
| Android 端 | 风险过高，分散精力；先验证 Windows 产品力 |
| 语音输入 (ASR) | 技术复杂度过高，v1 打字已满足 MVP |
| 长期记忆系统 | 需要向量数据库 + 大量调校 |
| 屏幕感知/工具调用 | 偏离陪伴定位 |
| 多角色同时运行 | 管理复杂度高 |
| Steam Workshop | UGC 是规模的结果，不是原因 |
| 移动端同步 | 跨平台是中期目标 |

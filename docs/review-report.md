# 跨平台 AI 桌宠项目 — 历史综合审查报告

> **状态：已被 2026-06-09 联网核验部分取代。**
>
> 本文保留为历史决策记录。涉及“市场空白”、DeepSeek V4 Flash 精确指标、Electron 30 锁版、CSS `pointer-events` 系统穿透、`gpu-process-crashed`、`webContents.setFrameRate` 和 `stopPainting` 的结论不得继续作为实施依据。当前依据见 `competitive-comparison.md`、`competitive-strategy.md`、`CONTEXT.md` 和修订后的 `task-list.md`。

**审查委员会主席汇总 | 2026-05-31**

---

## 一、总体评估

本方案在技术层面**基本可行，但风险显著**。项目的核心价值主张——AI 驱动的 Live2D 桌面宠物——有明确的技术路径和参考实现。然而，方案当前面临 **1 个阻断级风险和 5 个高风险项**，主要集中在三个领域：(1) Electron 透明窗口 + WebGL 渲染的 Chromium 架构级冲突；(2) DeepSeek V4 Flash 作为单一 AI 供应商的可靠性和质量差距；(3) Android 端的悬浮窗碎片化与系统政策收紧趋势。

最大的结构性风险是**方案试图在 v1 阶段同时覆盖 Windows 和 Android 双端**，导致技术栈分散（TypeScript + Kotlin + C++/JNI）、两套 Live2D SDK 的并行维护，以及"共享逻辑层"在 Android 端无法直接执行的名实不符问题。对于一个个人开发者项目，这超出了可持续的产出范围。

**委员会总体判断：方案可行，但需收缩范围、加固风险点、重新排定优先级后方可启动。**

---

## 二、关键发现（按严重程度排序）

### 🔴 阻断级 (P0 — 必须解决才能启动)

**1. Electron 透明窗口 + WebGL 渲染存在架构级冲突**

- **问题**：Chromium 检测到 WebGL canvas 后会切换到 GPU 加速合成路径，导致整个窗口被视为"不透明层"，`setIgnoreMouseEvents(true)` 的鼠标穿透在 WebGL 区域失效。这是 Chromium 行为，Electron 无法直接修复。此外，Electron 31+ 存在透明背景 WebContentsView 渲染 Bug（内容叠加变暗），`setIgnoreMouseEvents` 在 Windows 上存在光标闪烁 Bug（Issue #48035，影响 v20-v37）。
- **建议**：(a) 锁定 Electron 30.x；(b) 在 T-3.1 阶段**必须先做一个最小原型验证**：透明窗口 + PixiJS 6.x + easy-live2d + 一张 PNG，测试 Win10/Win11 上的点击穿透和拖拽；(c) 如果原型验证失败，启动备选方案：Electron 离屏渲染 + 单一窗口架构，或原生覆盖层（Cubism Native SDK）+ Electron 聊天面板。
- **来源**：Scout 风险分析 + Live2D 审查 + 参考项目分析

**2. 双端架构导致"共享层"名实不符 — Android 端定位模糊**

- **问题**：共享 TypeScript 逻辑层无法在 Kotlin 中直接执行。Android 要么作为依赖 Windows 后台的瘦客户端（脱离 PC 即不可用），要么在 Kotlin 中重写 AI 客户端/表情映射等逻辑（产生双端维护负担）。当前方案没有明确 Android 的定位，这是一个架构根基问题。
- **建议**：明确定义 Android 为"远程渲染终端"（瘦客户端），将共享层所有非渲染逻辑下沉到 Node.js 后台服务。Android 仅保留 Live2D 渲染、悬浮窗管理和 WebSocket 客户端。如果 Android 必须独立运行，则需另立项目。
- **来源**：架构审查 + Scout Android 分析

**3. API Key 硬编码风险 — 安全隐患**

- **问题**：方案未说明 DeepSeek API Key 的存储方式。Electron 应用会被打包分发，绝对不能将 API Key 硬编码或打包进 asar。
- **建议**：首次启动引导用户输入自己的 API Key；使用 `electron-store` + `safeStorage`（OS 级加密，Windows DPAPI）加密存储。
- **来源**：架构审查（安全性章节）

---

### 🟠 高风险 (P1 — 必须在 Phase 1-2 内解决)

**4. pixi-live2d-display 已停维护 + WebGL context 丢失无法自动恢复**

- **问题**：pixi-live2d-display 已停止活跃维护（GitHub 47 个 open issues），仅支持 PixiJS v6.x。WebGL context 丢失后（GPU 崩溃、笔记本睡眠唤醒、多显示器切换），PixiJS 不会自动回退到 Canvas2D，而是直接停止渲染。GPU 进程崩溃后透明窗口的 alpha 通道可能错乱，同时 `setIgnoreMouseEvents` 状态失效。
- **建议**：(a) 锁定 `pixi.js@6.4.2`；(b) 设置 `preserveDrawingBuffer: true`；(c) 自行实现完整的 WebGL context 恢复流程：监听 `webglcontextrestored` → 销毁旧 PIXI.Application → 重新创建 → 重新加载 Live2D 模型；(d) 监听主进程 `gpu-process-crashed` 事件触发窗口 reload。
- **来源**：Scout 风险分析 + Live2D 审查

**5. 情绪检测缺乏 fallback 机制 — LLM 输出失败时角色面部僵硬**

- **问题**：当前设计仅依赖 Prompt 工程要求 LLM 输出 JSON 中的 emotion 字段。若 LLM 未输出、格式错误或被审查静默拒绝，角色不会有任何表情反应。参考项目 my-neuro 使用独立 BERT 分类器作为 fallback，AIRI 构建了 72 维情感向量空间。
- **建议**：在共享逻辑层增加 `EmotionClassifier` 接口，默认实现为 LLM 输出提取器，fallback 为本地轻量情感分析（sentiment.js 或 Transformers.js）。当 LLM 返回的 emotion 为空或无效时，自动对 text 做情感分类。
- **来源**：参考项目分析（设计盲区）+ AI 引擎审查

**6. 缺少 TTS 语音合成与口型同步规划 — 沉浸感降级**

- **问题**：Open-LLM-VTuber 和 my-neuro 的核心体验都包含语音合成 + Live2D 口型同步。我们的 Phase 设计完全没有考虑 TTS，这会显著降低"AI 伴侣"的沉浸感。
- **建议**：在 Phase 3 中预留 TTS 扩展点。至少在共享逻辑层定义 `TTSInterface` 抽象。初期可用 Edge TTS（免费）起步，口型同步通过 easy-live2d 的 lipsync 插件或手动控制 ParamMouthOpenY 实现。
- **来源**：参考项目分析（设计盲区）

**7. DeepSeek V4 Flash 的高幻觉率威胁世界设定一致性**

- **问题**：DeepSeek V4 Flash 的 AA-Omniscience 幻觉率高达 96%，SimpleQA-Verified 事实性得分仅 34.1（V4 Pro 为 57.9）。在角色扮演中表现为角色背景信息错误、世界设定前后矛盾。温度超过 1.3 时幻觉显著加剧。
- **建议**：(a) 严格控制温度在 1.0-1.2；(b) 每轮 prompt 中注入核心角色卡信息作为 context anchor；(c) 对关键实体（角色名、地点、时间线）做规则引擎检查；(d) 系统提示中明确要求"不确定的细节请省略而非编造"；(e) 在 prompt 中使用 few-shot 示例。
- **来源**：DeepSeek 适用性分析

**8. DeepSeek API 稳定性存在已知 Bug — 可能导致会话永久损坏**

- **问题**：(a) thinking 模式下 `reasoning_content` 必须回传否则报 400 错误，会话永久损坏不可恢复；(b) 内容审查机制静默拒绝或篡改输出；(c) vLLM 在 2026 年 5 月专门发布 patch 修复 V4 "跑不稳"问题（topk 死锁、显存泄漏）。
- **建议**：(a) 如果开启 thinking 模式，必须完整保留并回传 reasoning_content；(b) 对所有 API 调用实现指数退避重试；(c) 对敏感话题做预处理过滤；(d) 建立健康检查机制，自动检测 API 可用性并切换备用模型；(e) 准备 GPT-4o-mini 作为降级备用。
- **来源**：DeepSeek 适用性分析

**9. 多轮对话记忆衰减 — 约 60 轮后角色一致性退化**

- **问题**：社区实测显示 DeepSeek V4 Flash 在约 60 轮后出现事实回忆退化和重复性循环。EQBench3 评分 72.5/100，中等偏上但非顶级。
- **建议**：(a) 应用层实现滑动窗口记忆管理；(b) 设置会话长度上限（50-60 轮触发摘要/重置）；(c) 对超长会话自动切换到备选模型；(d) 实现滚动摘要机制：保留最近 20 轮完整消息，更早消息压缩为摘要。
- **来源**：DeepSeek 适用性分析 + AI 引擎审查

**10. 缺少身体动作与面部表情的分离控制**

- **问题**：EmotionTag 到 Live2D 表达式是单一扁平映射。my-neuro 明确分离了 EmotionMotionMapper（身体动作）和 EmotionExpressionMapper（面部表情），可实现"开心表情+挥手动作"的组合效果。
- **建议**：拆分为 ExpressionController（面部）和 MotionController（身体动作），允许独立触发。在 shared 层定义 AvatarRenderer 接口，双方控制器通过队列和优先级机制协调。
- **来源**：参考项目分析（设计盲区）+ Live2D 审查

---

### 🟡 中风险 (P2 — 应在 Phase 2-3 内关注)

**11. JSON 结构化输出非 100% 可靠 — 解析崩溃风险**

- **问题**：DeepSeek V4 Flash 的 JSON 约束遵守率约 89%。简单格式 `{"text":"...","emotion":"..."}` 语法可靠性较高（>97%），但特殊字符、Unicode 转义、空值处理等边缘场景仍可能失败。API 官方文档明确声明"使用 JSON Output 功能时，API 有概率会返回空的 content"。
- **建议**：(a) 使用 jsonrepair 库做回退解析；(b) 实现三层防御：API 级 JSON mode + 应用级 Schema 校验 + 失败后指数退避重试（最多 3 次）；(c) 对重试后仍失败的情况降级为纯文本模式。
- **来源**：DeepSeek 适用性分析 + AI 引擎审查

**12. 冷启动时间预估 4-8 秒 — 用户体验差**

- **问题**：Electron 启动 → 加载 HTML → 加载 PixiJS → 加载 Cubism Core WASM → 加载 .moc3 → 加载纹理 → 首次渲染，总计约 4-8 秒用户看到白屏。
- **建议**：(a) 使用 ready-to-show 事件，模型就绪前不显示窗口；(b) 并行加载 Cubism Core 和模型文件；(c) 渐进式就绪——首帧只加载 idle 动作 + 默认纹理；(d) Electron 主进程预读模型文件到内存通过 IPC 传递；(e) 目标：< 2 秒到首帧。
- **来源**：Live2D 审查

**13. 双窗口架构内存开销 300-450MB — 需生命周期管理**

- **问题**：每个 BrowserWindow 内存基线 50-100MB，加上 Live2D WebGL 纹理和聊天面板，双窗口总计 300-450MB。窗口关闭后内存不会立即释放，长时间运行缓慢增长。
- **建议**：(a) 实现窗口生命周期管理器：destroy() 前手动解绑所有事件监听；(b) 设置渲染进程内存上限，超限自动 reload；(c) Live2D 窗口不活跃时暂停渲染（stopPainting）；(d) 限制帧率至 30fps；(e) 聊天面板考虑使用 window.open 共享渲染进程节省 ~100MB。
- **来源**：Scout 风险分析

**14. 悬浮窗中 OpenGL 渲染的 SurfaceView vs TextureView 技术冲突**

- **问题**：Live2D Android 渲染需 OpenGL ES，通常用 GLSurfaceView（底层 SurfaceView）。在悬浮窗中存在 Z-Order 问题（SurfaceView 创建独立窗口层不遵循 View 层级）、透明度问题（API 33 之前不支持 setAlpha）、生命周期问题（频繁 attach/detach 导致 SurfaceTexture 重建黑帧）。TextureView 解决了前两个问题但有双重合成开销。
- **建议**：优先使用 TextureView + 自定义 GLTextureView。接受双重合成性能开销（30fps 场景下可接受）。对于 API 34+ 设备可启用 SurfaceView alpha，低版本统一用 TextureView。
- **来源**：Scout Android 分析 + 移动端审查

**15. Android 悬浮窗权限碎片化 — 国产 ROM 适配**

- **问题**：小米 MIUI、华为 EMUI、OPPO ColorOS、vivo OriginOS 各有一套悬浮窗权限管理逻辑。部分 ROM 将 Intent 重定向至厂商页面或直接无效。不做适配预计 30-50% 国产设备无法正常使用悬浮窗。
- **建议**：使用 FloatingX 作为悬浮窗底层库（已内置多家厂商适配）。额外实现厂商白名单引导：识别 Build.MANUFACTURER 分别跳转权限管理页。覆盖小米/华为/OPPO/vivo/三星五品牌测试。
- **来源**：Scout Android 分析 + 移动端审查

**16. Google Play 及 Android 系统政策持续收紧悬浮窗**

- **问题**：Android 从 8.0 起逐步收紧 SYSTEM_ALERT_WINDOW，Google 推出的 Bubbles API 明确旨在替代悬浮窗。Android 15 进一步要求必须有可见悬浮窗才能享受 BACKGROUND_START 豁免。上线 2-3 年后可能面临根本性技术路线失效。
- **建议**：(a) 分级降级策略：Android 11+ 同时适配 Notification Bubbles；(b) PiP 作为备选方案；(c) 无法获取悬浮窗权限时降级为"通知栏模式"或"壁纸模式"。
- **来源**：Scout Android 分析 + 移动端审查

---

### 🟢 低风险 (P3 — 长期关注)

**17. 无跨会话长期记忆系统**：my-neuro 有 5 层记忆架构，AI-tamago 用 pgvector。建议初期用键值文件存储核心事实（用户名、喜好），后期集成向量数据库。

**18. 无主动对话/自主行为**：my-neuro 的 MoodChat 允许角色在长时间无互动时主动发起对话。建议在 FSM 中增加 ProactiveChatScheduler。

**19. FSM 状态机过于简单**：只有 5 个状态，缺少 ERROR 和 INTERRUPTED 状态。用户在 AI 生成中途无法取消请求。

**20. 缺少多模型供应商抽象层**：只对接 DeepSeek。建议定义 LLMProvider 接口，支持 OpenAI 兼容协议，初期实现 DeepSeek 和 Ollama 适配器。

**21. 情感标签格式限制每句话表现力**：一个回复只有一个整体 emotion 字段。建议改用内联标签或句子级 emotions 数组。

---

## 三、投票结果汇总

委员会 5 位评委对 5 个关键决策进行了独立投票：

| 决策 | 投票分布 | 委员会推荐 |
|------|----------|-----------|
| **技术栈选择** | C(全Electron): 1, A(维持): 0, B(全Flutter): 0, D(Tauri): 0 | **C — 改为全 Electron（Windows only，放弃 Android v1）** |
| **情绪标签数量** | B(5-6个): 1, A(9个): 0, C(3-4个): 0, D(连续值): 0 | **B — 减少到 5-6 个核心情绪** |
| **AI 输出格式** | B(自由文本+后处理): 1, A(JSON约束): 0, C(双API): 0 | **B — 自由文本 + 后处理情绪分类** |
| **后台服务定位** | A(纯本地): 1, B(可选云端): 0, C(仅云端): 0 | **A — 纯本地后台（Windows 本机）** |
| **MVP 平台优先级** | A(Windows优先): 1, B(Android优先): 0, C(同时): 0, D(纯对话): 0 | **A — Windows 端完整桌宠体验优先** |

### 委员会推荐方案概要

基于投票结果，委员会推荐的 **v1 方案** 为：

- **平台**：仅 Windows（Electron），放弃 Android v1
- **情绪系统**：5-6 个核心情绪标签 + 本地情感分析 fallback
- **AI 输出**：LLM 自由文本生成 + 独立后处理情绪分类器
- **后台**：纯本地 Node.js 服务（localhost + LAN WebSocket 为未来留口）
- **架构**：Electron 单窗口内嵌 Live2D + 聊天面板（或双窗口同进程），对话引擎与渲染层严格解耦

**注意**：当前仅收到 1 位评委的投票（共 5 位）。报告基于已有投票生成推荐。若后续收到更多投票，委员会推荐可能调整。

---

## 四、改进后的任务优先级

基于审查结果重新排列的 Phase 顺序：

### Phase 0 — 技术验证（新增，必须在正式开发前完成）

| 任务 | 内容 | 验收标准 |
|------|------|----------|
| **P0-1** | Electron 透明窗口 + WebGL 穿透原型 | Win10/Win11 上点击穿透和拖拽测试通过 |
| **P0-2** | Haru/Hiyori 模型表情文件清单验证 | 确认实际可用表情 >= 6 个，输出清单 |
| **P0-3** | easy-live2d ArrayBuffer 加载可行性 | 确认 API 是否支持从内存加载模型 |

> **如果 P0-1 失败**：启动备选方案评估——Electron 离屏渲染 + 单一窗口，或原生覆盖层 + Electron 聊天面板。

### Phase 1 — 项目初始化（调整后）

| 任务 | 内容 | 变化说明 |
|------|------|----------|
| T-1.1 | 类型定义 | 情绪标签从 9 个减为 6 个 |
| T-1.2 | 项目脚手架 | Electron 30.x + PixiJS 6.4.2，放弃 electron-vite |
| T-1.3 | AI 对话引擎 | 新增：自由文本生成 + 后处理情绪分类器；新增：jsonrepair 回退解析；新增：上下文滑动窗口 + 滚动摘要 |
| T-1.4 | 表情映射表 | 6 标签映射，ExpressionController + MotionController 分离 |
| T-1.5 | 对话质量监控 | **新增**：JSON 解析成功率、情绪标签分布、异常告警 |

### Phase 2 — 核心功能（调整后）

| 任务 | 内容 | 变化说明 |
|------|------|----------|
| T-2.1 | Node.js 后台服务 | 纯本地，API Key 使用 safeStorage 加密 |
| T-2.2 | WebSocket 通信 | 新增：心跳 + 指数退避重连 + 消息序列号 |
| T-2.3 | 本地持久化 | 对话加密存储，增加"对话自毁"选项 |
| T-2.4 | FSM 状态机 | 新增 ERROR 和 INTERRUPTED 状态；AbortController 中断链 |
| T-2.5 | 空闲帧率降级 | **新增**：IDLE/SLEEPING 状态降到 5fps |

### Phase 3 — Live2D 渲染（调整后）

| 任务 | 内容 | 变化说明 |
|------|------|----------|
| T-3.1 | Live2D 窗口创建 | 锁定 Electron 30.x，transparent + alwaysOnTop('screen-saver') |
| T-3.2 | 模型加载与渲染 | 渐进式加载（首帧 < 2 秒），preserveDrawingBuffer: true |
| T-3.3 | WebGL context 恢复 | **新增**：完整 context lost/restored 处理 + gpu-process-crashed 监听 |
| T-3.4 | 表情动作控制器 | ExpressionMotionController：优先级队列 + 防抖 + 冷却 |
| T-3.5 | 鼠标穿透处理 | CSS pointer-events + mousedown 检测 + 动态切换 |
| T-3.6 | TTS 扩展点 | **新增**：定义 TTSInterface 抽象，预留 Edge TTS 集成点 |

### Phase 4 — Android 端 → **取消，移至 v2 规划**

原 Phase 4 的所有 Android 任务移至 v2。如果 v2 启动 Android，需重新评估当时的技术环境（悬浮窗政策、Live2D SDK 成熟度等）。

### Phase 5-6 — 优化与发布（保持不变）

- 性能优化、内存管理、包体积优化
- 应用打包、自动更新、发布渠道

---

## 五、终极建议

**聚焦 Windows 端，用 Electron 把核心桌宠体验打磨到可演示的完成度，在 Phase 0 用最小原型验证透明窗口 + WebGL 穿透这一最大技术风险，通过后再进入正式开发——不要在 v1 阶段把有限的个人精力分散到两个平台和五六个技术域上。**

---

*报告由项目审查委员会主席基于 Scout 阶段发现、四维审查（架构/AI引擎/Live2D/移动端）、参考项目分析和委员会投票结果汇总生成。*

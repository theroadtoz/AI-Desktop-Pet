# AI Desktop Pet Interface Design System

更新时间：2026-06-27

## Direction and Feel

本项目界面应像一个低打扰的魔女桌面伙伴工作台，而不是普通聊天软件、SaaS 控制台或营销页。用户打开聊天窗口时，第一感知应是“她在这里、知道当前状态、可以马上聊天”，第二层才是 Provider、记忆、快捷键、桌宠显示等配置。

关键词必须来自产品世界：魔女桌宠、Live2D 角色、桌面陪伴、本地身份、本地记忆、模式切换、动作回声、低打扰状态。避免只用“现代、简洁、温暖”这类泛词。

## Depth Strategy

采用轻边框 + 低饱和表面色的层级策略，不使用厚阴影、渐变大背景或卡片套卡片。

- 页面底色：暖纸面，承接当前 `#f7f2ea`。
- 主要面板：浅羊皮纸面，承接当前 `#fffaf0`。
- 输入控件：更清晰的白色内嵌面，表达“可输入”。
- 状态强调：用边框和浅色背景变化表达，不用高饱和大色块。
- 弹出/设置层：只比页面高一层，边框清楚，但不抢聊天主路径。

## Spacing Base Unit

沿用项目既有 18px 模块间距。

- 页面外边距：18px。
- 模块堆叠：`content-stack`，18px gap。
- 折叠/分组体：`fold-body`，18px gap。
- 紧凑控件组：8px 到 10px gap。
- 面板内边距：12px 到 14px，小窗口保持稳定，不引入大 hero 间距。

## Surface / Border / Control Strategy

继续使用既有统一类名：

- 主要操作：`button`。
- 次要操作：`button-light`。
- 危险操作：`button-danger`。
- 子页面导航：`subpage-nav` + `subpage-tab`。
- 状态反馈：`selection-note` 或 `status-box`。
- 章节选择反馈：优先 `selection-note` 或 `status-box`。

控件必须有 hover、active、focus-visible、disabled 状态；焦点态应比普通边框更清楚，但不能刺眼。P2-11C 若调整 CSS，应补齐现有按钮、输入框、tab、模式按钮、历史项和记忆卡的焦点态。

## Typography Rules

- 中文优先使用当前系统字体栈，保持 Windows 可读性。
- 小标签和状态文本保持 12px 到 13px。
- 设置分组标题保持 14px 左右，避免面板内大标题压迫。
- 页面主区标题如新增，应控制在 16px 到 18px。
- 数字、快捷键和计数使用等宽或 tabular number 处理。
- 不用 hero 级字号，不做营销页标题。

## Core Component Patterns

### Partner Status Band

伙伴状态带是项目签名元素。它显示角色身份、模式、Provider、记忆和动作回声的摘要，但不展示 system prompt、Provider 请求正文、API Key、用户正文、AI 正文或事实卡正文。

推荐层级：

```text
角色/模式 -> Provider -> 记忆/动作回声
```

示例：

```text
真央 · 读书模式
本地模型 · qwen3:1.7b
本次使用 1 条记忆 · 刚刚点头
```

### Chat Page

聊天主路径优先级：

1. 本地身份入口，仅首次或清除身份后显示。
2. 伙伴状态带和低打扰模式入口。
3. 会话说明、错误、中断、事实卡保存结果等短反馈。
4. 消息区。
5. 输入区和发送/中断动作。

记忆草稿不应长期占据聊天主路径；P2-11C 可将其改成更明确的临时保存面板或内联操作区。

### Settings

设置页按用户意图分区，不按底层实现堆叠。

- 伙伴外观：桌宠大小、配件、锁定。
- 本地身份：昵称、称呼、清除。
- 对话能力：模式、Provider、模型。
- 本地数据：历史、记忆。
- 操作方式：快捷键、滚轮缩放。
- 连接安全：API Key，仅云端 OpenAI-compatible 显示。

### Memory and History

历史页和记忆页应继续作为独立子页，不把事实卡正文塞进普通聊天气泡。聊天页只显示记忆是否参与和数量；正文、搜索、启用/停用、删除留在记忆页。

### Destructive Actions

删除 API Key、清空历史、清空记忆、清除本地身份都必须有确认或清楚的危险按钮语义。不得把危险操作放在普通 `button-light` 中。

## Signature Element

签名元素：魔女状态缎带。

它不是装饰条，而是一个可执行信息层：角色名/称呼、模式、模型连接、记忆参与、最近动作回声都在这里用低噪声短语出现。视觉上可以使用轻边框、浅羊皮纸面和小型状态徽记，但不得变成大头像卡、营销 hero 或 debug log。

P2-11C 至少应让签名元素出现在：

- 聊天主界面顶部。
- 模式切换反馈。
- Provider 状态摘要。
- 记忆参与摘要。
- 发送中或动作回声位置。

## Do-Not-Do List

- 不复制 Alife 代码、组件库样式、AntDesign 视觉、模型资产或 AGPL 实现。
- 不引入插件市场、模块树或多角色活动中心。
- 不在聊天页暴露完整 system prompt、Provider 请求正文或事实卡正文。
- 不做 landing page、大 hero、装饰性渐变背景或紫蓝 SaaS 面板。
- 不新增与 `button` / `button-light` / `button-danger` 冲突的按钮体系。
- 不使用卡片套卡片组织设置页。
- 不为单次需求新增抽象组件系统；P2-11C 应以现有 HTML/CSS/TS 局部重排为主。

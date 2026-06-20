# P2-2 待机自然呼吸结果

更新日期：2026-06-20

## 实现

- 新增 `src/renderer/pet/live2d/cubism-breath.ts`，仅在模型参数列表包含 `ParamBreath` 时创建 `CubismBreath`。
- 配置：offset `0`、peak `0.25`、cycle `3.5s`、weight `1`。通过 Cubism 的 `addParameterValueById` 将正弦波叠加到本帧已有参数值。
- 帧顺序为：加载参数 → 物理 → 保存参数 → 表情 → 注视 → 呼吸 → `model.update()`。
- 模型释放时清空呼吸控制器引用；缺少 `ParamBreath` 时不创建控制器、不写入参数。

## 自动验证

- `npm.cmd run verify`：通过。
  - TypeScript 主进程、预加载和 Vite 构建通过。
  - 渲染端类型检查通过。
  - `scripts/cubism-breath.test.mts`：2/2 通过，覆盖 `ParamBreath` 识别与缺少该参数时的安全降级。

## 真实 UI 走查

- 使用隔离用户数据目录运行构建产物，未读取或输出项目 `.env.local`。
- 模型实际进入 `live2d` 渲染器；首帧约 2187ms，画布为 630×900，非透明像素为 162915，黑色不透明像素为 1。
- 静置跨越多个呼吸周期观察，模型连续渲染，无黑屏或帧重置；呼吸仅作用于 `ParamBreath`，没有引入头部摆动参数。
- 点击宠物后聊天窗口可正常打开，未出现交互回归。
- 鼠标注视下的幅度与通过表情快捷键切换时的视觉效果未在自动化窗口中单独复测；实现顺序已保证呼吸在这两项之后叠加。

## 清理

- 已关闭隔离 Electron 实例，并删除隔离用户数据、日志、资源链接及所有临时走查文件。

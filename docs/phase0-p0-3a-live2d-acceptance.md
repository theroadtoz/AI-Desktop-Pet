# P0-3A-2 Live2D 验收记录

## 基本信息

- 日期：2026-06-17
- SDK：Cubism 5 SDK for Web R5 (`5-r.5`)
- Core：Live2D Cubism SDK Core Version 6.0.1
- 来源：https://www.live2d.com/en/sdk/download/web/

## 本次纳入的最小 SDK 文件

- `public/cubism/live2dcubismcore.min.js`
- `public/cubism/shaders/webgl/*`
- `src/renderer/pet/live2d/vendor/core/live2dcubismcore.d.ts`
- `src/renderer/pet/live2d/vendor/framework/**`
- `src/renderer/pet/live2d/vendor/shaders/webgl/**`

未提交 SDK zip、Samples、Demo、官方 sample models、第三方模型资源。

## 验收结果

- 真实模型显示：通过。`npm run dev` 日志进入 `renderer: 'live2d'`。
- 首帧像素采样：通过。`canvasWidth: 630`、`canvasHeight: 900`、`nonTransparentPixels: 39760`。
- 透明背景/无黑底：通过。首帧采样 `opaqueBlackPixels: 0`。
- `pet-model://` 加载：通过。完成 model3、moc3、physics、texture 加载。
- 点击/拖拽：未改动 P0-1B 的矩形 hit test、点击打开聊天、拖拽 IPC 和穿透恢复逻辑。
- fallback：保留。Live2D 任一步失败会回退到原 WebGL 占位图并上报 `renderer: 'placeholder'`。
- 自动验证：通过。`npm run verify` 完成 main build、preload build、vite build、renderer typecheck。

## 备注

- 本阶段未接入 idle motion，仅保证真实模型静态可见。
- 本阶段未接模型 HitAreas，继续使用项目侧矩形 hitAreas。
- 本阶段未做纹理降采样，仍使用本地 `魔女` 原始贴图进行验证。
- 允许进入 P0-3B：是。

# P0-3A 前置调研与 Cubism SDK 接入方案

## 1. 目标

P0-3A 前先完成官方 Cubism SDK for Web 接入方案，不直接盲接 Live2D。目标是确认 SDK 来源、许可边界、最小文件清单、模型资源加载路径、renderer 模块结构和 P0-3A 最小实现范围。

明确约束：

- 使用官方 Cubism SDK for Web R5。
- 不使用 PixiJS。
- 不使用 `live2d-widget`、`pixi-live2d-display` 等非官方封装。
- 不把 `魔女/` 原始模型目录、模型纹理、动作、表情等资源发布到 GitHub。
- 不修改原始模型文件，只通过项目侧 manifest 补充信息。

## 2. SDK 来源与版本

官方来源：

- 官方下载页：<https://www.live2d.com/en/sdk/download/web/>
- SDK Manual：<https://docs.live2d.com/en/cubism-sdk-manual/cubism-sdk-for-web/>
- Samples 仓库：<https://github.com/Live2D/CubismWebSamples>
- Framework 仓库：<https://github.com/Live2D/CubismWebFramework>

截至 2026-06-17，官方 GitHub latest release 是 `Cubism 5 SDK for Web R5`，tag 为 `5-r.5`，发布时间为 2026-04-02：

- <https://github.com/Live2D/CubismWebSamples/releases/tag/5-r.5>
- <https://github.com/Live2D/CubismWebFramework/releases/tag/5-r.5>

`5-r.5` 兼容 Cubism 5.3。Samples changelog 记录 R5 正式版改动包含 motion calculation order 改由 `CubismUpdateScheduler` 处理，并调整 `CubismLook` target tracking 参数配置方式；Framework changelog 记录 R5 增加 motion calculation order 调整能力和 `cubismlook`，并移除一批 deprecated API。

## 3. 许可边界

SDK 许可由三层组成：

- `Cubism Web Samples` 和 `Cubism Web Framework` 属于 Live2D Cubism Components，使用 Live2D Open Software License。
- `Cubism Core for Web` 使用 Live2D Proprietary Software License。官方文档明确 Core 不发布在 GitHub，需要从官方 Cubism SDK for Web 分发包获取。
- 发布使用 Cubism SDK 的内容时可能涉及 Cubism SDK Release License。官方 Release License 页面说明：试用和开发阶段不需要发布许可；准备发布内容时才需要进入发布许可判断。个人和小规模企业有豁免条件，但企业和可扩展应用另有规则。

对本项目当前边界的判断：

- 本机毕业设计演示、非公开分发、非收费、非上架，原则上处于验证/开发范围内。
- 仍必须接受官方下载页要求的 Live2D Proprietary Software License Agreement 和 Live2D Open Software License Agreement。
- 不能把第三方模型本体、纹理、动作、表情文件发布到 GitHub。
- 如果未来发布安装包、公开视频素材、上架、商用或开放用户导入模型，需要重新确认 Cubism SDK Release License 和模型授权。

## 4. 最小文件清单

官方 SDK 包顶层目录结构：

```text
.
├─ Core
├─ Framework
└─ Samples
   ├─ Resources
   └─ TypeScript
```

`Core` 用于加载模型。官方 Core README 和 `RedistributableFiles.txt` 当前列出的可再分发文件是：

```text
Core/live2dcubismcore.d.ts
Core/live2dcubismcore.js
Core/live2dcubismcore.min.js
```

当前 R5 官方公开 README 未列出 wasm 文件。因此 P0-3A 先按 JS Core 接入；如果实际下载包后发现额外 wasm runtime，必须先核对官方清单和许可，再决定是否纳入最小 runtime。

`Framework` 是 TypeScript 源码和 WebGL 渲染实现，关键目录包括：

```text
Framework/src
Framework/Shaders/WebGL
```

`Samples/TypeScript/Demo/src` 是最小接入流程参考，关键文件包括：

```text
Samples/TypeScript/Demo/src/main.ts
Samples/TypeScript/Demo/src/lappdelegate.ts
Samples/TypeScript/Demo/src/lappglmanager.ts
Samples/TypeScript/Demo/src/lapplive2dmanager.ts
Samples/TypeScript/Demo/src/lappmodel.ts
Samples/TypeScript/Demo/src/lapptexturemanager.ts
Samples/TypeScript/Demo/src/lappview.ts
```

Sample 中最小模型加载流程：

1. 初始化 Framework：`CubismFramework.startUp(option)` 后调用 `CubismFramework.initialize()`。
2. 创建 WebGL2 context 和 Cubism renderer。
3. `LAppModel.loadAssets(dir, fileName)` fetch `.model3.json`。
4. 用 `CubismModelSettingJson` 解析 `.model3.json`。
5. 从 setting 加载 `.moc3`，调用 `CubismUserModel.loadModel()`。
6. 按 setting 或项目侧 manifest 加载 expression、physics、pose、userData、motion。
7. 加载纹理，绑定到 renderer texture unit。
8. 每帧更新 motion/effect/physics 后调用 renderer draw。
9. 退出时调用 `CubismFramework.dispose()`。

Phase 0 最小 SDK 文件清单建议：

```text
vendor/cubism/README.md
src/renderer/pet/live2d/vendor/framework/**    # 从官方 Framework/src 复制的最小 TS 源码
src/renderer/pet/live2d/vendor/shaders/webgl/** # Framework/Shaders/WebGL
public/cubism/live2dcubismcore.min.js           # 或等价 dist 静态资源路径
src/renderer/pet/live2d/vendor/core/live2dcubismcore.d.ts
```

不提交：

- 官方 SDK 压缩包。
- `Samples/`、`Samples/Resources/` 和官方 sample models。
- `Core/live2dcubismcore.js.map`，除非本地调试确实需要。
- `魔女/` 原始模型目录。

## 5. 项目放置方案

推荐方案：

- 新建 `vendor/cubism/README.md` 记录下载版本、下载地址、复制步骤和许可注意事项。
- SDK 本体暂时不整体提交；P0-3A 只复制可运行所需的最小 runtime 文件。
- Core 使用官方分发包里的 `live2dcubismcore.min.js` 作为 renderer 静态资源，避免通过 npm 拉取非官方包。
- Framework 源码纳入 `src/renderer/pet/live2d/vendor/framework`，便于 Vite/TypeScript 直接构建和后续裁剪。
- Shader 文件纳入 `src/renderer/pet/live2d/vendor/shaders/webgl` 或 public 静态目录；R5 beta 后 Framework 允许 shader 从 sample/app 层指定路径，P0-3A 需要显式配置。
- 后续如打包需要，可增加 npm script 把 `public/cubism/*` 复制进 `dist/renderer` 或 Electron 资源目录。

`.gitignore` 后续建议增加：

```gitignore
vendor/cubism/*.zip
vendor/cubism/CubismSdkForWeb-*/
vendor/cubism/**/Samples/
vendor/cubism/**/Demo/
魔女/
```

当前 `.gitignore` 中本地模型目录条目存在编码显示异常，P0-3A 实施前需要确认 Git 实际忽略的目录名是否就是 `魔女/`。

## 6. 资源协议设计

renderer 不应看到或拼接 `E:\Work-26\AI_Desktop_Pet\魔女` 这样的绝对路径。P0-3A 使用主进程注册只读协议：

```text
pet-model://witch/魔女.model3.json
pet-model://witch/魔女.moc3
pet-model://witch/魔女.physics3.json
pet-model://witch/魔女.cdi3.json
pet-model://witch/魔女.8192/texture_00.png
pet-model://witch/魔女.8192/texture_01.png
pet-model://witch/Scene1.motion3.json
pet-model://witch/x.exp3.json
```

协议解析流程：

1. 主进程启动时读取 `resources/models/witch/model-manifest.json`。
2. 将 manifest 的 `sourceDir` 解析为绝对路径并 `realpath`。
3. 注册 `pet-model://` 只读协议。
4. 请求 `pet-model://witch/<relativePath>` 时，仅允许 `host === "witch"`。
5. 对 URL path 做 decode、normalize、拒绝空路径、绝对路径、盘符、`..` 逃逸和反斜杠混淆。
6. 将 path 拼到 manifest 指向的 source root 后再次 `realpath`。
7. 若目标不在 source root 内，返回 403/404。
8. 仅允许 manifest 中声明的 model3、moc3、physics、displayInfo、idleMotion、textures、expressions 文件，以及 `.model3.json` 内引用但经 manifest 白名单确认的文件。
9. 按扩展名返回 MIME：`.json`、`.moc3`、`.png`。

安全边界：

- renderer 只拿协议 URL，不拿绝对路径。
- 协议只读，不提供目录列表。
- 协议只服务 manifest 指向的模型根目录，不允许访问项目其他文件。
- 不把模型资源复制到 `dist` 或 GitHub。
- P0-3A 不做用户导入模型，所以不需要开放任意模型目录。
- 未来打包时可把协议后端从本地目录替换为 app resources、用户数据目录或授权资源包，不影响 renderer。

## 7. renderer 模块结构

P0-3A 先在 `src/renderer/pet/live2d/` 下建立清晰边界：

```text
src/renderer/pet/live2d/
  cubism-runtime.ts
  cubism-model.ts
  cubism-renderer.ts
  cubism-motion.ts
  cubism-expression.ts
  context-recovery.ts
```

职责：

- `cubism-runtime.ts`
  - 加载 `live2dcubismcore.min.js`。
  - 初始化 `CubismFramework.startUp()` 和 `CubismFramework.initialize()`。
  - 管理 runtime 初始化幂等性和 dispose。
- `cubism-model.ts`
  - 读取 `pet-model://witch/魔女.model3.json`。
  - 用 `CubismModelSettingJson` 解析 model3。
  - 加载 moc3、textures、physics、displayInfo。
  - 不修改原始 model3，不依赖 model3 自带 expression/motion 引用。
- `cubism-renderer.ts`
  - 绑定现有 `#pet-canvas` 的 WebGL2 context。
  - 负责 viewport、blend、premultiplied alpha、透明 clear。
  - 保持 Electron 透明窗口背景为透明，不引入黑底。
- `cubism-motion.ts`
  - 加载 manifest 中的 `idleMotion`。
  - Phase 0 只做 idle loop；若 motion 加载失败，模型静态可见也算降级成功。
- `cubism-expression.ts`
  - 加载 manifest 中 expressions。
  - Phase 0 先支持 `happy`、`sad`、`angry`、`neutral`。
  - `neutral` 允许映射为 `null`，表示回到默认参数。
- `context-recovery.ts`
  - 监听 `webglcontextlost` 并 `preventDefault()`。
  - 监听 `webglcontextrestored`。
  - P0-3A 先暴露接口和日志，完整重建资源留到 P0-5。

`src/renderer/pet/main.ts` 后续只保留窗口交互和启动编排，把现有 WebGL 占位绘制替换为 Live2D runtime 调用。现有点击/拖拽仍使用项目侧矩形 hitAreas，P0-3A 不接 Cubism HitAreas。

## 8. P0-3A 最小实现范围

P0-3A 只做：

- 初始化官方 Cubism SDK for Web R5。
- 从项目 manifest 加载 `魔女.model3.json`。
- 加载 `.moc3`。
- 加载 2 张纹理。
- 加载 physics。
- 在透明 pet 窗口中渲染真实模型。
- 播放 idle motion，或至少模型静态可见。
- 背景保持透明。
- 保持现有点击/拖拽能力。
- `npm run verify` 通过。

P0-3A 不做：

- 不接真实 AI。
- 不做 SQLite。
- 不做 TTS/ASR。
- 不做长期记忆。
- 不做用户导入模型。
- 不做纹理降采样。
- 不做安装包。
- 不做完整表情系统。
- 不做复杂碰撞检测。
- 不做像素级命中。
- 不做多模型切换。

## 9. 风险与备选方案

风险：

- 8192 纹理可能导致显存占用高、加载慢、首帧延迟大。
- Electron 透明窗口 + WebGL2 + Cubism 可能出现黑底或 alpha 合成异常。
- Cubism SDK 路径复杂，Core JS、Framework alias、shader 路径容易加载失败。
- R5 Framework 从 5-r.5-beta.3 起把 shader 字符串改为外部文件，P0-3A 必须确认 shader 文件路径。
- `model3.json` 没有 expression/motion 引用，需要项目侧 manifest 补充。
- 当前模型没有 HitAreas，继续使用项目侧矩形命中区。
- context lost 恢复暂时不完整，P0-5 再做完整重建。
- 模型授权只允许本机毕业设计演示，不允许公开分发模型本体。
- 当前资源 manifest 和本地许可 README 在 PowerShell 输出中显示为 mojibake，需要确认文件编码和 Git 忽略项，不应在 P0-3A 中误提交模型目录。

备选方案：

- 若 `live2dcubismcore.min.js` 在 Vite bundling 中不可直接 import，则作为静态脚本由 `cubism-runtime.ts` 动态注入 `<script>`。
- 若 shader 文件路径在 packaged Electron 下失败，改为由 Vite `?raw` 导入 shader 文本，再传给 renderer。
- 若 WebGL2 透明合成出现黑底，先回退到静态透明 canvas 验证 alpha，再逐步启用 Cubism renderer；必要时调整 `premultipliedAlpha` 和 `backgroundColor`。
- 若 8192 纹理导致本机不可演示，P0-3A 记录失败并进入 P0-4 纹理降采样，而不是在 P0-3A 私自修改原模型。

## 10. 下一步实施清单

1. 下载官方 Cubism SDK for Web R5 `5-r.5` 分发包。
2. 新建 `vendor/cubism/README.md`，记录下载来源、版本、许可和复制步骤。
3. 只复制 Phase 0 最小 runtime 文件，不提交 Samples、Demo、官方 sample models 和 SDK 压缩包。
4. 修正或确认 `.gitignore` 中 `魔女/` 本地模型目录忽略项。
5. 在主进程新增只读 `pet-model://` 协议。
6. 用 `resources/models/witch/model-manifest.json` 解析 `sourceDir`，并约束协议访问范围。
7. 新增 `src/renderer/pet/live2d/` 模块结构。
8. 在 `cubism-runtime.ts` 初始化 Core 和 Framework。
9. 在 `cubism-model.ts` 加载 model3、moc3、physics、textures。
10. 在 `cubism-renderer.ts` 绑定现有透明 canvas 并绘制真实模型。
11. 在 `cubism-motion.ts` 加载并循环 `Scene1.motion3.json`；失败时保留静态模型可见。
12. 保留现有项目侧矩形 hitAreas 和拖拽/点击 IPC。
13. 执行 `npm run verify`。
14. 手工运行 pet 窗口，检查透明背景、无黑底、点击穿透、角色区域拖拽。

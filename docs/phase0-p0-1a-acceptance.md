# P0-1A 验收记录

日期：2026-06-17

## 范围

仅验收 Electron 透明 pet 窗口的当前占位实现，不接入 Live2D、AI、SQLite、TTS、ASR、长期记忆或打包发布。

## 执行命令

- `npm run verify`
- `npm run dev`

## 结果

- `npm run verify` 通过。
- `npm run dev` 构建成功，主进程收到 `[pet] first frame reported`。
- pet 窗口已创建并可见，尺寸为 `420x600`。
- pet 窗口样式为 `exStyle=0x08280028`，包含：
  - `WS_EX_TOPMOST`：置顶
  - `WS_EX_TRANSPARENT`：整窗点击穿透
  - `WS_EX_LAYERED`：分层透明窗口
  - `WS_EX_NOACTIVATE`：不抢焦点
- 窗口自身截图可见半透明 WebGL 占位角色。
- 桌面合成检查未发现 pet 窗口黑底覆盖。
- Win32 命中测试：
  - pet 空白区域命中下层窗口，不命中 pet。
  - 当前角色本体区域同样命中下层窗口，不命中 pet；这是 P0-1A 预期行为，P0-1B 再实现自定义命中区。
- 前台窗口不是 pet，符合不抢焦点预期。

## 结论

P0-1A 验收通过。下一步可以进入 P0-1B：新增主进程 pointer controller，基于 head/body 命中区切换点击穿透，并实现点击打开聊天窗口与主进程拖动。

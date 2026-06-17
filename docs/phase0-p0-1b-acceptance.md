# Phase 0 P0-1B 验收记录

## 执行日期

2026-06-17

## 执行命令

```powershell
git status -sb
git push origin main
git status -sb
npm.cmd run verify
```

## 自动验证结果

- P0-1A 本地提交已推送到 `origin/main`。
- 推送后本地状态为 `main...origin/main`，没有 ahead。
- `npm.cmd run verify` 已通过。
- `魔女/` 模型目录未纳入本次变更。
- 本地 Windows 自动化助手初始化失败，未完成可视桌面交互验收。

## 人工桌面验收结果

### 人工验收日期

2026-06-17

### 通过项

- `npm.cmd run dev` 已执行。
- 沙箱内启动时 Electron 无法创建用户目录 single-instance lock/cache；提权后可创建 `AppData\Roaming\ai-desktop-pet` 运行时目录，并出现 Electron 运行进程。
- `npm.cmd run verify` 已通过，P0-1B 自动验证保持通过。

### 未通过项

- 未完成“桌面出现半透明 WebGL 占位角色、没有黑底、pet 窗口不抢焦点”的可视确认。
- 未完成点击角色外空白区域的系统级穿透确认。
- 未完成点击角色头部/身体区域打开聊天窗口确认。
- 未完成聊天窗口输入框聚焦与输入确认。
- 未完成角色区域拖拽、4 DIP 阈值、小幅点击不误判拖拽确认。
- 未完成拖拽释放后空白区域恢复穿透确认。
- 未完成连续拖动 10 次、连续点击角色 10 次、连续点击空白区域 10 次的压力检查。

### 阻塞原因

- 当前 Codex 桌面自动化插件初始化失败：`Package subpath './dist/project/cua/sky_js/src/targets/windows/internal/computer_use_client_base.js' is not defined by "exports"`。
- 当前会话无法通过合规桌面输入通道执行真实点击、拖拽、输入和窗口焦点观察。
- 当前会话也无法可靠截取交互桌面画面，临时截图已删除。

## P0-1B 实现项

- pet IPC 合同新增明确方法：`pet:pointer-hit-change`、`pet:open-chat`、`pet:drag-start`、`pet:drag-move`、`pet:drag-end`。
- pet preload 只通过 typed `PetApi` 暴露明确方法，没有通用任意 channel 入口。
- 主进程新增 pointer controller，集中管理点击穿透、60ms 延迟恢复和拖拽期间不穿透。
- renderer 使用矩形命中区：
  - head：x 25% - 75%，y 5% - 33%
  - body：x 22% - 78%，y 28% - 83%
- renderer 只在命中状态变化时通知主进程，避免每帧 IPC。
- 命中区内点击触发聊天窗口打开。
- 命中区内按下并移动超过 4 DIP 后进入拖拽，由主进程移动窗口。

## 待人工桌面验收

- 空白区域点击能落到底层窗口。
- 角色区域点击能打开聊天窗口。
- 聊天窗口显示后输入框能聚焦。
- 角色区域按住可拖动。
- 小幅点击不会误判为拖拽。
- 拖动 10 次无卡死。
- 拖拽释放后空白区域仍然穿透。

## 已知问题

- 未接 Live2D。
- 未接真实 AI。
- 当前命中区为矩形近似，不做像素级检测。

## 是否允许进入 P0-2A

否。

P0-1B 人工桌面交互验收尚未通过，不允许进入 P0-2A。

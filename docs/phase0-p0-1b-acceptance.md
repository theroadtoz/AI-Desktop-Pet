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

待人工桌面验收通过后允许进入 P0-2A。

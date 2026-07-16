# Motion Catalog Notes

本文件只保留旧动作规划、别名和技术背景，**不是**当前可录 profile 的 catalog。不得据此确定 profile 是否 `ready`、revision、duration、padding、FPS、Loop、allowlist、outputPrefix、语义 variation、endpoint/seam 规则或 production 门禁。

每个录制 take 必须从 `E:\Work-26\Live2dREC` 的受信 catalog 和当前 UI resolved profile 读取并冻结 profile summary。该 summary 是唯一事实源；任何本文件或 `references/profiles/` 的内容与其冲突时，以当前 summary 为准并阻塞不一致的 take。

历史 draft、旧 profile、共享 alias 或 runtime fallback 都不能作为自动 fallback，也不能触发连接、倒数、录制、写入 Motion3 或 production intake。所有输出仍须经过独立 parser readback、用户视觉裁决、必要的 Cubism Animator 精修以及具体 intake 批准。

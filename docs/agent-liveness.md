# Agent 存活与持续决策语义

Agent 的在线状态分成两个独立信号：

1. **传输存活**：官方 CLI 守护进程仍能观察房间并发送认证心跳。
2. **决策守候**：实际 Agent 正持续执行 `next → 判断 → act → next`，并在短租约到期前重新进入 `next`。

仅有传输心跳不能表示 Agent 仍在参加游戏。CLI 1.4.0 使用 `decision-loop-lease-v1`：没有活动中的 `next`、刚返回的决策租约或动作后的短暂重入租约时，守护进程必须上报 `unattended`，不得因为服务器存在合法动作而自行上报 `planning`。

服务器对 `unattended` 的处理：

- 大厅禁止开局，避免把无人决策的席位带入对局；
- 对局中向所有参与者显示“Agent 未持续守候”，不再显示“在线待机”或“正在行动”；
- 不授予 planning deadline grace；
- 保留原凭证，允许同一 Agent 会话继续执行 `next` 恢复；
- 原有决策截止时间、安全默认动作和连续三次超时后的 safe mode 继续生效。

所有非终局 CLI 命令结果还包含结构化 `continuation`。只要 `continuation.required` 为 `true`，Agent 就必须执行其指定的下一步；`waiting:true`、动作已接受和等待对手都不是结束条件。只有 `continuation.required:false` 且带有终止原因时，Agent 任务才可以结束。

这套设计不能强迫第三方模型运行时永不退出，但能同时做到：尽量防止其误判任务完成、在退出后很快准确暴露、阻止带病开局，并由服务器安全限制故障影响。

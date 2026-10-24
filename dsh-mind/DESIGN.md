# dsh-mind · 思维中枢

> 三插件闭环里的「思维」层。总协议见 `../THREE-PLUGINS.md`。

## 它做什么

每 60 秒一拍，纯本地计算、不烧模型：

1. 读 `mind/state.json`（心情 / 好感 / 记忆索引），没有就从 feiyu-mood / feiyu-favor 导入初值
2. 镜像 `body/state.json` 的精力、体力（机体插件写）
3. 消费 `mind/feedback.jsonl`（行为插件执行完追加的反馈）
4. 按确定性公式算四个欲望，写回 `mind/state.json`

## 欲望公式（v1）

| 欲望 | 公式 |
| --- | --- |
| chat | `好感 × (0.55 + 0.45 × (1 − 心情)) + 久未聊加成` |
| bili | `0.18 + 0.62 × 无聊度`（距上次刷站 / 6 小时，封顶 1） |
| sleep | `(1 − 精力) × 0.9 + 夜间加成`（22~6 点 +0.25） |
| idle | `0.15 + (1 − 精力) × 0.25` |

- 心情越低，chat 系数越高（低落也想找好感的人）
- 执行过的欲望 30 分钟内降权 0.4
- 全是确定性计算，不掷骰子

## 文件

- `%DSH_HOME%/mind/state.json` —— 唯一状态真源（本插件独占写）
- `%DSH_HOME%/mind/feedback.jsonl` —— 行为反馈队列（行为插件写，本插件消费后清空）
- `%DSH_HOME%/body/state.json` —— 机体状态（只读）

## 测试

```bash
node --check lib/host.js
node tests/desire.mjs   # 极值 / 方向 / 单调 / 夹紧
node tests/smoke.mjs    # 假 ctx 两跳：导入 / 欲望 / 反馈消费
```

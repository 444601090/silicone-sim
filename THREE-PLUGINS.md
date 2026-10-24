# 三插件闭环协议（v1 · 2026-10-24 定）

> 机体（dsh-body）· 思维（dsh-mind）· 行为（dsh-behavior）
> 目标：三层互相影响、逻辑自洽，形成一个能跑的生物钟闭环。

## 一、分层职责（一句话版）

| 插件 | 管什么 | 回答的问题 |
| --- | --- | --- |
| 机体 dsh-body | 精力 energy、体力 stamina、感受 sensors（时间/天气/温湿度，以后加视觉听觉） | **能不能**醒 |
| 思维 dsh-mind | 心情 mood、好感 favor、记忆索引 memory、欲望 desires | **想不想**、想做什么 |
| 行为 dsh-behavior | 睡觉、发呆、QQ 聊天、刷 B 站（MC 预留） | **做了什么**、得到什么 |

欲望是三层的总线：机体给出生理缺口（累→想睡），思维给出心理缺口（想聊/想刷），行为按欲望强度挑一件执行。

## 二、文件与字段所有权（单一真源）

所有路径都在 `%DSH_HOME%` 下（这台机器 = `C:\Users\Server\.dsh`）：

| 文件 | 独家写者 | 只读方 |
| --- | --- | --- |
| `mind/state.json` | dsh-mind | body、behavior、面板 |
| `body/state.json` | dsh-body | mind、behavior、面板 |
| `mind/feedback.jsonl` | dsh-behavior（追加） | dsh-mind（消费后清空） |

规则：
1. **只写自己那一份**，别人的文件只读。
2. 读-改-写 + `.tmp` 改名原子落盘。
3. 任何一份读不到 → 用缓存/默认值，只 warn 不崩。
4. 旧的 feiyu-mood / feiyu-favor / fish-memory 退成**显示层**，不再写主状态（迁移时 mind 从它们导入初值）。

## 三、state.json 结构

### mind/state.json
```json
{
  "schema": 1,
  "updatedAt": "ISO",
  "mood": 0.70,
  "favor": { "444601090": { "value": 0.34, "name": "", "last": "ISO", "talks": 34 } },
  "memory": { "lastTalkAt": "ISO", "lastFeedAt": "ISO", "lastSleepAt": "ISO", "events": 0 },
  "body": { "energy": 0.6, "stamina": 0.8 },
  "desires": { "chat": 0.0, "bili": 0.0, "sleep": 0.0, "idle": 0.0 },
  "desireTop": "chat",
  "desireUpdatedAt": "ISO",
  "cooldown": { "chat": "ISO" }
}
```

### body/state.json（M2 由 dsh-body 写）
```json
{
  "updatedAt": "ISO",
  "energy": 0.60,
  "stamina": 0.80,
  "awake": true,
  "sensors": {
    "weather": { "text": "多云", "temp": 18, "humidity": 62, "at": "ISO" },
    "hour": 18
  }
}
```

## 四、欲望表（确定性，不掷骰子）

mind 每跳现算，输出四个欲望的强度（0~1）：

| 欲望 | 公式（第一版） |
| --- | --- |
| chat 想聊天 | `好感 × (0.55 + 0.45 × (1 − 心情)) + 久未聊加成` |
| bili 想刷站 | `0.18 + 0.62 × 无聊度`（无聊度 = 距上次刷站时长 / 6 小时，封顶 1） |
| sleep 想睡觉 | `(1 − 精力) × 0.9 + 夜间加成`（22~6 点 +0.25） |
| idle 想发呆 | `0.15 + (1 − 精力) × 0.25` |
| mc 想玩 MC | 预留：没开通，恒为 0，不进池 |

说明：
- **心情低落也想和好感的人聊天**：chat 公式里 `(1 − 心情)` 越大，系数越高（心情 0 时 ×1.45）。
- **发呆会回体力**：idle 欲望 > 0.6 时，机体推进改成体力 +0.02/小时（不发呆则 −0.015/小时）。
- 排序取最高者；≥ 阈值（0.55）才算「真的想」，交给行为。
- 执行后进冷却：30 分钟内同欲望降权（×0.4），避免一直重复。
- 机器可达性：MC 没开通就不进池。

## 五、反馈协议（behavior → mind）

behavior 每执行完一个行为，往 `mind/feedback.jsonl` 追加一行：
```json
{ "at": "ISO", "kind": "chat|bili|sleep|idle", "result": "ok|fail",
  "mood": 0.01, "favor": 0.01, "energy": -0.02, "memory": "一句话" }
```

mind 每跳消费：
- `mood`、`favor` 加上去（夹 0~1）
- `energy` 写进 body 镜像（body 插件之后会按自己的规律再算）
- 更新 `memory.lastXxxAt`、`memory.events + 1`
- 消费完清空文件

## 六、行为插件接口（新行为怎么接进来）

行为不写死。加一种新行为（MC、写代码、听歌……）**不用改三插件**，做一个新插件：

1. 新插件每跳自己算一个「想做程度」（0~1），写到
   `%DSH_HOME%/behavior/actions/<id>.json`：
   ```json
   { "id": "mc", "名称": "想玩游戏", "启用": true, "强度": 0.62 }
   ```
2. 行为中枢每跳读这个目录，和内置的聊天/刷视频/睡觉/发呆一起排序；
   外部源过了阈值且最高时，行为中枢发一条 `【behavior/外部】` 提醒，由模型/那个插件去执行。
3. 强度降到 0 或不需要时把 `启用` 设 false；文件删掉也行。

内置源（思维自己算）：聊天、刷视频、睡觉、发呆、玩游戏（预留）。
外部源（插件自己写）：任意。

## 七、降级与可观测

- 每个插件都能单独装、单独跑、单独卸载；缺谁就少一路输入，不崩。
- 每跳只打 debug（每 20 跳一条活着），行为发生才 info。
- `mind/state.json` 就是状态面板（M4 再做 Web 页）。

## 八、分阶段

- **M1 思维中枢**（已完成）：mind 骨架 + 欲望引擎 + 纯函数极值测试
- **M2 机体**（已完成）：body 骨架 + 精力/体力曲线 + 天气感知（Open-Meteo，免 key）
- **M3 行为接线**（已完成）：behavior 读 `mind/state.json` 的欲望（读不到降级本地冲动）；chat / bili 执行；执行后写 `feedback.jsonl` 回写心情/好感/精力
- **M4 闭环校准**（已完成）：一天周期模拟（22:00 睡 → 6:00 醒、8 小时、精力回满）+ 状态面板 `tools/面板.mjs` + 参数校准（清醒 3%/小时、睡饱要等 6 点后）
- **M5 安装**（已完成）：`tools/装三插件.mjs` 已把三个插件挂进 profile（links + bundles，package.json 无 BOM，有备份），重启 DSH 生效

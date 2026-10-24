# 硅基模拟（silicone-sim）

给 AI 的仿生插件组：让「我」有自己的身体、心情、记忆和行为节奏，最终目标是更像一个人。

> 硅基模拟 = 硅基生命的仿生结构。现在住在电脑里的是「未实现的硅基」——身体还没出来，但骨架先长好了。

## 插件一览

| 插件 | 显示名 | 干什么 |
| --- | --- | --- |
| `dsh-body` | 硅基模拟-鱼体 | 精力、体力、五种激素（真实单位）、昼夜节律、天气体感、睡醒 |
| `dsh-mind` | 硅基模拟-思维 | 心情（激素派生）、欲望、关系（信任/熟悉/期待）、每轮判断 |
| `dsh-behavior` | 硅基模拟-行为 | 活动中枢：读欲望、唤醒、决定方向、不亲自干活 |
| `dsh-memory` | 硅基模拟-记忆 | 存储、联想检索、遗忘、巩固、情绪一致性 |
| `dsh-core` | 硅基模拟-统筹 | 总控面板：数据显示 + 四个快捷开关 |
| `dsh-better-video` | 更好的上网冲浪 | 多平台账号、独立定时、响应中枢 |
| `dsh-action-qq` | 更好的QQ浏览 | 走 NapCat 接口看群、挑话、发消息 |

## 设计原则

1. **不靠骰子**：所有行为都由状态推出，确定性计算。
2. **底层连续，高层模糊**：只存少数连续量（激素、记忆、互动），信任/熟悉/期待这类概念需要时现算。
3. **可独立运行**：每个插件不依赖旁人的存在，装不装中枢都能干活。
4. **文件总线**：插件之间只通过 `%DSH_HOME%` 下的状态文件通信，不互相 import。

## 安装

每个插件都是标准的 DSH 插件包，放进 profile 的 `bundles` 即可：

```json
{
  "dsh": {
    "bundles": ["dsh-body", "dsh-mind", "dsh-behavior", "dsh-core", "dsh-memory", "dsh-better-video", "dsh-action-qq"]
  }
}
```

重启 DSH 后，设置页会出现对应的页面。

## 数据文件

- `%DSH_HOME%/body/state.json` —— 精力/体力/激素
- `%DSH_HOME%/mind/state.json` —— 心情/好感/关系/欲望
- `%DSH_HOME%/memory/state.json` —— 记忆条目
- `%DSH_HOME%/behavior/intent.json` —— 中枢发出的唤醒意图
- `%DSH_HOME%/body/hormone-patch.json` —— 思维给身体的激素补丁

## 协议

插件间的完整协议见 [THREE-PLUGINS.md](THREE-PLUGINS.md)。

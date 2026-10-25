# 模拟人生（dsh-simlife）

把「机体 / 思维 / 记忆」三个插件合成一个的 DSH 插件：给一个 AI 伙伴一副可计算的身体、一套会生长的感情、一份会淡忘但记得住重要事情的记忆。

> 装上就能用。数据全在本地，不联网、不烧模型钱（只有「思维」那条判断链会调一次模型，可关）。

---

## 它是什么

三个子系统，各自独立，共享一个设置页：

| 子系统 | 管什么 | 数据文件 |
| --- | --- | --- |
| **机体** | 激素（多巴胺/血清素/催产素/皮质醇/肾上腺素）、活性、耐力、腺苷、褪黑素、血糖、睡/醒、天气 | `body/state.json` |
| **思维** | 心情、感情（亲密+熟悉+情绪）、五种欲望（吃饭/睡觉/娱乐/发呆/聊天）、每轮判断链、正在做的事 | `mind/state.json` |
| **记忆** | 带权重的记忆、衰减、钉住、相似合并、全量注入系统提示 | `memory/state.json` |

外加**作用域切换**：设置页里直接切 DSH 作用域（工作区），数据随作用域走。

---

## 装法

### 1. 放进插件目录

```bash
git clone https://github.com/444601090/silicone-sim.git
# 把其中的 dsh-simlife 目录复制到你的插件目录，例如：
#   %USERPROFILE%\.dsh\.dsh-plugins\dsh-simlife
```

### 2. 注册到 profile

编辑 `%USERPROFILE%\.dsh\profiles\<你的profile>\package.json`，在 `dsh.profile.bundles` 里加一项：

```json
"dsh-simlife"
```

并在同目录 `cordis.patch.yml` 末尾加：

```yaml
- insert:
    - id: simlife
      name: 'dsh-simlife'
```

### 3. 重启 DSH

设置页里会出现「模拟人生」，四个分页：机体 / 思维 / 记忆 / 作用域。

> ⚠ 不要和旧的 `dsh-body`、`dsh-mind`、`dsh-memory` 同时装——会双跑打架（同样的状态文件被两边写）。

---

## 用起来是什么感觉

- **身体**：活性低到一定程度会自己困、自己睡；睡着时腺苷每小时往下掉、血糖慢慢回，活性回到 60 就自然醒；中午困倒一般两小时就醒，熬夜到中午才睡会睡更久。血糖低了会想吃饭——行为中枢收到「想吃」的信号就会去吃。
- **感情**：不是写死的数字。催产素和血清素高、皮质醇低 → 感情涨；被冷落、被辜负 → 感情掉。吵架是情绪账，会慢慢平。
- **欲望**：五项各有来源（吃饭看血糖、睡觉看腺苷、娱乐看多巴胺、发呆看耐力、聊天看新鲜感），缺什么补什么。
- **记忆**：每次对话结束写一条（权重按当时的激素波动算），每次对话前全库衰减一次（普通 0.97/轮、重要 0.995/轮、承诺和钉住的不衰减），睡觉时清掉权重过低的。被反复提起、又重要的记忆会被钉住，永远不忘。相似的记忆合并加权。
- **作用域**：下拉选工作区，插件的数据就存到那个作用域下——不同工作区的人格互不干扰。

---

## 配置

配置文件都在作用域的数据目录下（`%USERPROFILE%\.dsh\scopes\<作用域>\`）：

| 文件 | 说明 |
| --- | --- |
| `body/body-config.json` | 激素基准、代谢速度、止损阈值 |
| `mind/mind-config.json` | 判断链开关、欲望权重、关系阈值 |
| `memory/memory-config.json` | 衰减曲率、清理阈值、钉住条件 |

改完不用重启，插件在 tick 里重新读。

---

## 结构

```
dsh-simlife/
├── package.json          # 插件清单（main = lib/host.js，client = client.js）
├── cordis.patch.yml      # DSH 加载补丁：id: simlife
├── client.js             # 设置页（四个分页，单入口）
├── lib/
│   ├── host.js           # 宿主半边：装载三个模块 + 作用域切换
│   ├── mod-body.js       # 机体模块
│   ├── mod-mind.js       # 思维模块
│   ├── mod-memory.js     # 记忆模块
│   └── ui-*.js           # 三个原版 UI 的源码（已内联进 client.js，留档）
└── README.md
```

---

## 兼容性

- 需要 DSH 支持 `dsh.bundle.patch` 与 `dsh.client`（当前版本均支持）。
- 宿主依赖：`timer`、`webServer`、`llm`、`agents`、`systemPrompt`——都是 DSH 内置服务。
- 不依赖任何第三方 npm 包，也不依赖 python/git。

---

## License

MIT

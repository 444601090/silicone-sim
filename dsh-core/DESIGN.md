# dsh-core · 统筹中枢

> 三插件闭环的管理面板。协议见 `../THREE-PLUGINS.md`。

## 它做什么

- 只读 `body/state.json`、`mind/state.json`、`behavior-state.json`
- 起一个网页面板：`http://127.0.0.1:<DSH端口>/dsh-core`，每 3 秒自动刷新
- 提供几个总开关（写 `behavior-config.json`）：
  - 试运行 开/关
  - 总开关 开/关
  - 欲望阈值 ±0.05

## 接口

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/dsh-core` | 面板页（HTML） |
| GET | `/dsh-core/data` | 三插件快照（JSON） |
| POST | `/dsh-core/config` | 改行为配置（只认白名单：总开关 / 试运行 / 安静时段 / 主动聊天.冲动阈值） |

端口就是 DSH 当前的端口（每次重启可能变，从 DSH 地址栏拿）。

## 为什么用网页面而不是 DSH 设置页

设置页要写 client 半边（React 组件、slots），改一次就要重新打包；网页面是插件自己的 HTTP 路由，
浏览器打开就是一个实时面板，不占 DSH 界面、不依赖前端构建。

## 测试

```bash
node --check lib/host.js
node tests/core.mjs   # 快照读取 / 改配置白名单 / 越界夹紧
```

// DSH「统筹中枢」（dsh-core）· 宿主半边
//
// 把机体 / 思维 / 行为三插件的状态集中展示成一个网页面板（自动刷新），
// 并提供几个总开关（总开关 / 试运行 / 欲望阈值 / 安静时段）。
//
// ⚠ 这个插件不参与算状态：只读三份 state.json，改行为配置，然后把结果画出来。
// ⚠ 拿不到 webServer 就只 warn，不让插件加载失败。
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 插件对外名字（也是日志前缀）。 */
export const name = 'core'

/** 需要宿主的 webServer 服务（挂面板路由用）。 */
export const inject = ['webServer']

const 目录 = process.env.DSH_HOME || join(homedir(), '.dsh')
const 机体文件 = join(目录, 'body', 'state.json')
const 思维文件 = join(目录, 'mind', 'state.json')
const 行为文件 = join(目录, 'behavior-state.json')
const 行为配置 = join(目录, 'behavior-config.json')
const 反馈文件 = join(目录, 'mind', 'feedback.jsonl')

const 路由前缀 = '/dsh-core'

// ---------- 小工具 ----------

function 读JSON(路径) {
  try {
    if (!existsSync(路径)) return null
    return JSON.parse(readFileSync(路径, 'utf8'))
  } catch (error) {
    return null
  }
}

function 写JSON(路径, 数据) {
  try {
    mkdirSync(dirname(路径), { recursive: true })
    const 临时 = `${路径}.tmp`
    writeFileSync(临时, JSON.stringify(数据, null, 2), 'utf8')
    renameSync(临时, 路径)
    return true
  } catch (error) {
    try {
      writeFileSync(路径, JSON.stringify(数据, null, 2), 'utf8')
      return true
    } catch (error2) {
      return false
    }
  }
}

function 分钟前(iso) {
  const t = Date.parse(String(iso || ''))
  return Number.isFinite(t) ? Math.round((Date.now() - t) / 60000) : null
}

function 数(值, 兜 = 0) {
  const n = Number(值)
  return Number.isFinite(n) ? n : 兜
}

/** 拼一份三插件快照（只读，不改任何文件）。 */
export function 快照() {
  const 机体 = 读JSON(机体文件)
  const 思维 = 读JSON(思维文件)
  const 行为 = 读JSON(行为文件)
  const 配置 = 读JSON(行为配置) || {}

  let 反馈 = 0
  try {
    if (existsSync(反馈文件)) {
      反馈 = readFileSync(反馈文件, 'utf8').split('\n').filter((s) => s.trim()).length
    }
  } catch (error) {}

  const 好感表 = (思维 && 思维.favor) || {}
  const 好感键 = Object.keys(好感表).sort((a, b) => 数(好感表[b].talks) - 数(好感表[a].talks))[0] || null

  const 开关 = {
    body: Boolean((读JSON(join(目录, 'body', 'config.json')) || {}).启用 !== false),
    mind: Boolean((读JSON(join(目录, 'mind', 'config.json')) || {}).启用 !== false),
    behavior: Boolean((读JSON(行为配置) || {}).启用 !== false),
    memory: Boolean((读JSON(join(目录, 'memory', 'config.json')) || {}).启用 !== false),
  }

  return {
    at: new Date().toISOString(),
    开关,
    机体: 机体
      ? {
          ok: true,
          精力: 数(机体.energy),
          体力: 数(机体.stamina),
          醒着: 机体.awake !== false,
          睡下: 机体.asleepSince || null,
          天气: (机体.sensors && 机体.sensors.weather) || null,
          更新秒前: (() => {
            const t = Date.parse(String(机体.updatedAt || ''))
            return Number.isFinite(t) ? Math.round((Date.now() - t) / 1000) : null
          })(),
        }
      : { ok: false },
    思维: 思维
      ? {
          ok: true,
          心情: 数(思维.mood),
          好感: 好感键
            ? { 谁: 好感键, 值: 数(好感表[好感键].value), 聊过: 数(好感表[好感键].talks) }
            : null,
          欲望: 思维.desires || {},
          最高: 思维.desireTop || null,
          上次聊天: (思维.memory && 思维.memory.lastTalkAt) || null,
          上次刷站: (思维.memory && 思维.memory.lastFeedAt) || null,
          更新分钟前: 分钟前(思维.updatedAt),
        }
      : { ok: false },
    行为: 行为
      ? {
          ok: true,
          试运行: 配置.试运行 !== false,
          总开关: 配置.总开关 !== false,
          今日聊天: 数(行为.今日聊天),
          今日刷站: 数(行为.今日刷站),
          今日分享: 数(行为.今日分享),
          上次开口: 行为.上次开口 || null,
          未回音: 数((行为.未回音 && 行为.未回音.次数) || 0),
          更新分钟前: 分钟前(行为.上次开口),
        }
      : {
          ok: false,
          试运行: 配置.试运行 !== false,
          总开关: 配置.总开关 !== false,
        },
    配置: {
      冲动阈值: 数(配置.主动聊天 && 配置.主动聊天.冲动阈值, 0.55),
      安静时段: Array.isArray(配置.安静时段) ? 配置.安静时段 : [1, 8],
    },
    待消费反馈: 反馈,
  }
}

// ---------- 改行为配置 ----------

/**
 * 合并一层 patch 进 behavior-config.json（只认白名单字段）。
 * @returns { ok, 配置, 说 }
 */
export function 改配置(patch) {
  const 原 = 读JSON(行为配置) || {}
  const 配置 = JSON.parse(JSON.stringify(原))

  if (patch && typeof patch === 'object') {
    if (typeof patch.总开关 === 'boolean') 配置.总开关 = patch.总开关
    if (typeof patch.试运行 === 'boolean') 配置.试运行 = patch.试运行
    if (Array.isArray(patch.安静时段) && patch.安静时段.length === 2) {
      配置.安静时段 = patch.安静时段.map((x) => {
        const n = 数(x, 0)
        return Math.min(23, Math.max(0, Math.round(n)))
      })
    }
    const 聊天补 = patch.主动聊天
    if (聊天补 && typeof 聊天补 === 'object') {
      配置.主动聊天 = { ...(配置.主动聊天 || {}) }
      if (typeof 聊天补.开关 === 'boolean') 配置.主动聊天.开关 = 聊天补.开关
      if (Number.isFinite(Number(聊天补.冲动阈值))) {
        配置.主动聊天.冲动阈值 = Math.min(1, Math.max(0, Number(聊天补.冲动阈值)))
      }
    }
  }

  if (!写JSON(行为配置, 配置)) return { ok: false, 说: '配置写不进去' }
  return { ok: true, 配置, 说: '改好了（行为插件最多 60 秒内读到新配置）' }
}

// ---------- 页面 ----------

function 页面HTML() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>三插件 · 统筹面板</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 20px; background: #0f1115; color: #e6e6e6;
         font: 14px/1.6 "Segoe UI", "Microsoft YaHei", sans-serif; }
  h1 { font-size: 18px; margin: 0 0 16px; color: #9ad; letter-spacing: 2px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; }
  .card { background: #171a21; border: 1px solid #262b36; border-radius: 12px; padding: 14px 16px; }
  .card h2 { font-size: 14px; margin: 0 0 10px; color: #8fb; }
  .row { display: flex; justify-content: space-between; padding: 3px 0; color: #b9c0cc; }
  .row b { color: #fff; font-weight: 600; }
  .bar { height: 8px; background: #262b36; border-radius: 4px; overflow: hidden; margin: 3px 0 7px; }
  .bar i { display: block; height: 100%; background: linear-gradient(90deg, #4a8, #8fb); border-radius: 4px; }
  .bar.sleep i { background: linear-gradient(90deg, #57a, #a7f); }
  .muted { color: #667; font-size: 12px; }
  .controls { margin-top: 16px; background: #171a21; border: 1px solid #262b36; border-radius: 12px; padding: 14px 16px; }
  .controls h2 { font-size: 14px; margin: 0 0 10px; color: #9ad; }
  button { background: #223; color: #cde; border: 1px solid #334; border-radius: 8px;
           padding: 6px 14px; margin: 0 8px 8px 0; cursor: pointer; font-size: 13px; }
  button:hover { background: #2a2f40; }
  .on { border-color: #4a8; color: #8fb; }
  .off { border-color: #a55; color: #d88; }
  #tip { color: #8fb; font-size: 12px; }
</style>
</head>
<body>
<h1>机体 · 思维 · 行为</h1>
<div class="grid">
  <div class="card" id="c-body"><h2>机体</h2><div class="muted">读不到 body/state.json</div></div>
  <div class="card" id="c-mind"><h2>思维</h2><div class="muted">读不到 mind/state.json</div></div>
  <div class="card" id="c-behavior"><h2>行为</h2><div class="muted">读不到 behavior-state.json</div></div>
</div>
<div class="controls">
  <h2>总开关</h2>
  <button id="b-run" onclick="切('试运行', !状态.行为.试运行)">试运行：?</button>
  <button id="b-master" onclick="切('总开关', !状态.行为.总开关)">总开关：?</button>
  <button onclick="调阈值(-0.05)">阈值 -0.05</button>
  <button onclick="调阈值(0.05)">阈值 +0.05</button>
  <span id="tip"></span>
  <div class="row" style="margin-top:8px"><span class="muted">自动刷新 3 秒 · 数据时间</span><b id="at">—</b></div>
</div>
<script>
let 状态 = null
const 条 = (v) => Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 100)

function 渲染(d) {
  状态 = d
  const b = d.机体, m = d.思维, a = d.行为
  document.getElementById('c-body').innerHTML = !b.ok ? '<h2>机体</h2><div class="muted">还没跑起来</div>' :
    '<h2>机体</h2>' +
    ('<div class="row"><span>精力</span><b>' + b.精力.toFixed(2) + '</b></div><div class="bar"><i style="width:' + 条(b.精力) + '%"></i></div>') +
    ('<div class="row"><span>体力</span><b>' + b.体力.toFixed(2) + '</b></div><div class="bar"><i style="width:' + 条(b.体力) + '%"></i></div>') +
    ('<div class="row"><span>状态</span><b>' + (b.醒着 ? '醒着' : '睡着') + '</b></div>') +
    ('<div class="row"><span>天气</span><b>' + (b.天气 ? b.天气.text + ' ' + b.天气.temp + '℃ 湿度 ' + b.天气.humidity + '%' : '未知') + '</b></div>') +
    ('<div class="muted">' + (b.更新秒前 !== null ? b.更新秒前 + ' 秒前更新' : '') + '</div>')

  const 欲 = m.desires || {}
  const 排行 = Object.entries(欲).sort((x, y) => y[1] - x[1])
  document.getElementById('c-mind').innerHTML = !m.ok ? '<h2>思维</h2><div class="muted">还没跑起来</div>' :
    '<h2>思维</h2>' +
    ('<div class="row"><span>心情</span><b>' + m.心情.toFixed(2) + '</b></div><div class="bar"><i style="width:' + 条(m.心情) + '%"></i></div>') +
    (m.好感 ? '<div class="row"><span>好感</span><b>' + m.好感.值.toFixed(2) + '</b></div><div class="bar"><i style="width:' + 条(m.好感.值) + '%"></i></div>' : '') +
    ('<div class="muted">' + (m.好感 ? '聊过 ' + m.好感.聊过 + ' 次' : '还没好感记录') + '</div>') +
    排行.map(function (p) {
      return '<div class="row"><span>' + p[0] + '</span><b>' + Number(p[1]).toFixed(2) + '</b></div>' +
             '<div class="bar sleep"><i style="width:' + Math.round(Number(p[1]) * 100) + '%"></i></div>'
    }).join('')

  document.getElementById('c-behavior').innerHTML = !a.ok ? '<h2>行为</h2><div class="muted">还没跑起来（或目标会话一直忙）</div>' :
    '<h2>行为</h2>' +
    ('<div class="row"><span>今日 聊天 / 刷站</span><b>' + a.今日聊天 + ' / ' + a.今日刷站 + '</b></div>') +
    ('<div class="row"><span>上次开口</span><b>' + (a.上次开口 ? a.上次开口.slice(11, 16) : '没有') + '</b></div>') +
    ('<div class="row"><span>未回音</span><b>' + a.未回音 + ' 次</b></div>') +
    ('<div class="row"><span>待消费反馈</span><b>' + d.待消费反馈 + ' 条</b></div>')

  document.getElementById('b-run').className = 状态.行为.试运行 ? 'on' : 'off'
  document.getElementById('b-run').textContent = '试运行：' + (状态.行为.试运行 ? '开' : '关')
  document.getElementById('b-master').className = 状态.行为.总开关 ? 'on' : 'off'
  document.getElementById('b-master').textContent = '总开关：' + (状态.行为.总开关 ? '开' : '关')
  document.getElementById('at').textContent = d.at.slice(11, 19)
  状态.阈值 = d.配置.冲动阈值
}

async function 刷新() {
  try {
    const r = await fetch('/dsh-core/data', { cache: 'no-store' })
    渲染(await r.json())
  } catch (e) { document.getElementById('at').textContent = '连接断了' }
}
setInterval(刷新, 3000)
刷新()

async function 切(键, 值) {
  const patch = {}
  patch[键] = 值
  await 提交(patch)
}
async function 调阈值(差) {
  const 新 = Math.round((((状态 && 状态.阈值) || 0.55) + 差) * 100) / 100
  await 提交({ 主动聊天: { 冲动阈值: 新 } })
}
async function 提交(patch) {
  try {
    const r = await fetch('/dsh-core/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const j = await r.json()
    document.getElementById('tip').textContent = j.说 || ''
    刷新()
  } catch (e) { document.getElementById('tip').textContent = '提交失败' }
}
</script>
</body>
</html>`
}

// ---------- 路由 ----------

function 回JSON(res, 码, 对象) {
  try {
    res.writeHead(码, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(对象))
  } catch (error) {}
}

function 回HTML(res) {
  try {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(页面HTML())
  } catch (error) {}
}

/** 把服务对象找出来（ctx.get('webServer') 或 ctx.webServer）。 */
function 找服务(ctx) {
  let 服务
  try {
    服务 = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
  } catch (error) {
    服务 = undefined
  }
  if (服务 === undefined) {
    try {
      服务 = ctx.webServer
    } catch (error) {
      服务 = undefined
    }
  }
  return 服务
}

export function apply(ctx) {
  const 说 = (文本) => {
    try {
      ctx.logger.info(`core: ${文本}`)
    } catch (error) {}
  }
  const 骂 = (文本) => {
    try {
      ctx.logger.warn(`core: ${文本}`)
    } catch (error) {}
  }

  const 服务 = 找服务(ctx)
  if (!服务 || typeof 服务.register !== 'function') {
    骂('拿不到 webServer，统筹面板没挂；三插件照常跑，只是没有页面')
    return
  }

  try {
    ctx.effect(
      () =>
        服务.register({
          kind: 'exact',
          path: 路由前缀,
          handler: (req, res) => 回页面(req, res),
        }),
      'dsh-core: 面板页',
    )
    ctx.effect(
      () =>
        服务.register({
          kind: 'exact',
          path: `${路由前缀}/`,
          handler: (req, res) => 回页面(req, res),
        }),
      'dsh-core: 面板页（带斜杠）',
    )
    ctx.effect(
      () =>
        服务.register({
          kind: 'exact',
          path: `${路由前缀}/data`,
          handler: (req, res) => 回JSON(res, 200, 快照()),
        }),
      'dsh-core: 面板数据',
    )
    ctx.effect(
      () =>
        服务.register({
          kind: 'exact',
          path: `${路由前缀}/config`,
          handler: async (req, res) => {
            try {
              const 块 = []
              for await (const 片 of req) 块.push(片)
              const 原文 = Buffer.concat(块).toString('utf8')
              const patch = 原文 ? JSON.parse(原文) : {}
              const 结果 = 改配置(patch)
              回JSON(res, 结果.ok ? 200 : 500, 结果)
            } catch (error) {
              回JSON(res, 400, { ok: false, 说: `请求解析失败：${String((error && error.message) || error)}` })
            }
          },
        }),
      'dsh-core: 改配置',
    )
    ctx.effect(
      () =>
        服务.register({
          kind: 'exact',
          path: `${路由前缀}/switch`,
          handler: async (req, res) => {
            try {
              const 块 = []
              for await (const 片 of req) 块.push(片)
              const d = JSON.parse(Buffer.concat(块).toString('utf8') || '{}')
              const 插件 = String(d.插件 || '')
              const 启用 = d.启用 !== false
              const 文件们 = {
                body: join(目录, 'body', 'config.json'),
                mind: join(目录, 'mind', 'config.json'),
                behavior: join(目录, 'behavior-config.js'),
                memory: join(目录, 'memory', 'config.json'),
              }
              const 目标 = 文件们[插件]
              if (!目标) throw new Error('不认识的插件：' + 插件)
              let 原 = {}
              try {
                原 = JSON.parse(readFileSync(目标, 'utf8'))
              } catch (error) {
                原 = {}
              }
              原.启用 = 启用
              writeFileSync(目标, JSON.stringify(原, null, 2), 'utf8')
              回JSON(res, 200, { ok: true, 插件, 启用 })
            } catch (error) {
              回JSON(res, 400, { ok: false, 说: String((error && error.message) || error) })
            }
          },
        }),
      'dsh-core: 快捷开关',
    )
    说(`统筹面板已就绪：GET ${路由前缀}（页面）｜${路由前缀}/data（数据）｜POST ${路由前缀}/config（改开关）｜POST ${路由前缀}/switch（启停）`)
  } catch (error) {
    骂(`面板路由挂不上：${String((error && error.message) || error)}`)
  }

  function 回页面(req, res) {
    try {
      const url = new URL(String((req && req.url) || '/'), 'http://127.0.0.1')
      // /dsh-core 直接给页面；别的子路径给数据
      if (url.pathname === 路由前缀 || url.pathname === `${路由前缀}/`) 回HTML(res)
      else 回JSON(res, 404, { ok: false, 说: '只有 /dsh-core 和 /dsh-core/data' })
    } catch (error) {
      回HTML(res)
    }
  }
}

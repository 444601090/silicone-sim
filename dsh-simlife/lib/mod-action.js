/**
 * mod-action.js —— 行为模块（从 dsh-behavior 精简搬家）
 * ============================================================================
 * 只保留「内置行为」：吃饭 / 睡觉 / 发呆（有持续时间、到点自动结束）。
 * 不带：主动聊天、逛 QQ、刷 B 站、分享、反省那些外部行为。
 *
 * 数据：
 *   读  <scope>/mind/state.json  的 desires（思维算好的欲望）
 *   写  <scope>/body/body-patch.json（血糖 +1.5 / 睡觉 true —— 机体消费）
 *   存  <scope>/action/state.json（当前活动、上次吃饭/睡觉）
 *   配  <scope>/action/config.json（自动作息开关）
 * ============================================================================
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'action'

export const inject = ['timer', 'webServer']

const 目录 = process.env.DSH_HOME || join(homedir(), '.dsh')

const 作用域 = (() => {
  try {
    const j = JSON.parse(readFileSync(join(目录, 'scope.json'), 'utf8'))
    return j && j.作用域 && j.作用域 !== '全局' ? String(j.作用域) : '全局'
  } catch (error) {
    return '全局'
  }
})()

const 根目录 = 作用域 === '全局' ? 目录 : join(目录, 'scopes', 作用域)
const 状态文件 = join(根目录, 'action', 'state.json')
const 配置文件 = join(根目录, 'action', 'config.json')
const 思维文件 = join(根目录, 'mind', 'state.json')
const 补丁文件 = join(根目录, 'body', 'body-patch.json')

/** 触发阈值（欲望到多少才动）。 */
const 阈值 = 0.6

function 读文件(p, 默认) {
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'))
    return j && typeof j === 'object' ? j : 默认
  } catch (error) {
    return 默认
  }
}

function 写文件(p, 对象) {
  try {
    mkdirSync(join(p, '..'), { recursive: true })
  } catch (error) {}
  try {
    writeFileSync(p, JSON.stringify(对象, null, 2), 'utf8')
  } catch (error) {}
}

function 读配置() {
  const c = 读文件(配置文件, {})
  return { 自动作息: c.自动作息 !== false }
}

function 写配置(配置) {
  写文件(配置文件, 配置)
}

function 读状态() {
  const s = 读文件(状态文件, {})
  return {
    当前活动: s.当前活动 && typeof s.当前活动 === 'object' ? s.当前活动 : null,
    上次睡觉: typeof s.上次睡觉 === 'string' ? s.上次睡觉 : null,
    上次吃饭: typeof s.上次吃饭 === 'string' ? s.上次吃饭 : null,
  }
}

/** 写 body 补丁（机体消费后会把文件清空）。 */
function 写补丁(键值) {
  const 原 = 读文件(补丁文件, {})
  const 新 = { ...原, ...键值 }
  try {
    mkdirSync(join(补丁文件, '..'), { recursive: true })
  } catch (error) {}
  try {
    writeFileSync(补丁文件, JSON.stringify(新), 'utf8')
  } catch (error) {}
}

/** 读思维算好的欲望（没有就 null）。 */
function 读欲望() {
  const m = 读文件(思维文件, null)
  if (!m || !m.desires) return null
  return m.desires
}

export function apply(ctx) {
  const 体 = {
    提示: (s) => {
      try {
        ctx.get('settings')?.toast?.(s)
      } catch (error) {}
    },
  }

  const 走一步 = () => {
    const 配置 = 读配置()
    if (!配置.自动作息) return

    const 状态 = 读状态()

    // 正在做的事没到时间 → 不动
    if (状态.当前活动) {
      const 到 = 状态.当前活动.到 ? Date.parse(状态.当前活动.到) : null
      if (!到 || 到 > Date.now()) return
      状态.当前活动 = null
    }

    const 欲 = 读欲望()
    if (!欲) return

    const 名 = [
      ['eat', 欲.eat],
      ['sleep', 欲.sleep],
      ['idle', 欲.idle],
    ]
      .filter(([, v]) => Number(v) >= 阈值)
      .sort((a, b) => Number(b[1]) - Number(a[1]))[0]
    if (!名) return

    const [键, 强] = 名
    const 现在 = Date.now()
    const 时刻 = new Date(现在).toISOString()

    if (键 === 'eat') {
      写补丁({ 血糖: 1.5 })
      状态.当前活动 = { 名: '吃饭', 开始: 时刻, 到: new Date(现在 + 20 * 60000).toISOString() }
      状态.上次吃饭 = 时刻
      写文件(状态文件, 状态)
      体.提示(`自动作息：去吃饭了（欲望 ${Number(强).toFixed(2)}）`)
      return
    }
    if (键 === 'sleep') {
      写补丁({ 睡觉: true })
      状态.当前活动 = { 名: '睡觉', 开始: 时刻, 到: null }
      状态.上次睡觉 = 时刻
      写文件(状态文件, 状态)
      体.提示(`自动作作息：躺下睡了（欲望 ${Number(强).toFixed(2)}）`)
      return
    }
    // idle：发呆（不记上次）
    状态.当前活动 = { 名: '发呆', 开始: 时刻, 到: new Date(现在 + 10 * 60000).toISOString() }
    写文件(状态文件, 状态)
    体.提示(`自动作息：发呆去了（欲望 ${Number(强).toFixed(2)}）`)
  }

  ctx.effect(
    () => {
      const 表 = ctx.interval(() => {
        try {
          走一步()
        } catch (error) {}
      }, 60 * 1000)
      return () => {
        try {
          表()
        } catch (error) {}
      }
    },
    'dsh-simlife: 行为中枢（吃饭/睡觉/发呆）',
  )

  // ---- 接口（UI 用） ----
  try {
    const 服务 = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
    if (服务 && typeof 服务.register === 'function') {
      const 注册 = (路径, 处理) =>
        ctx.effect(() => 服务.register({ kind: 'exact', path: 路径, handler: 处理 }), `dsh-simlife: ${路径}`)

      注册('/dsh-action/data', async (req, res) => {
        try {
          const 状态 = 读状态()
          const 配置 = 读配置()
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify({ 当前活动: 状态.当前活动, 上次睡觉: 状态.上次睡觉, 上次吃饭: 状态.上次吃饭, 自动作息: 配置.自动作息 }))
        } catch (error) {}
      })

      注册('/dsh-action/config', async (req, res) => {
        try {
          const 块 = []
          for await (const 片 of req) 块.push(片)
          const d = JSON.parse(Buffer.concat(块).toString('utf8') || '{}')
          const 新 = 读配置()
          if (typeof d.自动作息 === 'boolean') 新.自动作息 = d.自动作息
          写配置(新)
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, 自动作息: 新.自动作息 }))
        } catch (error) {
          try {
            res.writeHead(400, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ ok: false }))
          } catch (error2) {}
        }
      })
    }
  } catch (error) {}

  体.提示('行为中枢已加载（吃饭/睡觉/发呆）')
}

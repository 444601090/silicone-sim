// DSH「更好的视频浏览」（dsh-better-video）· 宿主半边
//
// 行为中枢说「去刷视频」时，这里接活：轮询意图 → 挑一个启用的账号 → 按平台搜一轮
// → 挑几条候选写结果。支持多平台多账号，账号在设置页加。
//
// 平台：bilibili（走本地 bili-feed 搜索）、youtube/douyin（先占位，没接搜索）
// ⚠ 只碰自己的文件：%DSH_HOME%/better-video/（accounts.json / config.json）+ 中枢的 intent。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

export const name = 'better-video'

export const inject = ['timer', 'webServer']

const 目录 = process.env.DSH_HOME || join(homedir(), '.dsh')
const 数据目录 = join(目录, 'better-video')
const 账号文件 = join(数据目录, 'accounts.json')
const 配置文件 = join(数据目录, 'config.json')
const 意图文件 = join(目录, 'behavior', 'intent.json')
const 结果文件 = join(目录, 'behavior', 'actions', 'video-result.json')

const 轮询毫秒 = 30 * 1000

const 平台们 = [
  { id: 'bilibili', 名: 'B站', 能搜: true },
  { id: 'youtube', 名: 'YouTube', 能搜: false },
  { id: 'douyin', 名: '抖音', 能搜: false },
]

const 默认配置 = {
  /** bili-feed 脚本路径（B站搜索用）。 */
  脚本: 'D:\\DeepSeekCode\\独立人格\\缓存\\bili-feed.mjs',
  /** 搜索关键词（逗号分隔）。 */
  关键词: 'AI agent 记忆,AI agent 插件,游戏 数据拆解',
  /** 每次挑几条候选。 */
  条数: 3,
  /** 独立定时：不装行为中枢也能自己刷。 */
  自动刷: false,
  /** 响应行为中枢：中枢写 intent 时接活（关掉就只靠独立定时）。 */
  响应中枢: true,
  /** 多久刷一次（分钟）。 */
  间隔分钟: 180,
  /** 允许刷的时段（小时，比如 '9-23'；空 = 不限制）。 */
  时段: '9-23',
  /** 上次自动刷的时间（内部用）。 */
  上次自动刷: null,
}

function 读配置() {
  try {
    return { ...默认配置, ...JSON.parse(readFileSync(配置文件, 'utf8')) }
  } catch (error) {
    return { ...默认配置 }
  }
}

/** 读账号表（不存在就空表）。 */
export function 读账号() {
  try {
    const j = JSON.parse(readFileSync(账号文件, 'utf8'))
    return Array.isArray(j.账号们) ? j.账号们 : []
  } catch (error) {
    return []
  }
}

/** 洗一条账号（平台合法、名称非空）。 */
export function 洗账号(原始) {
  const 混 = 原始 && typeof 原始 === 'object' ? 原始 : {}
  const 平台 = 平台们.some((p) => p.id === 混.平台) ? 混.平台 : 'bilibili'
  const 名称 = String(混.名称 || '').trim().slice(0, 40) || '未命名账号'
  return {
    id: typeof 混.id === 'string' && 混.id ? 混.id : 'ac-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 5),
    平台,
    名称,
    凭证: String(混.凭证 || '').slice(0, 4000),
    启用: 混.启用 !== false,
    上次使用: typeof 混.上次使用 === 'string' ? 混.上次使用 : null,
  }
}

function 写账号(账号们) {
  mkdirSync(数据目录, { recursive: true })
  writeFileSync(账号文件, JSON.stringify({ 账号们 }, null, 2), 'utf8')
}

/** 挑一个账号：启用的里面，上次使用最久的优先（轮换）。 */
export function 挑账号(账号们) {
  const 可用 = (账号们 || []).filter((a) => a && a.启用 !== false)
  if (可用.length === 0) return null
  可用.sort((a, b) => {
    const ta = a.上次使用 ? Date.parse(a.上次使用) : 0
    const tb = b.上次使用 ? Date.parse(b.上次使用) : 0
    return ta - tb
  })
  return 可用[0]
}

/** 跑 bili-feed（node 脚本）。 */
function 跑脚本(脚本, 参数们) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [脚本, ...参数们], { timeout: 90 * 1000, windowsHide: true }, (error, stdout) => {
      if (error) return reject(error)
      resolve(String(stdout || ''))
    })
  })
}

/** 从 bili-feed 的 JSON 里挑候选。 */
export function 挑候选(数据, 条数 = 3) {
  const 列表 = Array.isArray(数据 && 数据.list) ? 数据.list : []
  const 视频们 = 列表
    .filter((v) => v && v.bvid && v.title)
    .map((v) => ({
      bvid: String(v.bvid),
      title: String(v.title),
      author: String(v.author || ''),
      play: Number(v.play) || 0,
      duration: String(v.duration || ''),
      desc: String(v.desc || v.description || '').slice(0, 120),
    }))
  视频们.sort((a, b) => b.play - a.play)
  return 视频们.slice(0, 条数)
}

async function 刷一轮(体) {
  const 配置 = 读配置()
  const 账号 = 挑账号(读账号())
  const 账号名 = 账号 ? `${账号.名称}（${(平台们.find((p) => p.id === 账号.平台) || {}).名 || 账号.平台}）` : '（没配账号，用匿名）'
  const 平台 = 账号 ? 账号.平台 : 'bilibili'
  const 关键词们 = String(配置.关键词 || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (!existsSync(配置.脚本)) {
    体.警告(`bili-feed 脚本不存在：${配置.脚本}`)
    return false
  }

  if (平台 === 'bilibili') {
    for (const 关键词 of 关键词们) {
      try {
        体.提示(`刷B站（${账号名}）：${关键词}`)
        const 输出 = await 跑脚本(配置.脚本, [关键词, 'totalrank', '8'])
        const 候选 = 挑候选(JSON.parse(输出), Number(配置.条数) || 3)
        if (候选.length === 0) continue
        mkdirSync(dirname(结果文件), { recursive: true })
        writeFileSync(
          结果文件,
          JSON.stringify({ 平台, 账号: 账号 ? 账号.id : null, 账号名, 关键词, at: new Date().toISOString(), 候选 }, null, 2),
          'utf8',
        )
        if (账号) {
          const 账号们 = 读账号().map((a) => (a.id === 账号.id ? { ...a, 上次使用: new Date().toISOString() } : a))
          写账号(账号们)
        }
        体.提示(`刷完了（${账号名}）：${候选.length} 条候选（${候选[0].title}）`)
        return true
      } catch (error) {
        体.警告(`刷 ${关键词} 失败：${String((error && error.message) || error)}`)
      }
    }
    return false
  }

  // 其他平台先占位：记一条，等接搜索
  mkdirSync(dirname(结果文件), { recursive: true })
  writeFileSync(
    结果文件,
    JSON.stringify({ 平台, 账号名, at: new Date().toISOString(), 候选: [], 提示: `${平台} 的搜索还没接，先记一笔` }, null, 2),
    'utf8',
  )
  体.提示(`${账号名}：平台搜索还没接`)
  return false
}

async function 看意图(体) {
  let 意图
  try {
    if (!existsSync(意图文件)) return
    意图 = JSON.parse(readFileSync(意图文件, 'utf8'))
  } catch (error) {
    return
  }
  if (!意图 || (意图.行为 !== 'video' && 意图.行为 !== 'bili')) return
  if (读配置().响应中枢 === false) {
    体.提示('中枢叫我刷，但「响应中枢」关着，跳过')
    try {
      writeFileSync(意图文件, '{}', 'utf8')
    } catch (error) {}
    return
  }
  try {
    writeFileSync(意图文件, '{}', 'utf8')
  } catch (error) {}
  await 刷一轮(体)
}

// ---------- HTTP ----------

function 回JSON(res, 码, 对象) {
  try {
    res.writeHead(码, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(对象))
  } catch (error) {}
}

async function 读请求体(req) {
  const 块 = []
  for await (const 片 of req) 块.push(片)
  const 原文 = Buffer.concat(块).toString('utf8')
  return 原文 ? JSON.parse(原文) : {}
}

function 挂接口(ctx, 体) {
  let 服务
  try {
    服务 = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
  } catch (error) {
    服务 = undefined
  }
  if (!服务 || typeof 服务.register !== 'function') return
  const 注册 = (路径, 处理) =>
    ctx.effect(() => 服务.register({ kind: 'exact', path: 路径, handler: 处理 }), `dsh-better-video: ${路径}`)

  注册('/dsh-better-video/data', (req, res) => {
    let 结果 = null
    try {
      结果 = JSON.parse(readFileSync(结果文件, 'utf8'))
    } catch (error) {}
    回JSON(res, 200, { 账号们: 读账号(), 配置: 读配置(), 平台们, 结果 })
  })

  注册('/dsh-better-video/accounts/add', async (req, res) => {
    try {
      const d = await 读请求体(req)
      const 账号 = 洗账号(d)
      if (!账号.名称) throw new Error('名称不能为空')
      const 账号们 = 读账号()
      if (账号们.some((a) => a.id === 账号.id)) throw new Error('id 重复')
      账号们.push(账号)
      写账号(账号们)
      体.提示(`加了账号：${账号.名称}（${账号.平台}）`)
      回JSON(res, 200, { ok: true, 账号 })
    } catch (error) {
      回JSON(res, 400, { ok: false, 说: String((error && error.message) || error) })
    }
  })

  注册('/dsh-better-video/accounts/update', async (req, res) => {
    try {
      const d = await 读请求体(req)
      const id = String(d.id || '')
      if (!id) throw new Error('缺 id')
      const 账号们 = 读账号().map((a) => (a.id === id ? 洗账号({ ...a, ...d, id }) : a))
      写账号(账号们)
      回JSON(res, 200, { ok: true })
    } catch (error) {
      回JSON(res, 400, { ok: false, 说: String((error && error.message) || error) })
    }
  })

  注册('/dsh-better-video/config', async (req, res) => {
    try {
      const d = await 读请求体(req)
      const 配置 = { ...读配置(), ...d }
      配置.自动刷 = 配置.自动刷 === true
      配置.间隔分钟 = Math.max(10, Number(配置.间隔分钟) || 180)
      配置.时段 = String(配置.时段 || '')
      mkdirSync(数据目录, { recursive: true })
      writeFileSync(配置文件, JSON.stringify(配置, null, 2), 'utf8')
      回JSON(res, 200, { ok: true, 配置 })
    } catch (error) {
      回JSON(res, 400, { ok: false, 说: String((error && error.message) || error) })
    }
  })

  注册('/dsh-better-video/accounts/remove', async (req, res) => {
    try {
      const d = await 读请求体(req)
      const id = String(d.id || '')
      const 账号们 = 读账号().filter((a) => a.id !== id)
      写账号(账号们)
      回JSON(res, 200, { ok: true, 账号们 })
    } catch (error) {
      回JSON(res, 400, { ok: false, 说: String((error && error.message) || error) })
    }
  })
}

export function apply(ctx) {
  const 提示 = (t) => {
    try {
      ctx.logger.info(`better-video: ${t}`)
    } catch (error) {}
  }
  const 警告 = (t) => {
    try {
      ctx.logger.warn(`better-video: ${t}`)
    } catch (error) {}
  }
  const 体 = { 提示, 警告 }

  /** 独立定时：到点、在时段内、距上次够久 → 自己刷一轮。 */
  function 自动刷检查() {
    const 配置 = 读配置()
    if (!配置.自动刷) return
    const 间隔 = Math.max(10, Number(配置.间隔分钟) || 180)
    const 上次 = 配置.上次自动刷 ? Date.parse(配置.上次自动刷) : 0
    const 现在 = Date.now()
    if (Number.isFinite(上次) && 现在 - 上次 < 间隔 * 60 * 1000) return
    const 时段 = String(配置.时段 || '').trim()
    if (时段) {
      const [起, 止] = 时段.split('-').map((x) => Number(x))
      const 时 = new Date().getHours()
      const 在 = Number.isFinite(起) && Number.isFinite(止) ? (起 <= 止 ? 时 >= 起 && 时 <= 止 : 时 >= 起 || 时 <= 止) : true
      if (!在) return
    }
    体.提示('到点了，独立定时刷一轮')
    const 新配置 = { ...配置, 上次自动刷: new Date().toISOString() }
    try {
      writeFileSync(配置文件, JSON.stringify(新配置, null, 2), 'utf8')
    } catch (error) {}
    刷一轮(体).catch(() => {})
  }

  let 停表 = null
  ctx.effect(
    () => {
      停表 = ctx.interval(() => {
        看意图(体).catch(() => {})
        自动刷检查()
      }, 轮询毫秒)
      return () => {
        try {
          if (typeof 停表 === 'function') 停表()
          else if (停表 && typeof 停表.dispose === 'function') 停表.dispose()
        } catch (error) {}
        停表 = null
      }
    },
    'dsh-better-video: 轮询意图',
  )

  挂接口(ctx, 体)
  提示(`已加载｜账号 ${读账号().length} 个｜脚本 ${读配置().脚本}｜轮询 ${轮询毫秒 / 1000} 秒`)
}

// DSH「记忆」（dsh-memory）· 宿主半边
//
// 记忆是身体之外的另一个输出端：行为/聊天把事写进来，需要时（联想）再读出来。
// 它自己负责四件事：存储、检索（联想）、遗忘（衰减）、巩固（被反复想起的记得更牢）。
//
// ⚠ 只碰自己的文件：%DSH_HOME%/memory/state.json（+ inbox.jsonl 收件箱）。
// ⚠ 别的插件要记东西 → 往 inbox.jsonl 追加一行；要查 → GET/POST /dsh-memory/* 或直接读 state.json。
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

/** 插件对外名字（也是日志前缀）。 */
export const name = 'memory'

/** 需要宿主的定时器（衰减/收件箱）和 webServer（设置页接口）。 */
export const inject = ['timer', 'webServer']

const 目录 = process.env.DSH_HOME || join(homedir(), '.dsh')
const 记忆目录 = join(目录, 'memory')
const 状态文件 = join(记忆目录, 'state.json')
const 收件箱 = join(记忆目录, 'inbox.jsonl')
const 配置文件 = join(记忆目录, 'config.json')

const 默认配置 = { 启用: true }

function 读配置() {
  try {
    return { ...默认配置, ...JSON.parse(readFileSync(配置文件, 'utf8')) }
  } catch (error) {
    return { ...默认配置 }
  }
}

const tick毫秒 = 60 * 1000
const 调试间隔tick = 20
/** 普通记忆每跳衰减的量（一天约掉 0.57）；被反复想起的会慢很多。 */
const 衰减基数 = 0.0004
/** 条目上限（超了淘汰最弱的）。 */
const 条数上限 = 400

// ---------- 小工具 ----------

function 夹01(值, 兜 = 0) {
  const n = Number(值)
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 兜
}

function 时间串(值) {
  if (值 === null || 值 === undefined || 值 === '') return null
  const t = typeof 值 === 'number' ? 值 : Date.parse(String(值))
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

function 原子写(路径, 文本) {
  mkdirSync(dirname(路径), { recursive: true })
  const 临时 = `${路径}.tmp`
  try {
    writeFileSync(临时, 文本, 'utf8')
    renameSync(临时, 路径)
  } catch (error) {
    try {
      writeFileSync(路径, 文本, 'utf8')
    } catch (error2) {
      throw error2
    }
  }
}

/** 简单 id。 */
function 新id() {
  return 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
}

// ---------- 类型权重（重要的忘得慢、检索时排前）----------

const 类型权重 = {
  promise: 1.6, // 承诺
  preference: 1.4, // 偏好
  semantic: 1.2, // 事实
  episodic: 1.0, // 情景（发生过的事）
}

// ---------- 纯函数：存储结构 ----------

const 默认状态 = { schema: 1, updatedAt: null, entries: [] }

/** 洗一条记忆条目。 */
function 洗条目(原始) {
  const 混 = 原始 && typeof 原始 === 'object' ? 原始 : {}
  const kind = ['promise', 'preference', 'semantic', 'episodic'].includes(混.kind) ? 混.kind : 'episodic'
  return {
    id: typeof 混.id === 'string' && 混.id ? 混.id : 新id(),
    at: 时间串(混.at) || new Date().toISOString(),
    kind,
    text: String(混.text || '').slice(0, 500),
    tags: Array.isArray(混.tags) ? 混.tags.map((t) => String(t).slice(0, 20)).slice(0, 8) : [],
    mood: Math.max(-1, Math.min(1, Number(混.mood) || 0)),
    strength: 夹01(混.strength, 1),
    accessCount: Math.max(0, Math.round(Number(混.accessCount) || 0)),
    lastAccess: 时间串(混.lastAccess),
    links: 混.links && typeof 混.links === 'object' ? 混.links : {},
  }
}

function 洗状态(原始) {
  const 混 = 原始 && typeof 原始 === 'object' ? 原始 : {}
  const 条目们 = Array.isArray(混.entries) ? 混.entries.map(洗条目).filter((e) => e.text) : []
  return { schema: 1, updatedAt: 时间串(混.updatedAt), entries: 条目们.slice(-条数上限) }
}

/** 提取关键词：中文双字组 + 英文词。 */
export function 关键词(文本) {
  const 低 = String(文本 || '').toLowerCase()
  const 词们 = new Set()
  const 汉字段 = 低.match(/[\u4e00-\u9fa5]{2,}/g) || []
  for (const 段 of 汉字段) {
    for (let i = 0; i < 段.length - 1; i += 1) 词们.add(段.slice(i, i + 2))
  }
  for (const w of 低.match(/[a-z0-9]{2,}/g) || []) 词们.add(w)
  return [...词们]
}

/** 给一条新记忆和现有条目建「联想连接」（关键词重叠越多连得越紧）。 */
export function 建连接(条目, 现有) {
  const k1 = new Set(关键词(`${条目.text} ${(条目.tags || []).join(' ')}`))
  const links = {}
  for (const e of 现有) {
    if (e.id === 条目.id) continue
    const k2 = 关键词(`${e.text} ${(e.tags || []).join(' ')}`)
    if (k2.length === 0) continue
    let 共同 = 0
    for (const w of k2) if (k1.has(w)) 共同 += 1
    const 重叠 = 共同 / Math.max(1, Math.min(k1.size, k2.length))
    if (重叠 >= 0.3) links[e.id] = Math.min(1, Math.round(重叠 * 100) / 100)
  }
  return links
}

/** 当前情绪的倾向（-0.5 ~ 0.8）：正 = 好心情，负 = 坏心情。用来做「情绪一致性记忆」。 */
function 当前倾向() {
  try {
    const 体 = JSON.parse(readFileSync(join(目录, 'body', 'state.json'), 'utf8'))
    const h = 体.hormones || {}
    const 位置 = (名, 值, r) => {
      const n = Number(值)
      if (!Number.isFinite(n)) return 0.5
      return Math.min(1, Math.max(0, (n - r.下限) / (r.上限 - r.下限)))
    }
    const 参考 = {
      多巴胺: { 下限: 10, 上限: 90 },
      血清素: { 下限: 101, 上限: 283 },
      皮质醇: { 下限: 138, 上限: 690 },
    }
    return 位置('多巴胺', h.多巴胺, 参考.多巴胺) * 0.4 + 位置('血清素', h.血清素, 参考.血清素) * 0.4 - 位置('皮质醇', h.皮质醇, 参考.皮质醇) * 0.5
  } catch (error) {
    return 0
  }
}

/** 检索（联想）：关键词命中 × 鲜活度 × 类型权重 × 被想起次数 × 情绪一致性。 */
export function 检索(条目们, 查询, 条数 = 10, 选项 = {}) {
  const 原词 = String(查询 || '')
    .toLowerCase()
    .split(/[\s,，。;；、/]+/)
    .filter((w) => w.length >= 1)
  if (原词.length === 0) return []
  const 倾向 = Number.isFinite(Number(选项.倾向)) ? Number(选项.倾向) : 当前倾向()
  const 倾向强 = Math.min(1, Math.abs(倾向))
  const 结果 = []
  for (const e of 条目们) {
    const 文 = `${e.text} ${(e.tags || []).join(' ')}`.toLowerCase()
    let 命中 = 0
    for (const w of 原词) if (文.includes(w)) 命中++
    if (命中 === 0) continue
    const 匹配度 = 命中 / 原词.length
    // 情绪一致性：心情好时正面记忆更跳出来，心情差时负面记忆更跳出来
    const 一致 = (e.mood || 0) !== 0 && Math.sign(e.mood || 0) === Math.sign(倾向)
    const 情绪因子 = 一致 ? 1 + 0.3 * 倾向强 : 1 - 0.2 * 倾向强
    const 得分 =
      匹配度 *
      (e.strength || 0) *
      (类型权重[e.kind] || 1) *
      (1 + 0.1 * (e.accessCount || 0)) *
      (1 + 0.2 * Math.abs(e.mood || 0)) *
      情绪因子
    结果.push({ ...e, 匹配度, 得分 })
  }
  // 联想扩散：命中条目连着的条目也带出来（权重衰减）
  const 命中集 = new Set(结果.map((x) => x.id))
  const 扩展 = []
  for (const r of 结果) {
    for (const [id, w] of Object.entries(r.links || {})) {
      const 权 = Number(w) || 0
      if (权 < 0.4 || 命中集.has(id)) continue
      const 源 = 条目们.find((x) => x.id === id)
      if (!源) continue
      命中集.add(id)
      扩展.push({ ...源, 匹配度: 0, 得分: r.得分 * 0.5 * 权, 联想自: r.id })
    }
  }
  const 全部 = [...结果, ...扩展]
  全部.sort((a, b) => b.得分 - a.得分)
  return 全部.slice(0, 条数)
}

/**
 * 遗忘：每跳衰减一点。被反复想起的（accessCount 高）衰减慢；承诺（promise）几乎不忘。
 */
export function 遗忘(条目们, 系数 = 衰减基数) {
  const 出 = []
  for (const e of 条目们) {
    if (e.kind === 'promise') {
      出.push(e)
      continue
    }
    const 慢 = 1 + 0.5 * Math.min(6, e.accessCount || 0)
    const strength = Math.max(0, (e.strength || 0) - 系数 / 慢)
    if (strength > 0.01) 出.push({ ...e, strength })
  }
  return 出
}

/** 巩固：被想起/被再提一次 → 变活、记住次数 +1。 */
export function 巩固(条目, 次数 = 1) {
  return {
    ...条目,
    accessCount: (条目.accessCount || 0) + 次数,
    strength: Math.min(1.5, (条目.strength || 0) + 0.05 * 次数),
    lastAccess: new Date().toISOString(),
  }
}

/** 加一条记忆（返回洗好的条目）。 */
export function 造条目(输入 = {}) {
  return 洗条目({
    id: 输入.id,
    at: 输入.at || new Date().toISOString(),
    kind: 输入.kind,
    text: 输入.text,
    tags: 输入.tags,
    mood: 输入.mood,
    strength: 输入.strength ?? 1,
    accessCount: 0,
    links: 输入.links,
  })
}

// ---------- 状态读写 ----------

function 读状态() {
  try {
    if (!existsSync(状态文件)) return 洗状态(null)
    return 洗状态(JSON.parse(readFileSync(状态文件, 'utf8')))
  } catch (error) {
    return 洗状态(null)
  }
}

function 写状态(状态, 日志) {
  try {
    原子写(状态文件, JSON.stringify(状态, null, 2))
    return true
  } catch (error) {
    if (日志) 日志.警告(`写记忆失败：${String((error && error.message) || error)}`)
    return false
  }
}

/** 消费收件箱：别的插件往 inbox.jsonl 追加 { text, kind, tags, mood }。 */
export function 消费收件箱(状态, 日志) {
  let 行们 = []
  try {
    if (!existsSync(收件箱)) return 0
    const 原文 = readFileSync(收件箱, 'utf8').trim()
    if (原文 === '') return 0
    行们 = 原文.split('\n').map((s) => s.trim()).filter(Boolean)
  } catch (error) {
    return 0
  }
  let 应用 = 0
  for (const 行 of 行们) {
    try {
      const d = JSON.parse(行)
      const e = 造条目(d)
      if (!e.text) continue
      e.links = 建连接(e, 状态.entries)
      状态.entries.push(e)
      应用 += 1
    } catch (error) {
      // 坏行跳过
    }
  }
  try {
    writeFileSync(收件箱, '', 'utf8')
  } catch (error) {}
  if (状态.entries.length > 条数上限) {
    状态.entries.sort((a, b) => (b.strength || 0) - (a.strength || 0))
    状态.entries = 状态.entries.slice(0, 条数上限)
  }
  if (日志 && 应用 > 0) 日志.提示(`收件箱吃了 ${应用} 条记忆`)
  return 应用
}

// ---------- 设置页接口 ----------

function 回JSON(res, 码, 对象) {
  try {
    res.writeHead(码, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(对象))
  } catch (error) {}
}

function 挂路由(ctx, 体) {
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
  if (!服务 || typeof 服务.register !== 'function') {
    体.警告('拿不到 webServer，记忆接口没挂（其余照常）')
    return
  }
  try {
    ctx.effect(
      () =>
        服务.register({
          kind: 'exact',
          path: '/dsh-memory/data',
          handler: (req, res) => 回JSON(res, 200, { 状态: 读状态(), 类型权重 }),
        }),
      'dsh-memory: 数据',
    )
    ctx.effect(
      () =>
        服务.register({
          kind: 'exact',
          path: '/dsh-memory/query',
          handler: async (req, res) => {
            try {
              const 块 = []
              for await (const 片 of req) 块.push(片)
              const 原文 = Buffer.concat(块).toString('utf8')
              const d = 原文 ? JSON.parse(原文) : {}
              const 状态 = 读状态()
              const 结果 = 检索(状态.entries, d.text || '', Number(d.条数) || 10)
              // 被查到的条目 = 被想起 → 巩固
              if (结果.length > 0) {
                const 命中 = new Set(结果.map((x) => x.id))
                状态.entries = 状态.entries.map((e) => (命中.has(e.id) ? 巩固(e) : e))
                写状态(状态, 体)
              }
              回JSON(res, 200, { ok: true, 结果 })
            } catch (error) {
              回JSON(res, 400, { ok: false, 说: String((error && error.message) || error) })
            }
          },
        }),
      'dsh-memory: 检索',
    )
    ctx.effect(
      () =>
        服务.register({
          kind: 'exact',
          path: '/dsh-memory/add',
          handler: async (req, res) => {
            try {
              const 块 = []
              for await (const 片 of req) 块.push(片)
              const 原文 = Buffer.concat(块).toString('utf8')
              const d = 原文 ? JSON.parse(原文) : {}
              const 状态 = 读状态()
              const e = 造条目(d)
              if (!e.text) return 回JSON(res, 400, { ok: false, 说: 'text 不能为空' })
              e.links = 建连接(e, 状态.entries)
              状态.entries.push(e)
              写状态(状态, 体)
              回JSON(res, 200, { ok: true, 条目: e })
            } catch (error) {
              回JSON(res, 400, { ok: false, 说: String((error && error.message) || error) })
            }
          },
        }),
      'dsh-memory: 加条目',
    )
    体.提示('记忆接口已就绪：GET /dsh-memory/data｜POST /dsh-memory/query｜POST /dsh-memory/add')
  } catch (error) {
    体.警告(`记忆接口挂不上：${String((error && error.message) || error)}`)
  }
}

// ---------- 执行体 ----------

export function apply(ctx) {
  let tick次数 = 0
  let 停表 = null

  const 提示 = (t) => {
    try {
      ctx.logger.info(`memory: ${t}`)
    } catch (error) {}
  }
  const 警告 = (t) => {
    try {
      ctx.logger.warn(`memory: ${t}`)
    } catch (error) {}
  }
  const 调试 = (t) => {
    try {
      if (ctx.logger.debug) ctx.logger.debug(`memory: ${t}`)
      else ctx.logger.info(`memory: ${t}`)
    } catch (error) {}
  }

  const 体 = { 提示, 警告, 调试 }

  /** 一跳：消费收件箱 → 遗忘 → 写盘。 */
  function 跑一跳() {
    if (读配置().启用 === false) return
    tick次数 += 1
    try {
      const 状态 = 读状态()
      const 新 = 消费收件箱(状态, 体)
      状态.entries = 遗忘(状态.entries)
      状态.updatedAt = new Date().toISOString()
      写状态(状态, 体)
      if (tick次数 % 调试间隔tick === 0) {
        const 活 = 状态.entries.filter((e) => e.strength > 0.3).length
        调试(`还活着｜共 ${状态.entries.length} 条记忆（鲜活的 ${活} 条）${新 ? `｜新进 ${新}` : ''}`)
      }
    } catch (error) {
      警告(`tick 出错（已兜住）：${String((error && error.message) || error)}`)
    }
  }

  function 开表() {
    try {
      if (停表 !== null) 收摊()
      if (typeof ctx.interval === 'function') {
        停表 = ctx.interval(() => {
          try {
            跑一跳()
          } catch (error) {}
        }, tick毫秒)
        return
      }
      const 表 = setInterval(() => {
        try {
          跑一跳()
        } catch (error) {}
      }, tick毫秒)
      if (表 && typeof 表.unref === 'function') 表.unref()
      停表 = () => clearInterval(表)
    } catch (error) {
      警告(`定时器没起来：${String((error && error.message) || error)}`)
    }
  }

  function 收摊() {
    const 停 = 停表
    停表 = null
    try {
      if (typeof 停 === 'function') 停()
      else if (停 && typeof 停.dispose === 'function') 停.dispose()
    } catch (error) {}
  }

  ctx.effect(
    () => {
      开表()
      return () => 收摊()
    },
    'dsh-memory: 每 60 秒衰减/收件箱',
  )

  挂路由(ctx, 体)

  try {
    const 状态 = 读状态()
    ctx.logger.info(
      `memory: v0.1.0 已加载｜状态本 ${状态文件}｜共 ${状态.entries.length} 条记忆｜收件箱 ${收件箱}`,
    )
  } catch (error) {}
}

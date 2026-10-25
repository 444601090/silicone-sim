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
export const inject = ['timer', 'webServer', 'systemPrompt', 'agents']

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
const 记忆目录 = join(根目录, 'memory')
const 状态文件 = join(记忆目录, 'state.json')
const 收件箱 = join(记忆目录, 'inbox.jsonl')
/** 思维主动回忆时写进来的条目 id（每行一个 {id}），这里消费并巩固。 */
const 回忆队列 = join(记忆目录, 'recall.jsonl')
const 配置文件 = join(记忆目录, 'config.json')

const 默认配置 = { 启用: true, 公开: false }

function 写配置(配置) {
  try {
    mkdirSync(记忆目录, { recursive: true })
    writeFileSync(配置文件, JSON.stringify(配置, null, 2), 'utf8')
    return true
  } catch (error) {
    return false
  }
}

function 读配置() {
  try {
    return { ...默认配置, ...JSON.parse(readFileSync(配置文件, 'utf8')) }
  } catch (error) {
    return { ...默认配置 }
  }
}

const tick毫秒 = 2 * 1000
const 调试间隔tick = 300
/**
 * 衰减按「对话轮次」算，不按天数（2026-10-25 潜水喵定）：
 * 每聊一轮，全库的权值按曲率乘一次；重要记忆（权值 ≥0.5）的曲率更平。
 * 承诺和钉住的不衰减；淡到阈值的留到「睡下」时清。
 */
const 曲率普通 = 0.97
const 曲率重要 = 0.995
const 重要阈值 = 0.5
const 清理阈值 = 0.02
/** 睡下检查的间隔（跳数，2 秒一跳 → 约 60 秒）。 */
const 睡眠检查每跳 = 30
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
    /** 初始权重：判断链按激素反馈给（开心/累 → 高）；普通 0.1 */
    weight: 夹01(混.weight, 0.1),
    /** 重复体验次数达标 → 永不遗忘（钉住） */
    pinned: 混.pinned === true,
    accessCount: Math.max(0, Math.round(Number(混.accessCount) || 0)),
    lastAccess: 时间串(混.lastAccess),
    lastDecay: 时间串(混.lastDecay),
    links: 混.links && typeof 混.links === 'object' ? 混.links : {},
  }
}

function 洗状态(原始) {
  const 混 = 原始 && typeof 原始 === 'object' ? 原始 : {}
  const 条目们 = Array.isArray(混.entries) ? 混.entries.map(洗条目).filter((e) => e.text) : []
  return {
    schema: 1,
    updatedAt: 时间串(混.updatedAt),
    entries: 条目们.slice(-条数上限),
    /** 上次「换会话」衰减的时间（通道写 rotate.json 触发） */
    lastRotate: typeof 混.lastRotate === 'string' ? 混.lastRotate : null,
    /** 上次「睡觉清理」对应的睡着时间 */
    lastSleepClean: typeof 混.lastSleepClean === 'string' ? 混.lastSleepClean : null,
  }
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
    const 体 = JSON.parse(readFileSync(join(根目录, 'body', 'state.json'), 'utf8'))
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
/**
 * 检索（联想）：像鱼的记忆那样「想起来靠证据」——
 *   把查询和条目都切成中文双字组/英文词，每个词按「越稀有越算数」加权（IDF），
 *   得分 = 命中词的权重和 / 查询词的总权重，再乘鲜活度、类型权重、情绪一致性。
 * 选项：{ 倾向 }（情绪一致性用，不给就自动读机体激素）。
 */
export function 检索(条目们, 查询, 条数 = 10, 选项 = {}) {
  const 词们 = 关键词(查询)
  if (词们.length === 0 || 条目们.length === 0) return []

  const 文们 = 条目们.map((e) => 归一(`${e.text} ${(e.tags || []).join(' ')}`))
  const 文档频率 = new Map()
  for (const w of 词们) {
    if (文档频率.has(w)) continue
    let n = 0
    for (const 文 of 文们) if (文.includes(w)) n += 1
    文档频率.set(w, n)
  }
  const 总 = Math.max(1, 条目们.length)
  const 权重 = (w) => Math.log((总 + 1) / ((文档频率.get(w) || 0) + 1)) + 1
  const 查询总重 = 词们.reduce((和, w) => 和 + 权重(w), 0) || 1

  const 倾向 = Number.isFinite(Number(选项.倾向)) ? Number(选项.倾向) : 当前倾向()
  const 倾向强 = Math.min(1, Math.abs(倾向))
  const 结果 = []
  for (let i = 0; i < 条目们.length; i += 1) {
    const e = 条目们[i]
    const 文 = 文们[i]
    let 命中重 = 0
    for (const w of 词们) if (文.includes(w)) 命中重 += 权重(w)
    if (命中重 === 0) continue
    const 证据 = 命中重 / 查询总重
    const 一致 = (e.mood || 0) !== 0 && Math.sign(e.mood || 0) === Math.sign(倾向)
    const 情绪因子 = 一致 ? 1 + 0.3 * 倾向强 : 1 - 0.2 * 倾向强
    const 得分 =
      证据 *
      (e.strength || 0) *
      (类型权重[e.kind] || 1) *
      (1 + 0.1 * (e.accessCount || 0)) *
      (1 + 0.2 * Math.abs(e.mood || 0)) *
      情绪因子
    结果.push({ ...e, 证据, 得分 })
  }

  // 联想扩散：命中条目连着的条目也带出来
  const 命中集 = new Set(结果.map((x) => x.id))
  const 扩展 = []
  for (const r of 结果) {
    for (const [id, w] of Object.entries(r.links || {})) {
      const 权 = Number(w) || 0
      if (权 < 0.4 || 命中集.has(id)) continue
      const 源 = 条目们.find((x) => x.id === id)
      if (!源) continue
      命中集.add(id)
      扩展.push({ ...源, 证据: 0, 得分: r.得分 * 0.5 * 权, 联想自: r.id })
    }
  }
  const 全部 = [...结果, ...扩展]
  全部.sort((a, b) => b.得分 - a.得分)
  return 全部.slice(0, 条数)
}

/**
 * 衰减（2026-10-25 新语义）：按「对话轮次」而不是天数。
 * - 每轮对话前，全库权值乘一次曲率：普通 0.97/轮，重要（权值 ≥0.5）0.995/轮
 * - 承诺、钉住的不衰减
 * - 这里不删条目：淡到阈值的留到「睡下」（body.awake=false）时清
 * @param 轮数 一次补乘几轮（默认 1）
 */
export function 衰减(条目们, 轮数 = 1) {
  const 次 = Math.max(1, Math.round(Number(轮数) || 1))
  const 出 = []
  for (const e of 条目们) {
    if (e.pinned === true || e.kind === 'promise') {
      出.push(e)
      continue
    }
    const 原 = Number(e.weight)
    const w0 = Number.isFinite(原) ? 原 : Number(e.strength) || 0.1
    const 曲率 = w0 >= 重要阈值 ? 曲率重要 : 曲率普通
    const w = Math.max(0, w0 * Math.pow(曲率, 次))
    const 收 = Math.round(w * 10000) / 10000
    出.push({ ...e, weight: 收, strength: 收, lastDecay: new Date().toISOString() })
  }
  return 出
}

/** 旧名字，兼容已有调用。 */
export const 遗忘 = 衰减

/**
 * 巩固：被想起/被再提一次 → 权值升一点、次数 +1。
 * 永久记忆（2026-10-25）：重要（权值 ≥0.5）且被重复提及 ≥3 次 → 钉住，之后不再衰减。
 */
export function 巩固(条目, 次数 = 1) {
  const 次数新 = (条目.accessCount || 0) + 次数
  const 原 = Number(条目.weight)
  const w0 = Number.isFinite(原) ? 原 : Number(条目.strength) || 0.1
  const w = Math.min(1, w0 + 0.05 * 次数)
  const 收 = Math.round(w * 10000) / 10000
  return {
    ...条目,
    accessCount: 次数新,
    weight: 收,
    strength: 收,
    pinned: 条目.pinned === true || (次数新 >= 3 && w >= 重要阈值),
    lastAccess: new Date().toISOString(),
  }
}

/** 文本归一（去标点空格，便于判重）。 */
function 归一(文本) {
  return String(文本 || '')
    .toLowerCase()
    .replace(/[\s，。！？、；：,.!?;:""''()（）【】\[\]]/g, '')
}

/**
 * 找相似的旧条目：完全相同、包含，或关键词重叠够高（≥0.55）。
 * 找到就返回它，调用方应该「合并」而不是新增 —— 同一件事再说一遍，权值往上加。
 */
export function 找相似(条目们, 文本) {
  const 新 = 归一(文本)
  if (!新) return null
  const 新词 = new Set(关键词(文本))
  let 最佳 = null
  let 最佳分 = 0
  for (let i = 条目们.length - 1; i >= 0; i -= 1) {
    const 旧 = 归一(条目们[i].text)
    if (!旧) continue
    if (旧 === 新) return 条目们[i]
    if (旧.length >= 8 && 新.length >= 8 && (旧.includes(新) || 新.includes(旧))) return 条目们[i]
    if (新词.size === 0) continue
    const 旧词 = new Set(关键词(条目们[i].text))
    if (旧词.size === 0) continue
    let 共同 = 0
    for (const w of 新词) if (旧词.has(w)) 共同 += 1
    const 分 = 共同 / Math.max(1, Math.min(新词.size, 旧词.size))
    if (分 > 最佳分) {
      最佳分 = 分
      最佳 = 条目们[i]
    }
  }
  return 最佳分 >= 0.55 ? 最佳 : null
}

/**
 * 合并两条记忆（2026-10-25 潜水喵定）：同一件事再说一遍 → 重新记忆。
 * - 权值相加（封顶 1）：0.05 + 0.1 → 0.15，被重新提起的事不容易再淡掉
 * - 次数 +1；重要且次数 ≥3 → 钉住
 * - 文本留更详细的那条，标签/连线合并
 */
export function 合并条目(旧, 新) {
  const 旧w = Number(旧.weight)
  const 新w = Number(新.weight)
  const w0 = Number.isFinite(旧w) ? 旧w : Number(旧.strength) || 0.1
  const w1 = Number.isFinite(新w) ? 新w : Number(新.strength) || 0.1
  const w = Math.round(Math.min(1, w0 + w1) * 10000) / 10000
  const 次数 = (旧.accessCount || 0) + 1
  const 文本 = String(新.text || '').length > String(旧.text || '').length ? 新.text : 旧.text
  const 情绪 = Math.abs(Number(新.mood) || 0) > Math.abs(Number(旧.mood) || 0) ? 新.mood : 旧.mood
  return {
    ...旧,
    text: 文本,
    mood: 情绪,
    tags: [...new Set([...(旧.tags || []), ...(新.tags || [])])].slice(0, 8),
    links: { ...(旧.links || {}), ...(新.links || {}) },
    weight: w,
    strength: w,
    accessCount: 次数,
    pinned: 旧.pinned === true || (次数 >= 3 && w >= 重要阈值),
    lastAccess: new Date().toISOString(),
  }
}

/** 加一条记忆（返回洗好的条目）。权值就是鲜活度：写入时的权重决定它一开始多「活」。 */
export function 造条目(输入 = {}) {
  const 权 = 夹01(输入.weight, 0.1)
  return 洗条目({
    id: 输入.id,
    at: 输入.at || new Date().toISOString(),
    kind: 输入.kind,
    text: 输入.text,
    tags: 输入.tags,
    mood: 输入.mood,
    weight: 输入.weight,
    strength: 输入.strength ?? 权,
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

/** 消费回忆队列：思维想起来哪些，就给哪些巩固。 */
export function 消费回忆(状态, 日志) {
  try {
    if (!existsSync(回忆队列)) return 0
    const 原文 = readFileSync(回忆队列, 'utf8').trim()
    if (原文 === '') return 0
    const ids = new Set()
    for (const 行 of 原文.split('\n')) {
      try {
        const d = JSON.parse(行)
        if (d && d.id) ids.add(String(d.id))
      } catch (error) {}
    }
    try {
      writeFileSync(回忆队列, '', 'utf8')
    } catch (error) {}
    if (ids.size === 0) return 0
    状态.entries = 状态.entries.map((e) => (ids.has(e.id) ? 巩固(e) : e))
    if (日志) 日志.调试(`想起来 ${ids.size} 条旧事`)
    return ids.size
  } catch (error) {
    return 0
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
  let 合并 = 0
  for (const 行 of 行们) {
    try {
      const d = JSON.parse(行)
      const e = 造条目(d)
      if (!e.text) continue
      const 相似 = 找相似(状态.entries, e.text)
      if (相似) {
        // 同一件事被再说一遍：权值相加，不新增（0.05 + 0.1 → 0.15）
        状态.entries = 状态.entries.map((x) => (x.id === 相似.id ? 合并条目(x, e) : x))
        合并 += 1
        continue
      }
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
    状态.entries.sort((a, b) => (b.weight || 0) - (a.weight || 0))
    状态.entries = 状态.entries.slice(0, 条数上限)
  }
  if (日志 && 应用 > 0) 日志.提示(`收件箱吃了 ${应用} 条记忆`)
  if (日志 && 合并 > 0) 日志.调试(`合并了 ${合并} 条重复记忆（权值相加）`)
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
          handler: (req, res) => {
            const 配置 = 读配置()
            const 状态 = 读状态()
            const 解锁到 = Number(配置.解锁到) || 0
            const 已解锁 = 配置.公开 === true || Date.now() < 解锁到
            if (!已解锁) {
              return 回JSON(res, 200, {
                状态: { entries: [], 隐藏: true, 条数: 状态.entries.length },
                类型权重,
                提示: '记忆是私密的（默认不公开），要经过允许才能看',
              })
            }
            回JSON(res, 200, { 状态, 类型权重, 解锁到 })
          },
        }),
      'dsh-memory: 数据',
    )
    ctx.effect(
      () =>
        服务.register({
          kind: 'exact',
          path: '/dsh-memory/允许',
          handler: async (req, res) => {
            try {
              let 分钟 = 30
              try {
                const 块 = []
                for await (const 片 of req) 块.push(片)
                const d = JSON.parse(Buffer.concat(块).toString('utf8') || '{}')
                分钟 = Math.max(1, Math.min(1440, Number(d.分钟) || 30))
              } catch (error) {}
              const 配置 = { ...读配置(), 解锁到: Date.now() + 分钟 * 60 * 1000 }
              写配置(配置)
              回JSON(res, 200, { ok: true, 解锁到: 配置.解锁到, 分钟 })
            } catch (error) {
              回JSON(res, 400, { ok: false, 说: String((error && error.message) || error) })
            }
          },
        }),
      'dsh-memory: 允许查看',
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
              const 相似 = 找相似(状态.entries, e.text)
              if (相似) {
                let 合并后 = 相似
                状态.entries = 状态.entries.map((x) => {
                  if (x.id !== 相似.id) return x
                  合并后 = 合并条目(x, e)
                  return 合并后
                })
                写状态(状态, 体)
                return 回JSON(res, 200, { ok: true, 条目: 合并后, 说: '同一件事，权值相加' })
              }
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

  /** 一跳：收件箱（2 秒一次，一聊完就落库）+ 回忆队列 + 偶尔看一眼睡没睡。 */
  function 跑一跳() {
    if (读配置().启用 === false) return
    tick次数 += 1
    try {
      const 状态 = 读状态()
      const 新 = 消费收件箱(状态, 体)
      const 回忆 = 消费回忆(状态, 体)
      let 动了 = 新 > 0 || 回忆 > 0

      // 睡觉时清掉淡到阈值以下的（每次睡下清一次）
      if (tick次数 % 睡眠检查每跳 === 0) {
        try {
          let 机体 = null
          try { 机体 = JSON.parse(readFileSync(join(根目录, 'body', 'state.json'), 'utf8')) } catch (error) {}
          if (机体 && 机体.awake === false && 机体.asleepSince && 机体.asleepSince !== 状态.lastSleepClean) {
            const 清前 = 状态.entries.length
            状态.entries = 状态.entries.filter((e) => e.pinned === true || e.kind === 'promise' || (Number(e.weight) || 0) >= 清理阈值)
            状态.lastSleepClean = 机体.asleepSince
            动了 = true
            调试(`睡下了：清掉淡到 ${清理阈值} 以下的记忆 ${清前 - 状态.entries.length} 条`)
          }
        } catch (error) {}
      }

      // 没变化就不写盘（2 秒一跳，别一直磨硬盘）；每 10 分钟落一次 updatedAt，启动第一跳也落一次
      if (!动了 && tick次数 !== 1 && tick次数 % 调试间隔tick !== 0) return

      if (动了) 状态.updatedAt = new Date().toISOString()
      写状态(状态, 体)
      if (tick次数 % 调试间隔tick === 0) {
        const 活 = 状态.entries.filter((e) => (Number(e.weight) || 0) >= 0.3).length
        调试(`还活着｜共 ${状态.entries.length} 条记忆（权值 ≥0.3 的 ${活} 条）${新 ? `｜新进 ${新}` : ''}`)
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
    'dsh-memory: 2 秒收件箱 + 睡下清理',
  )

  挂路由(ctx, 体)

  // 记忆注入：每轮结束先按曲率衰减一次，再把全部记忆挂进系统提示
  try {
    const 挂 = (agent) => {
      if (!agent || !agent.ctx) return
      // 每轮结束衰减一次（2026-10-25 起：按对话轮次，不按天数）
      if (!agent.__memoryDecayed && typeof agent.ctx.on === 'function') {
        agent.__memoryDecayed = true
        agent.ctx.on('agent/turn-stopping', () => {
          try {
            if (读配置().启用 === false) return
            const 状态 = 读状态()
            状态.entries = 衰减(状态.entries, 1)
            状态.updatedAt = new Date().toISOString()
            写状态(状态, 体)
          } catch (error) {}
        })
      }
      if (!agent.ctx.systemPrompt) return
      if (agent.__memoryInjected) return
      agent.__memoryInjected = true
      agent.ctx.systemPrompt.context({
        name: 'memory-recent',
        order: 900,
        text: () => {
          try {
            // 先把这轮刚写完的收件箱收进来，保证读到的是最新的
            try {
              const 现 = 读状态()
              if (消费收件箱(现, 体) > 0) 写状态(现, 体)
            } catch (error) {}
            // 每次对话前：全库衰减一次（曲率式，按轮次）
            let 状态 = 读状态()
            if (Array.isArray(状态.entries) && 状态.entries.length) {
              状态.entries = 衰减(状态.entries, 1)
              状态.updatedAt = new Date().toISOString()
              写状态(状态, 体)
            }
            const 全部 = (状态.entries || []).filter(
              (e) => e.pinned === true || e.kind === 'promise' || (Number(e.weight) || 0) >= 清理阈值,
            )
            // 全部注入：钉住的在前，其余按时间倒序（最近的在上面）
            const 钉住 = 全部.filter((e) => e.pinned === true)
            const 其余 = 全部
              .filter((e) => e.pinned !== true)
              .slice()
              .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
            const 条目 = [...钉住, ...其余]
            if (!条目.length) return ''
            const 行们 = 条目.map((e) => {
              const d = new Date(e.at)
              const 时 = Number.isFinite(d.getTime()) ? `${d.getMonth() + 1}月${d.getDate()}日` : ''
              return `- ${时} ${String(e.text || '').slice(0, 60)}`
            })
            return '【记忆·最近】\n' + 行们.join('\n') + '\n（这些是记住的事，聊天时自然带入，不用逐条提）'
          } catch (error) {
            return ''
          }
        },
      })
    }
    const 扫 = () => {
      try {
        for (const a of ctx.agents.list()) 挂(a)
      } catch (error) {}
    }
    扫()
    const 表 = ctx.interval(扫, 30000)
    ctx.effect(() => () => { try { 表() } catch (error) {} }, 'dsh-memory: 记忆注入')
  } catch (error) {}

  try {
    const 状态 = 读状态()
    ctx.logger.info(
      `memory: v0.1.0 已加载｜状态本 ${状态文件}｜共 ${状态.entries.length} 条记忆｜收件箱 ${收件箱}`,
    )
  } catch (error) {}
}

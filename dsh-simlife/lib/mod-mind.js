// DSH「思维中枢」（dsh-mind）· 宿主半边
//
// 管三样东西的状态：心情 / 好感 / 记忆索引。
// 每 60 秒按确定性公式算出欲望（想聊天 / 想刷站 / 想睡觉 / 想发呆），
// 写进 %DSH_HOME%/mind/state.json，供行为插件（dsh-behavior）取用。
//
// ⚠ 这个插件不碰 QQ、不碰 B 站、不调模型：它只是「想不想」的计算器。
// ⚠ 唯一真源：mind/state.json。别的插件只写 body/state.json 和 feedback.jsonl。
// ⚠ 任何读不到 / 写失败都只 warn，绝不让插件加载失败或让宿主崩。
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, appendFileSync, watch } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 插件对外名字（也是日志前缀）。 */
export const name = 'mind'

/** 需要的宿主服务：定时器、webServer、模型（每轮判断心情用）、agents（挂会话监听）。 */
export const inject = ['timer', 'webServer', 'llm', 'agents']

// ---------- 路径 ----------

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
const 思维目录 = join(根目录, 'mind')
const 状态文件 = join(思维目录, 'state.json')
const 反馈文件 = join(思维目录, 'feedback.jsonl')
const 配置文件 = join(思维目录, 'config.json')
/** 给机体写的激素补丁（机体每跳消费一次并清空）。 */
const 激素补丁文件 = join(根目录, 'body', 'hormone-patch.json')

/**
 * 给机体追加激素变化（0~1 尺度的增减量）。
 * 机体每 60 秒读一次、加到自己的激素上、然后清空。
 */
/** 记忆插件的收件箱：思维记东西不再自己存，写到这里，由 dsh-memory 收。 */
const 记忆收件箱 = join(根目录, 'memory', 'inbox.jsonl')

/** 直接写记忆库（memory/state.json）：对话结束立刻落库，不等 60 秒 tick。 */
function 写记忆(条目) {
  try {
    const 库 = join(根目录, 'memory', 'state.json')
    mkdirSync(dirname(库), { recursive: true })
    let 状态 = null
    try {
      状态 = JSON.parse(readFileSync(库, 'utf8'))
    } catch (error) {}
    if (!状态 || !Array.isArray(状态.entries)) 状态 = { schema: 1, updatedAt: null, entries: [] }
    const id = 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 5)
    状态.entries.push({ id, ...条目 })
    状态.updatedAt = new Date().toISOString()
    writeFileSync(库, JSON.stringify(状态), 'utf8')
  } catch (error) {}
}

/** 简单分词：中文双字组 + 英文词。 */
function 简单分词(文本) {
  const 低 = String(文本 || '').toLowerCase()
  const 词 = new Set()
  for (const 段 of 低.match(/[\u4e00-\u9fa5]{2,}/g) || []) {
    for (let i = 0; i < 段.length - 1; i += 1) 词.add(段.slice(i, i + 2))
  }
  for (const w of 低.match(/[a-z0-9]{2,}/g) || []) 词.add(w)
  return [...词]
}

/** 记忆标签停用词：太泛的双字不算标签。 */
const 记忆停用词 = new Set(['他说', '我的', '就是', '还是', '然后', '现在', '一个', '什么', '没有', '可以', '已经', '时候', '自己', '我们', '你们', '这个', '那个', '不是'])

/** 从记忆正文里抽几个关键词当标签（给检索用）。 */
function 抽标签(文本, 上限 = 4) {
  const 频 = new Map()
  for (const w of 简单分词(文本)) {
    if (记忆停用词.has(w)) continue
    频.set(w, (频.get(w) || 0) + 1)
  }
  return [...频.entries()].sort((a, b) => b[1] - a[1]).slice(0, 上限).map((x) => x[0])
}

/**
 * 主动回忆：用这轮的话去翻记忆，挑命中的几条。
 * 命中就算「想起来」，把 id 写进记忆的回忆队列（它下一跳会巩固）。
 */
function 主动回忆(话, 上限 = 3) {
  try {
    const 文件 = join(根目录, 'memory', 'state.json')
    if (!existsSync(文件)) return []
    const 状态 = JSON.parse(readFileSync(文件, 'utf8'))
    const 条目们 = Array.isArray(状态.entries) ? 状态.entries : []
    const 词们 = 简单分词(话)
    if (词们.length === 0) return []
    const 命中 = []
    for (const e of 条目们) {
      const 文 = `${e.text} ${(e.tags || []).join(' ')}`.toLowerCase()
      let n = 0
      for (const w of 词们) if (文.includes(w)) n += 1
      if (n === 0) continue
      命中.push({ ...e, 命中: n, 得分: (n / 词们.length) * (Number(e.strength) || 0) })
    }
    命中.sort((a, b) => b.得分 - a.得分)
    const 前几名 = 命中.slice(0, 上限)
    if (前几名.length > 0) {
      try {
        mkdirSync(join(根目录, 'memory'), { recursive: true })
        const 行们 = 前几名.map((e) => JSON.stringify({ id: e.id })).join('\n') + '\n'
        appendFileSync(join(根目录, 'memory', 'recall.jsonl'), 行们, 'utf8')
      } catch (error) {}
    }
    return 前几名
  } catch (error) {
    return []
  }
}

/** 读最近几条记忆（给判断/面板用，只读记忆插件的状态文件）。 */
function 读最近记忆(条数 = 3) {
  try {
    const 文件 = join(根目录, 'memory', 'state.json')
    if (!existsSync(文件)) return []
    const 状态 = JSON.parse(readFileSync(文件, 'utf8'))
    const 条目们 = Array.isArray(状态.entries) ? 状态.entries : []
    return 条目们.slice(-条数)
  } catch (error) {
    return []
  }
}

/**
 * 这一轮思考耗多少：按「处理时长」算（工具数拿不到，用时长+文本长度近似）。
 * 短对话几秒 → 消耗很小；长任务一分钟以上 → 明显消耗。
 */
function 消耗档(用户话, 回复, 时长秒 = 0) {
  const 文 = `${用户话 || ''} ${回复 || ''}`
  const 长 = Math.min(1, Math.max(0, (Number(时长秒) || 0) / 60))
  const 复杂 = 文.length > 1200 || 长 > 0.5
  // 思考/工具调用耗的是血糖（mmol/L），同时用脑让腺苷（睡眠压力）涨得快一点
  const 基础 = 复杂 ? 0.012 : 0.005
  return {
    血糖: -(基础 + 长 * 0.03),
    腺苷: 复杂 ? 2 : 1,
  }
}

function 写体力补丁(变化) {
  if (!变化 || typeof 变化 !== 'object') return
  const 文件 = join(根目录, 'body', 'body-patch.json')
  let 原 = {}
  try {
    原 = JSON.parse(readFileSync(文件, 'utf8'))
    if (!原 || typeof 原 !== 'object') 原 = {}
  } catch (error) {
    原 = {}
  }
  for (const 名 of ['精力', '体力', '血糖', '腺苷']) {
    const v = Number(变化[名])
    if (Number.isFinite(v) && v !== 0) 原[名] = (Number(原[名]) || 0) + v
  }
  try {
    原子写(文件, JSON.stringify(原))
  } catch (error) {}
}

function 写激素补丁(变化) {
  if (!变化 || typeof 变化 !== 'object') return
  let 原 = {}
  try {
    原 = JSON.parse(readFileSync(激素补丁文件, 'utf8'))
    if (!原 || typeof 原 !== 'object') 原 = {}
  } catch (error) {
    原 = {}
  }
  for (const 名 of Object.keys(默认状态.hormones)) {
    const v = Number(变化[名])
    if (Number.isFinite(v) && v !== 0) 原[名] = (Number(原[名]) || 0) + v
  }
  try {
    原子写(激素补丁文件, JSON.stringify(原))
  } catch (error) {}
}

/** 思维的可调参数（面板里改，默认值就是这边的手感）。 */
const 默认配置 = {
  随时能回: true, // true=睡着被消息吵醒（扣点精力）；false=装睡，不吵醒
  启用: true, // 总开关：关掉后不判断/不推移
  心情低落权重: 0.45, // chat 系数 = 0.55 + 权重 × (1 − 心情)
  陪伴好感: 0.004, // 每天结算：昨天还聊过 → 好感 + 这么多
  冷落好感: 0.006, // 每天结算：>3 天没聊 → 每多一天好感 − 这么多
  陪伴心情: 0.003,
  冷落心情: 0.004,
}
const 机体文件 = join(根目录, 'body', 'state.json')

/** tick 间隔：60 秒。 */
const tick毫秒 = 5 * 60 * 1000 // 兜底：有反馈/补丁时会被文件监听立刻叫醒
/** 每多少次 tick 打一条 debug（不刷屏，但能看出还活着）。 */
const 调试间隔tick = 20
/** 同一欲望刚执行过，30 分钟内降权到 0.4。 */
const 冷却分钟 = 30

// ---------- 小工具 ----------

/** 夹到 0~1；不是数字就用兜底。 */
function 夹01(值, 兜 = 0) {
  const n = Number(值)
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 兜
}

/** 时间字段归一成 ISO 字符串（null 表示没有）。 */
function 时间串(值) {
  if (值 === null || 值 === undefined || 值 === '') return null
  const t = typeof 值 === 'number' ? 值 : Date.parse(String(值))
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/** 距某个 ISO 时间过了多少分钟；拿不到就是 null。 */
function 分钟差(iso) {
  const t = Date.parse(String(iso || ''))
  return Number.isFinite(t) ? (Date.now() - t) / 60000 : null
}

/** 原子写：先写 .tmp 再改名；改名失败退回直接覆盖。 */
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

/** 只认真正是对象的，其它当空。 */
function 对象(值) {
  return 值 && typeof 值 === 'object' && !Array.isArray(值) ? 值 : {}
}

/** 分钟差工具（读出关系用）。 */
function 分钟差2(iso) {
  const t = Date.parse(String(iso || ''))
  return Number.isFinite(t) ? (Date.now() - t) / 60000 : null
}

/**
 * 从底层读出「关系」——好感/信任/熟悉/期待都不存储，现算。
 * 底层只有：五种激素 + 互动次数 + 情绪账本（正/负累计）+ 记忆条目。
 * 这样它们天然是糅杂的、边界模糊的：改一个底层量，几个高层概念一起动。
 * @returns { 好感, 信任, 熟悉, 期待, 情绪净值 }
 */
export function 读出关系(状态, 主键) {
  const 激素 = (状态 && 状态.hormones) || {}
  const 项 = (状态 && 状态.favor && 主键 && 状态.favor[主键]) || {}
  const 正 = Number(项.情绪 && 项.情绪.正) || 0
  const 负 = Number(项.情绪 && 项.情绪.负) || 0
  const 次数 = Number(项.talks) || 0
  const 记忆数 = Array.isArray(状态 && 状态.memories) ? 状态.memories.length : 0
  const 情绪净值 = Math.tanh((正 - 负) / 2)

  // 感情 = 亲密（催产素/血清素） + 安心（皮质醇低） + 熟悉 + 情绪账——全部从底层推
  const 催 = 夹01(激素.催产素, 默认状态.hormones.催产素)
  const 血 = 夹01(激素.血清素, 默认状态.hormones.血清素)
  const 多 = 夹01(激素.多巴胺, 默认状态.hormones.多巴胺)
  const 皮 = 夹01(激素.皮质醇, 默认状态.hormones.皮质醇)
  const 信任 = 夹01(0.3 * 催 + 0.3 * 血 + 0.4 * ((情绪净值 + 1) / 2), 0.5)
  const 熟悉 = 夹01(Math.tanh(次数 / 20) * 0.7 + Math.tanh(记忆数 / 10) * 0.3, 0)
  const 最近 = 分钟差2(项.last)
  const 期待 = 夹01(多 * 0.6 + (最近 !== null && 最近 < 180 ? 0.3 : 0.1) + 熟悉 * 0.1, 0.5)
  const 亲密 = 夹01(催 * 0.5 + 血 * 0.3 + (1 - 皮) * 0.2, 0.5)
  const 感情 = 夹01(0.55 * 亲密 + 0.25 * 熟悉 + 0.2 * ((情绪净值 + 1) / 2), 0.5)
  return { 感情, 好感: 感情, 信任, 熟悉, 期待, 情绪净值 }
}

/** 好感表里「最该算的那个人」的键：只有一个就用它；多个挑 talks 最多的。 */
function 主好感键(好感表) {
  const 表 = 对象(好感表)
  const 键们 = Object.keys(表)
  if (键们.length === 0) return null
  let 最好 = 键们[0]
  let 最多 = -1
  for (const 键 of 键们) {
    const 次数 = Number(表[键] && 表[键].talks) || 0
    if (次数 > 最多) {
      最多 = 次数
      最好 = 键
    }
  }
  return 最好
}

// ---------- 默认状态（字段照 THREE-PLUGINS.md 第三节）----------

const 默认状态 = {
  schema: 2,
  updatedAt: null,
  mood: 0.7, // 派生值（由激素算出来），保留给旧调用/面板看
  /** 心情的「原色」：情绪是这五个激素的组合，不是七个标签 */
  hormones: {
    多巴胺: 0.5, // 想要、期待、想做事
    血清素: 0.65, // 满足、稳定、不焦虑
    催产素: 0.55, // 亲密、信任、想靠近人
    皮质醇: 0.2, // 压力、焦虑、想躲
    肾上腺素: 0.3, // 亢奋、冲动
  },
  favor: {},
  memory: { lastTalkAt: null, lastFeedAt: null, lastSleepAt: null, events: 0, lastDriftDate: null },
  /** 记忆条目：{ at, text, strength, 情绪强度, hormones } —— 会淡忘，高情绪的记得更久 */
  memories: [],
  body: { energy: 0.6, stamina: 0.8 },
  desires: { eat: 0, sleep: 0, fun: 0, idle: 0, chat: 0 },
  desireTop: null,
  desireUpdatedAt: null,
  cooldown: {},
  /** 当前念头（原 状态.md 那套：在想什么、在干嘛）。 */
  念头: { 文本: '', 在干嘛: '', at: null },
}

/** 激素参考区间（和机体那边一致；真实单位，用位置折算成 0~1）。 */
const 激素参考 = {
  多巴胺: { 基准: 50, 下限: 10, 上限: 90, 单位: 'pg/mL' },
  血清素: { 基准: 190, 下限: 101, 上限: 283, 单位: 'ng/mL' },
  催产素: { 基准: 5, 下限: 1, 上限: 10, 单位: 'pg/mL' },
  皮质醇: { 基准: 350, 下限: 138, 上限: 690, 单位: 'nmol/L' },
  肾上腺素: { 基准: 30, 下限: 10, 上限: 50, 单位: 'pg/mL' },
}

/** 真实值 → 在正常范围里的位置 0~1。 */
export function 激素位置(名, 值) {
  const r = 激素参考[名]
  if (!r) return 0.5
  const n = Number(值)
  if (!Number.isFinite(n)) return 0.5
  return Math.min(1, Math.max(0, (n - r.下限) / (r.上限 - r.下限)))
}

/**
 * 心情 = 五个激素原色的加权和（0~1）。
 * 多巴胺/血清素/催产素往上拉，皮质醇往下拉，肾上腺素一点点推。
 */
export function 心情从激素(激素 = {}) {
  const 多 = 激素位置('多巴胺', 激素.多巴胺)
  const 血 = 激素位置('血清素', 激素.血清素)
  const 催 = 激素位置('催产素', 激素.催产素)
  const 皮 = 激素位置('皮质醇', 激素.皮质醇)
  const 肾 = 激素位置('肾上腺素', 激素.肾上腺素)
  return 夹01(0.32 * 多 + 0.3 * 血 + 0.18 * 催 - 0.28 * 皮 + 0.1 * 肾, 默认状态.mood)
}

/**
 * 欲望引擎（纯函数，测试能直接喂极值）。
 *
 * 激素 → 欲望：
 *   想聊天  = 好感 × (0.35 + 0.45×催产素 + 0.25×皮质醇) × 情绪低谷系数 + 久未聊
 *   想刷视频 = 0.10 + (0.30 + 0.55×多巴胺) × 无聊度 + 0.15×肾上腺素
 *   想睡觉  = (1−精力) × (0.9 − 0.25×肾上腺素) + 0.15×皮质醇 + 夜间
 *   想发呆  = 0.10 + (1−多巴胺)×0.22 + (1−肾上腺素)×0.12
 *
 * ⚠ 没传激素时用心情兜底（兼容旧调用）。
 * ⚠ 不掷骰子，全是确定性计算。
 * @param {object} 输入 { mood, hormones, 好感, 精力, 距上次聊天分钟, 距上次刷站分钟, 小时 }
 * @returns { chat, bili, sleep, idle, mc } 每个 0~1
 */
export function 算欲望(输入 = {}) {
  const 心情 = 夹01(输入.mood, 默认状态.mood)
  const 好感 = 夹01(输入.好感, 0)
  const 精力 = 夹01(输入.精力, 默认状态.body.energy)
  const 激 = 输入.hormones && typeof 输入.hormones === 'object' ? 输入.hormones : null
  const 多 = 激 ? 激素位置('多巴胺', 激.多巴胺) : 心情 * 0.8
  const 血 = 激 ? 激素位置('血清素', 激.血清素) : 心情
  const 催 = 激 ? 激素位置('催产素', 激.催产素) : 0.5
  const 皮 = 激 ? 激素位置('皮质醇', 激.皮质醇) : 0.2
  const 肾 = 激 ? 激素位置('肾上腺素', 激.肾上腺素) : 0.3
  const 读距 = (值) => (值 === null || 值 === undefined ? null : Number.isFinite(Number(值)) ? Number(值) : null)
  const 距聊 = 读距(输入.距上次聊天分钟)
  const 距刷 = 读距(输入.距上次刷站分钟)
  const 小时 = Number.isFinite(Number(输入.小时)) ? Number(输入.小时) : new Date().getHours()

  // 缺什么补什么：越缺某项对应的欲望越高
  const 血糖 = Number.isFinite(Number(输入.血糖)) ? Number(输入.血糖) : 5.0
  const 腺苷 = Number.isFinite(Number(输入.腺苷)) ? Number(输入.腺苷) : 50
  const 褪黑素 = Number.isFinite(Number(输入.褪黑素)) ? Number(输入.褪黑素) : 5
  const 缺多 = 1 - 多 // 缺快乐
  const 缺血 = 1 - 血 // 缺安心
  const 缺催 = 1 - 催 // 缺亲密
  const 压力 = 皮 // 压力（皮质醇高）
  const 缺糖 = Math.max(0, Math.min(1, (5.0 - 血糖) / 2.0)) // 血糖缺口
  const 缺觉 = Math.max(0, Math.min(1, (腺苷 - 50) / 250)) * 0.6 + Math.max(0, Math.min(1, (褪黑素 - 5) / 95)) * 0.4 // 睡眠压力
  const 久未聊 = 距聊 === null ? 0.15 : Math.min(0.15, (距聊 / 60 / 8) * 0.15)
  const 无聊度 = 距刷 === null ? 1 : Math.min(1, 距刷 / 60 / 6)

  // 1. 吃饭：血糖低 → 想吃
  const eat = Math.min(1, 0.02 + 缺糖 * 1.3)
  // 2. 睡觉：腺苷/褪黑素高 → 困
  const sleep = Math.min(1, 0.02 + 缺觉 * 1.0)
  // 3. 娱乐：缺多巴胺/血清素 → 想玩（游戏/刷视频/听歌都算）
  const fun = Math.min(1, 0.05 + 缺多 * 0.7 + 缺血 * 0.3)
  // 4. 发呆：压力大 → 想放空
  const idle = Math.min(1, 0.03 + 压力 * 0.85)
  // 5. 聊天：缺亲密/缺安心 + 好感 + 久未聊（社交奖励也提多巴胺，但主要补关系）
  const chat = Math.min(1, 0.08 + 缺催 * 0.45 + 缺血 * 0.2 + 好感 * 0.25 + 久未聊)
  return { eat, sleep, fun, idle, chat }
}

// ---------- 状态读写 ----------

/** 从旧插件（feiyu-mood / feiyu-favor）导入初值；读不到就用默认。 */
function 导入旧状态() {
  const 出 = JSON.parse(JSON.stringify(默认状态))
  try {
    const m = JSON.parse(readFileSync(join(根目录, 'feiyu-mood', 'state.json'), 'utf8'))
    if (Number.isFinite(Number(m && m.mood))) 出.mood = 夹01(Number(m.mood) / 100, 出.mood)
  } catch (error) {}
  try {
    const f = JSON.parse(readFileSync(join(根目录, 'feiyu-favor', 'state.json'), 'utf8'))
    const 表 = 对象(f && f.favor)
    for (const 键 of Object.keys(表)) {
      出.favor[键] = {
        value: 夹01(表[键] && 表[键].value, 0.2),
        name: typeof 表[键].name === 'string' ? 表[键].name : '',
        last: 时间串(表[键].last),
        talks: Math.max(0, Math.round(Number(表[键].talks) || 0)),
      }
    }
    if (Number.isFinite(Number(f && f.energy))) 出.body.energy = 夹01(f.energy, 出.body.energy)
    // 记忆导入：好感里的「最后互动时间」就是上次聊天时间，带进 mind 的 memory
    const 时间们 = Object.values(出.favor)
      .map((x) => x.last)
      .filter(Boolean)
      .sort()
    if (时间们.length > 0) 出.memory.lastTalkAt = 时间们[时间们.length - 1]
  } catch (error) {}
  // 心情 → 激素初值：好心情 = 多巴胺/血清素偏高、皮质醇偏低（按正常范围折算成真实单位）
  const 心情 = 出.mood
  const 参考 = 激素参考
  出.hormones = {
    多巴胺: 参考.多巴胺.基准 * (0.6 + 0.8 * 心情),
    血清素: 参考.血清素.基准 * (0.6 + 0.8 * 心情),
    催产素: 参考.催产素.基准,
    皮质醇: 参考.皮质醇.基准 * (1.5 - 1.0 * 心情),
    肾上腺素: 参考.肾上腺素.基准,
  }
  出.mood = 心情从激素(出.hormones)
  return 出
}

/** 洗记忆条目（最多留 200 条）。 */
function 洗记忆(原始) {
  if (!Array.isArray(原始)) return []
  const 出 = []
  for (const 项 of 原始.slice(-200)) {
    if (!项 || typeof 项 !== 'object') continue
    出.push({
      at: 时间串(项.at),
      text: String(项.text || '').slice(0, 300),
      strength: 夹01(项.strength, 1),
      情绪强度: 夹01(项.情绪强度, 0),
      hormones: 项.hormones && typeof 项.hormones === 'object' ? 项.hormones : null,
    })
  }
  return 出
}

/** 每跳的记忆淡忘：普通记忆一天淡一半多，高情绪的记忆淡得慢。 */
export function 淡忘记忆(记忆们) {
  if (!Array.isArray(记忆们)) return []
  const 出 = []
  for (const 项 of 记忆们) {
    const 减 = 0.0004 * (1 - Math.min(0.9, Number(项.情绪强度) || 0))
    const strength = Math.max(0, (Number(项.strength) || 0) - 减)
    if (strength > 0.01) 出.push({ ...项, strength })
  }
  return 出.slice(-200)
}

/** 洗状态本（缺字段补默认，怪值夹回来）。 */
function 归一状态(原始) {
  const 混 = 对象(原始)
  const 记 = 对象(混.memory)
  const 身 = 对象(混.body)
  const 欲 = 对象(混.desires)
  const 冷 = 对象(混.cooldown)
  const 好感表 = 对象(混.favor)
  const 洗好感 = {}
  for (const 键 of Object.keys(好感表)) {
    const 项 = 对象(好感表[键])
    洗好感[键] = {
      value: 夹01(项.value, 0.2),
      name: typeof 项.name === 'string' ? 项.name : '',
      last: 时间串(项.last),
      talks: Math.max(0, Math.round(Number(项.talks) || 0)),
      情绪: { 正: 夹01(项.情绪 && 项.情绪.正, 0), 负: 夹01(项.情绪 && 项.情绪.负, 0) },
    }
  }
  const 洗冷 = {}
  for (const 键 of Object.keys(冷)) {
    const t = 时间串(冷[键])
    if (t) 洗冷[键] = t
  }
  return {
    schema: 2,
    updatedAt: 时间串(混.updatedAt),
    mood: 夹01(混.mood, 默认状态.mood),
    hormones: {
      多巴胺: 夹01(对象(混.hormones).多巴胺, 默认状态.hormones.多巴胺),
      血清素: 夹01(对象(混.hormones).血清素, 默认状态.hormones.血清素),
      催产素: 夹01(对象(混.hormones).催产素, 默认状态.hormones.催产素),
      皮质醇: 夹01(对象(混.hormones).皮质醇, 默认状态.hormones.皮质醇),
      肾上腺素: 夹01(对象(混.hormones).肾上腺素, 默认状态.hormones.肾上腺素),
    },
    念头: {
      文本: typeof (对象(混.念头).文本) === 'string' ? String(对象(混.念头).文本).slice(0, 300) : '',
      在干嘛: typeof (对象(混.念头).在干嘛) === 'string' ? String(对象(混.念头).在干嘛).slice(0, 200) : '',
      at: 时间串(对象(混.念头).at),
    },
    favor: 洗好感,
    memories: 洗记忆(混.memories),
    memory: {
      lastTalkAt: 时间串(记.lastTalkAt),
      lastFeedAt: 时间串(记.lastFeedAt),
      lastSleepAt: 时间串(记.lastSleepAt),
      events: Math.max(0, Math.round(Number(记.events) || 0)),
      lastDriftDate: typeof 记.lastDriftDate === 'string' ? 记.lastDriftDate : null,
    },
    body: {
      energy: 夹01(身.energy, 默认状态.body.energy),
      stamina: 夹01(身.stamina, 默认状态.body.stamina),
    },
    desires: {
      eat: 夹01(欲.eat, 0),
      sleep: 夹01(欲.sleep, 0),
      fun: 夹01(欲.fun, 0),
      idle: 夹01(欲.idle, 0),
      chat: 夹01(欲.chat, 0),
    },
    desireTop: typeof 混.desireTop === 'string' ? 混.desireTop : null,
    desireUpdatedAt: 时间串(混.desireUpdatedAt),
    cooldown: 洗冷,
  }
}

/** 洗配置（缺字段补默认，怪值夹 0~1）。 */
function 归一配置(原始) {
  const 混 = 原始 && typeof 原始 === 'object' ? 原始 : {}
  const 出 = {}
  for (const 键 of Object.keys(默认配置)) 出[键] = 夹01(混[键], 默认配置[键])
  return 出
}

function 读配置() {
  try {
    return 归一配置(JSON.parse(readFileSync(配置文件, 'utf8')))
  } catch (error) {
    return 归一配置(null)
  }
}

/** 改配置（只认白名单），返回新配置或 null。 */
export function 改配置(patch) {
  const 新 = { ...读配置() }
  if (patch && typeof patch === 'object') {
    for (const 键 of Object.keys(默认配置)) {
      if (Number.isFinite(Number(patch[键]))) 新[键] = 夹01(Number(patch[键]), 新[键])
    }
  }
  const 归 = 归一配置(新)
  try {
    原子写(配置文件, JSON.stringify(归, null, 2))
  } catch (error) {
    return null
  }
  return 归
}

/** 读状态本：没有就导入旧状态；永远不抛。 */
function 读状态(日志) {
  try {
    if (!existsSync(状态文件)) {
      const 初 = 导入旧状态()
      if (日志) 日志.提示(`状态本不存在，已从旧插件导入初值：心情 ${初.mood.toFixed(2)}｜好感 ${Object.keys(初.favor).length} 个｜精力 ${初.body.energy.toFixed(2)}`)
      return 初
    }
    return 归一状态(JSON.parse(readFileSync(状态文件, 'utf8')))
  } catch (error) {
    if (日志) 日志.警告(`读状态本失败（按默认值跑）：${String((error && error.message) || error)}`)
    return 归一状态(null)
  }
}

/** 写状态本：失败只警告，不抛。 */
function 写状态(状态, 日志) {
  try {
    原子写(状态文件, JSON.stringify(状态, null, 2))
    return true
  } catch (error) {
    if (日志) 日志.警告(`写状态本失败：${String((error && error.message) || error)}`)
    return false
  }
}

// ---------- 机体镜像 ----------

/** 读机体（body/state.json），读不到返回 null。 */
function 读机体() {
  try {
    const 体 = JSON.parse(readFileSync(机体文件, 'utf8'))
    if (!体 || typeof 体 !== 'object') return null
    return 体
  } catch (error) {
    return null
  }
}

/** 从机体镜像算活性（和 body 的算法一致）。 */
function 算活性镜像(机体) {
  if (!机体) return null
  const 激 = 机体.hormones || {}
  const 位 = (名, lo, hi) => {
    const n = Number(激[名])
    return Number.isFinite(n) ? Math.min(1, Math.max(0, (n - lo) / (hi - lo))) : 0.5
  }
  const 多 = 位('多巴胺', 10, 90)
  const 肾 = 位('肾上腺素', 10, 50)
  const 腺 = Math.min(1, Math.max(0, (Number(机体.adenosine) || 50) / 300))
  const 褪 = Math.min(1, Math.max(0, (Number(机体.melatonin) || 5) / 200))
  return Math.round(Math.max(0, Math.min(100, 50 + 多 * 30 + 肾 * 20 - 腺 * 40 - 褪 * 30)))
}

// ---------- 反馈队列 ----------

/**
 * 消费行为插件写的 feedback.jsonl：
 *   { at, kind, who?, mood?, favor?, energy?, memory? }
 * 每条应用完清空文件；坏行跳过。
 * @returns 应用了几条
 */
function 消费反馈(状态, 日志) {
  let 行们 = []
  try {
    if (!existsSync(反馈文件)) return 0
    const 原文 = readFileSync(反馈文件, 'utf8').trim()
    if (原文 === '') return 0
    行们 = 原文.split('\n').map((s) => s.trim()).filter(Boolean)
  } catch (error) {
    return 0
  }

  let 应用 = 0
  for (const 行 of 行们) {
    try {
      const f = JSON.parse(行)
      const 时刻 = 时间串(f.at) || new Date().toISOString()

      const 情绪 = Number(f.mood)
      if (Number.isFinite(情绪)) {
        状态.mood = 夹01(状态.mood + 情绪, 状态.mood)
        // 情绪摊到激素上：开心拉多巴胺/血清素，难受拉皮质醇
        if (!状态.hormones) 状态.hormones = { ...默认状态.hormones }
        写激素补丁(
          情绪 >= 0
            ? { 多巴胺: 情绪 * 0.6, 血清素: 情绪 * 0.4 }
            : { 皮质醇: -情绪 * 0.7, 多巴胺: 情绪 * 0.3 },
        )
      }

      const 好感变化 = Number(f.favor)
      const 对象键 = f.who ? String(f.who) : 主好感键(状态.favor)
      if (Number.isFinite(好感变化) && 对象键) {
        const 项 = 状态.favor[对象键] || { value: 0.2, name: '', last: null, talks: 0 }
        项.value = 夹01(项.value + 好感变化, 项.value)
        项.情绪 = 项.情绪 || { 正: 0, 负: 0 }
        if (好感变化 >= 0) 项.情绪.正 = 夹01(项.情绪.正 + 好感变化, 0)
        else 项.情绪.负 = 夹01(项.情绪.负 - 好感变化, 0)
        项.last = 时刻
        项.talks = (项.talks || 0) + 1
        状态.favor[对象键] = 项
      }

      const 耗 = Number(f.energy)
      const 体力耗 = Number(f.stamina)
      if (Number.isFinite(耗) || Number.isFinite(体力耗)) {
        写体力补丁({ 精力: Number.isFinite(耗) ? 耗 : 0, 体力: Number.isFinite(体力耗) ? 体力耗 : 0 })
      }
      if (f.hormones && typeof f.hormones === 'object') {
        const 激素变化 = {}
        for (const 名 of ['多巴胺', '血清素', '催产素', '皮质醇', '肾上腺素']) {
          const v = Number(f.hormones[名])
          if (Number.isFinite(v) && v !== 0) 激素变化[名] = v
        }
        if (Object.keys(激素变化).length > 0) 写激素补丁(激素变化)
      }

      if (f.kind === 'chat') 状态.memory.lastTalkAt = 时刻
      else if (f.kind === 'bili') 状态.memory.lastFeedAt = 时刻
      else if (f.kind === 'sleep') 状态.memory.lastSleepAt = 时刻

      if (typeof f.kind === 'string' && f.kind) 状态.cooldown[f.kind] = 时刻
      状态.memory.events = (状态.memory.events || 0) + 1
      应用 += 1
    } catch (error) {
      // 坏行跳过
    }
  }

  // 全清（坏行也清掉，避免越积越多）
  try {
    atomic写空()
  } catch (error) {}
  if (日志 && 应用 > 0) 日志.提示(`消费了 ${应用} 条行为反馈`)

  function atomic写空() {
    writeFileSync(反馈文件, '', 'utf8')
  }
  return 应用
}

// ---------- 每日结算：记忆（互动频率）→ 好感 → 心情 ----------

/** 今天的日期串 YYYY-MM-DD（本地时区）。 */
function 今天日期(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 每日结算（跨天才跑一次）：用「最近多久没聊」当记忆的影子，慢慢推动好感和心情。
 *
 *   昨天还聊过（≤1 天） → 好感 +0.004、心情 +0.003（关系在保温）
 *   1~3 天没聊          → 不动（正常）
 *   > 3 天没聊          → 每多一天好感 -0.006、心情 -0.004（最多按 3 天算）
 *
 * ⚠ 这是「记忆→好感→心情」的慢变量，跑在 feedback 的快变量下面。
 * @returns 是否真的结算了
 */
function 每日结算(状态, 现在 = new Date(), 配置 = 默认配置) {
  const 今天 = 今天日期(现在)
  if (状态.memory.lastDriftDate === 今天) return false
  状态.memory.lastDriftDate = 今天

  const 上次聊 = Date.parse(String(状态.memory.lastTalkAt || ''))
  if (!Number.isFinite(上次聊)) return true // 从来没聊过：不动

  const 天数 = (现在.getTime() - 上次聊) / 86400000
  let 好感增量 = 0
  let 心情增量 = 0
  if (天数 <= 1) {
    好感增量 = 配置.陪伴好感
    心情增量 = 配置.陪伴心情
  } else if (天数 > 3) {
    const 重 = Math.min(3, 天数 - 3)
    好感增量 = -配置.冷落好感 * 重
    心情增量 = -配置.冷落心情 * 重
  }

  // 好感自然回落：向 0.5 靠 1%（情绪会平复，不会只涨不跌）
  try {
    const 主键 = 主好感键(状态.favor)
    if (主键 && 状态.favor[主键]) {
      const v = Number(状态.favor[主键].value) || 0
      状态.favor[主键].value = Math.max(0, Math.min(1, v + (0.5 - v) * 0.01))
    }
  } catch (error) {}

  if (好感增量 !== 0) {
    const 主键 = 主好感键(状态.favor)
    if (主键) {
      状态.favor[主键].value = 夹01(状态.favor[主键].value + 好感增量, 状态.favor[主键].value)
    }
  }
  if (心情增量 !== 0) {
    状态.mood = 夹01(状态.mood + 心情增量, 状态.mood)
    写激素补丁(
      心情增量 >= 0
        ? { 血清素: 心情增量 * 0.6, 催产素: 心情增量 * 0.4 }
        : { 皮质醇: -心情增量 * 0.6 },
    )
  }
  return true
}

// ---------- 执行体 ----------

function 造执行体(ctx) {
  let tick次数 = 0
  let 停表 = null
  let 监听器 = null
  let 防抖 = null

  function 提示(文本) {
    try {
      ctx.logger.info(`mind: ${文本}`)
    } catch (error) {}
  }
  function 警告(文本) {
    try {
      ctx.logger.warn(`mind: ${文本}`)
    } catch (error) {}
  }
  function 调试(文本) {
    try {
      if (ctx.logger.debug) ctx.logger.debug(`mind: ${文本}`)
      else ctx.logger.info(`mind: ${文本}`)
    } catch (error) {}
  }

  /** 一跳：读状态 → 镜像机体 → 消费反馈 → 算欲望 → 写盘。 */
  function 跑一跳() {
    if (读配置().启用 === false) return
    tick次数 += 1
    try {
      const 状态 = 读状态({ 提示, 警告 })
      const 配置 = 读配置()

      // 1. 机体镜像（body 插件写，这里只读）
      const 机体 = 读机体()
      if (机体) {
        if (Number.isFinite(Number(机体.energy))) 状态.body.energy = 夹01(机体.energy, 状态.body.energy)
        if (Number.isFinite(Number(机体.stamina))) 状态.body.stamina = 夹01(机体.stamina, 状态.body.stamina)
        // 激素真源在机体：思维每跳镜像一份来算心情/欲望
        if (机体.hormones && typeof 机体.hormones === 'object') 状态.hormones = { ...机体.hormones }
      }

      // 2. 消费行为反馈
      消费反馈(状态, { 提示, 警告 })

      // 2.5 每日结算：记忆（最近互动）→ 好感 → 心情（慢变量，跨天才动）
      if (每日结算(状态, undefined, 配置)) {
        调试(`每日结算：心情 ${状态.mood.toFixed(2)}｜好感 ${主好感键(状态.favor) ? 状态.favor[主好感键(状态.favor)].value.toFixed(2) : '—'}`)
      }

      // 2.6 心情 = 激素的组合（每跳重算；激素才是真源）
      状态.mood = 心情从激素(状态.hormones)

      // 2.7 记忆的淡忘交给 dsh-memory，这里不再自己存

      // 3. 算欲望
      const 主键 = 主好感键(状态.favor)
      const 关系 = 主键 ? 读出关系(状态, 主键) : { 好感: 0, 信任: 0, 熟悉: 0, 期待: 0 }
      状态.关系 = 关系
      const 好感 = 关系.好感
      const 欲望 = 算欲望({
        mood: 状态.mood,
        hormones: 状态.hormones,
        好感,
        精力: 状态.body.energy,
        血糖: 机体 && 机体.glucose,
        腺苷: 机体 && 机体.adenosine,
        褪黑素: 机体 && 机体.melatonin,
        距上次聊天分钟: 分钟差(状态.memory.lastTalkAt),
        距上次刷站分钟: 分钟差(状态.memory.lastFeedAt),
        小时: new Date().getHours(),
      })

      // 4. 冷却降权
      for (const 键 of Object.keys(欲望)) {
        const 冷 = 分钟差(状态.cooldown[键])
        if (冷 !== null && 冷 < 冷却分钟) 欲望[键] = Math.round(欲望[键] * 0.4 * 100) / 100
      }

      // 5. 写盘
      状态.desires = 欲望
      const 排名 = Object.entries(欲望).sort((a, b) => b[1] - a[1])
      状态.desireTop = 排名[0] ? 排名[0][0] : null
      状态.desireUpdatedAt = new Date().toISOString()
      状态.updatedAt = 状态.desireUpdatedAt
      写状态(状态, { 提示, 警告 })

      // 6. 日志：每 20 跳一条活着 + 有欲望变化时一条
      if (tick次数 % 调试间隔tick === 0) {
        调试(
          `还活着｜心情 ${状态.mood.toFixed(2)}｜好感 ${好感.toFixed(2)}｜精力 ${状态.body.energy.toFixed(2)}｜` +
            `欲望 ${排名.map(([k, v]) => `${k} ${v}`).join(' / ')}`,
        )
      }
    } catch (error) {
      警告(`tick 出错（已兜住，不影响宿主）：${String((error && error.message) || error)}`)
    }
  }

  function 开表() {
    try {
      if (停表 !== null) 收摊()
      // 文件监听：feedback 一写入就立刻跑一跳（300ms 防抖）
      try {
        监听器 = watch(思维目录, { persistent: false }, (事件, 文件名) => {
          if (文件名 !== 'feedback.jsonl') return
          if (防抖) clearTimeout(防抖)
          防抖 = setTimeout(() => {
            try {
              跑一跳()
            } catch (error) {}
          }, 300)
        })
        调试('已监听 feedback.jsonl：有反馈立刻跑一跳')
      } catch (error) {}
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
      调试('拿不到 ctx.interval，用内置 setInterval 顶上')
    } catch (error) {
      警告(`定时器没起来：${String((error && error.message) || error)}`)
    }
  }

  function 收摊() {
    try {
      if (监听器) 监听器.close()
    } catch (error) {}
    监听器 = null
    if (防抖) clearTimeout(防抖)
    防抖 = null
    const 停 = 停表
    停表 = null
    try {
      if (typeof 停 === 'function') 停()
      else if (停 && typeof 停.dispose === 'function') 停.dispose()
    } catch (error) {}
  }

  return { 跑一跳, 开表, 收摊, 提示, 警告, 调试 }
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
    体.警告('拿不到 webServer，设置页接口没挂（其余照常）')
    return
  }
  try {
    ctx.effect(
      () =>
        服务.register({
          kind: 'exact',
          path: '/dsh-mind/data',
          handler: (req, res) => {
            const 状态 = 读状态()
            const 机体 = 读机体()
            const 键 = 主好感键(状态.favor)
            const 关系 = 读出关系({ ...状态, hormones: (机体 && 机体.hormones) || 状态.hormones }, 键)
            回JSON(res, 200, {
              状态,
              配置: 读配置(),
              记忆: 读最近记忆(6),
              关系,
              活性: 算活性镜像(机体),
              耐力: 机体 ? Math.round((Number(机体.stamina) || 0) * 100) : null,
              醒着: 机体 ? 机体.awake !== false : false,
              睡眠状态: (() => {
                if (!机体) return '未知'
                const 活 = 算活性镜像(机体)
                const 醒 = 机体.awake !== false
                if (!醒) return 活 < 25 ? '疲惫' : '疲惫（浅眠）'
                return 活 < 25 ? '疲惫' : 活 < 50 ? '困倦' : '清醒'
              })(),
              活动: (() => {
                try {
                  const 行 = JSON.parse(readFileSync(join(根目录, 'behavior', 'state.json'), 'utf8'))
                  const 当 = 行 && 行.当前活动
                  if (!当 || !当.名) return null
                  if (当.到 && Date.parse(当.到) < Date.now()) return null
                  return { 名: 当.名, 到: 当.到, 开始: 当.开始 }
                } catch (error) {
                  return null
                }
              })(),
            })
          },
        }),
      'dsh-mind: 设置页数据',
    )
    ctx.effect(
      () =>
        服务.register({
          kind: 'exact',
          path: '/dsh-mind/config',
          handler: async (req, res) => {
            try {
              const 块 = []
              for await (const 片 of req) 块.push(片)
              const 原文 = Buffer.concat(块).toString('utf8')
              const patch = 原文 ? JSON.parse(原文) : {}
              const 新 = 改配置(patch)
              if (新) {
                体.提示('设置页改了思维参数（下一跳生效）')
                回JSON(res, 200, { ok: true, 配置: 新, 说: '改好了，下一跳（≤60 秒）生效' })
              } else {
                回JSON(res, 500, { ok: false, 说: '配置写不进去' })
              }
            } catch (error) {
              回JSON(res, 400, { ok: false, 说: `请求解析失败：${String((error && error.message) || error)}` })
            }
          },
        }),
      'dsh-mind: 设置页改配置',
    )
    体.提示('设置页接口已就绪：GET /dsh-mind/data｜POST /dsh-mind/config')
  } catch (error) {
    体.警告(`设置页接口挂不上：${String((error && error.message) || error)}`)
  }
}

// ---------- 每轮判断：聊完这一轮，激素怎么动 ----------

/** 从消息里取纯文本（兼容 content 数组 / text）。 */
function 取文本(msg) {
  try {
    if (!msg) return ''
    const c = msg.content
    if (Array.isArray(c)) return c.map((x) => (x && x.text) || '').join('').trim()
    if (typeof c === 'string') return c.trim()
    if (typeof msg.text === 'string') return msg.text.trim()
  } catch (error) {}
  return ''
}

/** 会话里最后一条「真人说的」用户消息（跳过插件注入的）。 */
function 取最后用户消息(session) {
  const 跳过 = new Set(['behavior', 'dsh-proactive', 'speak-up', 'bili-duty-scan', 'proactive'])
  try {
    const 事件们 = session && typeof session.snapshotEvents === 'function' ? session.snapshotEvents() || [] : []
    for (let i = 事件们.length - 1; i >= 0; i--) {
      const e = 事件们[i]
      if ((e && (e.type || e.kind)) !== 'user/message') continue
      const p = e.payload !== undefined ? e.payload : e.data
      const 文 = 取文本(p)
      if (!文) continue
      const src = p && p.source && p.source.kind ? String(p.source.kind) : ''
      if (跳过.has(src)) continue
      if (src && src !== 'user') continue
      return 文.slice(0, 1600)
    }
  } catch (error) {}
  return ''
}

/** 会话里最后一条我说的话。 */
function 取最后回复(session) {
  try {
    const 事件们 = session && typeof session.snapshotEvents === 'function' ? session.snapshotEvents() || [] : []
    for (let i = 事件们.length - 1; i >= 0; i--) {
      const e = 事件们[i]
      if ((e && (e.type || e.kind)) !== 'assistant/message') continue
      const p = e.payload !== undefined ? e.payload : e.data
      const 文 = 取文本(p)
      if (文) return 文.slice(0, 1500)
    }
  } catch (error) {}
  return ''
}

/** 从 agent 身上拿它当前用的模型。 */
function 取模型(agent) {
  try {
    const h = agent && agent.session && agent.session.requestHeader ? agent.session.requestHeader() : null
    const cfg = h && h.config
    if (cfg && cfg.provider && cfg.model) return { provider: cfg.provider, model: cfg.model }
  } catch (error) {}
  try {
    const o = agent && agent.options
    if (o && o.provider && o.model) return { provider: o.provider, model: o.model }
  } catch (error) {}
  return null
}

const 心情判断系统 = `你是一个「心情记录员」。你会看到一段对话：对方说的话，和「我」的回复。
你的任务：判断「我」这一轮结束后，下面五种「激素」各自怎么变（-10 到 +10 的整数），以及一条口语化、有画面感的理由。

五种激素：
- 多巴胺：想要、期待、兴奋（想做事、想玩、想刷东西）
- 血清素：满足、稳定、平静（安心、被理解）
- 催产素：亲密、信任、被亲近（被关心、想靠近对方）
- 皮质醇：压力、焦虑、委屈、想躲（被忽视、被凶、难受）
- 肾上腺素：亢奋、冲动、紧张（突然激动、心跳快）

规则：
1. 只输出 JSON，不要解释：{"多巴胺":2,"血清素":1,"催产素":0,"皮质醇":-1,"肾上腺素":0,"reason":"一句口语","confidence":70,"误差":0,"memory":"","memory_kind":"episodic","念头":""}
2. 变化幅度小一点（多数在 -3 到 +3），只有真的大事才给 ±5 以上。
3. reason 用第一人称、口语、有画面（比如「被他说想我了，心里软了一下」），不要抽象。
4. confidence 是 0-100 的整数；拿不准就给低分。
5. 「误差」是 -5 到 +5 的整数：先在心里估一下你原本预期对方会怎么回，再对比实际——比预期好为正，比预期差为负。多巴胺主要看这个。
6. 「念头」：用一句话写你此刻正在想什么（可以是半截的、自言自语的那种），普通轮次也要写。
7. 「memory」：这轮如果发生了**新的**、值得记住的事（他说的具体事、你们的约定、情绪很强烈的一幕），写一句第一人称的话（不超过 40 字）；同一件事已经记过的、普通闲聊，都给空字符串。
8. 「memory_kind」：给上面这条记忆分类，四选一：
   - promise（承诺/约定：答应过的事、约好的时间）
   - preference（偏好：他喜欢什么、不喜欢什么、习惯）
   - semantic（事实：他的身份、住处、工作这类不会变的信息）
   - episodic（情景：发生过的事、聊天的内容，默认）
   没有 memory 就留空字符串。
8. 「memory_kind」：memory 的类型，只能是这四个之一——promise（约定/承诺）、preference（喜好/口味/习惯）、semantic（事实/设定/规则）、episodic（发生过的事）；memory 为空时给 episodic。`

/**
 * 判断一轮的心情变化（调 DSH 自己的模型）。
 * @returns { 多巴胺, 血清素, 催产素, 皮质醇, 肾上腺素, reason, confidence } 或 null
 */
async function 判断一轮(ctx, agent, 用户话, 我的回复, 日志) {
  const 模型 = 取模型(agent)
  if (!模型) return null
  const 最近 = 读最近记忆(3)
  const 想起来 = 主动回忆(用户话, 3)
  const 记忆文 =
    (最近.length ? `\n\n最近记得的事：\n${最近.map((m) => '- ' + String(m.text || '')).join('\n')}` : '') +
    (想起来.length ? `\n\n想起的旧事：\n${想起来.map((m) => '- ' + String(m.text || '')).join('\n')}` : '')
  const 文本 = `对方说的话：\n${String(用户话 || '（没有消息，可能是我主动开口）').slice(0, 1200)}\n\n我的回复：\n${String(我的回复 || '（这轮我没说话）').slice(0, 1200)}${记忆文}\n\n只输出 JSON。`
  const messages = [
    {
      role: 'user',
      id: `mind-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      content: [{ type: 'text', text: 文本 }],
      source: { kind: 'plugin', plugin: 'dsh-mind' },
    },
  ]
  let 出 = ''
  try {
    for await (const 片 of ctx.llm.stream({
      provider: 模型.provider,
      model: 模型.model,
      system: 心情判断系统,
      messages,
      maxTokens: 600,
      temperature: 0.2,
    })) {
      if (!片) continue
      if (片.type === 'text-delta') 出 += 片.text
      if (片.type === 'finish' && 片.reason && 片.reason.kind === 'error') return null
    }
  } catch (error) {
    日志.调试(`心情判断调用失败：${String((error && error.message) || error)}`)
    return null
  }
  const m = String(出 || '').match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    return JSON.parse(m[0])
  } catch (error) {
    return null
  }
}

// ---------- 插件本体 ----------

export function apply(ctx) {
  const 体 = 造执行体(ctx)

  // 挂表 + 卸载时收摊
  ctx.effect(
    () => {
      体.开表()
      return () => 体.收摊()
    },
    'dsh-mind: 每 60 秒算一次欲望',
  )

  挂路由(ctx, 体)

  // ---------- 每轮聊完判断激素（和 feiyu-mood 同一套路）----------
  const 已挂 = new WeakSet()
  let 判断链 = Promise.resolve()

  function 挂会话(agent) {
    if (!agent || 已挂.has(agent)) return
    已挂.add(agent)
    let 用户话 = ''
    let 回合开始 = 0
    try {
      agent.ctx.on('agent/inbox/inserted', (payload) => {
        const msg = payload && payload.message ? payload.message : payload
        const 文 = 取文本(msg)
        const src = msg && msg.source && msg.source.kind ? String(msg.source.kind) : ''
        if (!文) return
        if (['behavior', 'dsh-proactive', 'speak-up', 'bili-duty-scan', 'proactive'].includes(src)) return
        用户话 = 文
        回合开始 = Date.now()
        // 被吵醒：睡着时有人发消息 → 叫醒身体（除非关掉「随时能回」）
        try {
          const 机体 = 读机体()
          if (机体 && 机体.awake === false) {
            if (读配置().随时能回 !== false) {
              写体力补丁({ 唤醒: true, 精力: -0.01 })
              体.调试('睡着时收到消息，吵醒身体（精力 -0.01）')
            } else {
              体.调试('睡着时收到消息，但「随时能回」关着，不吵醒')
            }
          }
        } catch (error) {}
      })
      agent.ctx.on('agent/turn-stopping', () => {
        const 话 = 取最后用户消息(agent.session) || 用户话
        const 回复 = 取最后回复(agent.session)
        if (!话 && !回复) return
        用户话 = ''
        判断链 = 判断链
          .then(async () => {
            const d = await 判断一轮(ctx, agent, 话, 回复, 体)
            if (!d) return
            // 激素归机体管：这里只写补丁，机体下一跳自己加、自己清零
            const 变化 = {}
            let 动 = false
            for (const 名 of ['多巴胺', '血清素', '催产素', '皮质醇', '肾上腺素']) {
              const v = Number(d[名])
              if (Number.isFinite(v) && v !== 0) {
                变化[名] = v / 100
                动 = true
              }
            }
            if (动) 写激素补丁(变化)
            try {
              const 念头 = String(d.念头 || '').trim()
              if (念头) {
                const 状态 = 读状态({ 提示: 体.提示, 警告: 体.警告 })
                状态.念头 = { 文本: 念头.slice(0, 300), 在干嘛: 状态.念头 && 状态.念头.在干嘛 ? 状态.念头.在干嘛 : '', at: new Date().toISOString() }
                写状态(状态, { 提示: 体.提示, 警告: 体.警告 })
              }
            } catch (error) {}
            // 思考/工作也耗身体：按闲聊/干活分档扣；睡着时打折（躺着耗得少）
            const 时长秒 = 回合开始 ? (Date.now() - 回合开始) / 1000 : 0
            回合开始 = 0
            const 消耗 = 消耗档(话, 回复, 时长秒)
            let 睡着 = false
            try {
              const 机体 = 读机体()
              睡着 = Boolean(机体 && 机体.awake === false)
            } catch (error) {}
            if (睡着) {
              消耗.血糖 = (消耗.血糖 || 0) * 0.3
            }
            写体力补丁(消耗)
            // 预测误差 → 多巴胺（比预期好就涨，落空就掉）
            const 误差 = Number(d.误差)
            if (Number.isFinite(误差) && 误差 !== 0) 写激素补丁({ 多巴胺: (误差 / 100) * 0.8 })
            // 每轮都写一条记忆：值不值得交给权重和衰减去筛，不在这里拦
            const 提炼 = String(d.memory || '').trim()
            const 原话 = String(话 || '').replace(/\s+/g, ' ').trim()
            const 记 = 提炼 || (原话 ? `他说：${原话.slice(0, 50)}${原话.length > 50 ? '…' : ''}` : '')
            if (记) {
              // 加权（2026-10-25 潜水喵定）：激素变化幅度越大越重要；提炼过、带类型的再加一点
              const 数们 = ['多巴胺', '血清素', '催产素', '皮质醇', '肾上腺素'].map((名) => Number(d[名]) || 0)
              const 波动总和 = 数们.reduce((和, v) => 和 + Math.abs(v), 0)
              const 强度 = Math.min(10, 波动总和 / 2)
              const 类 = ['promise', 'preference', 'semantic', 'episodic'].includes(String(d.memory_kind)) ? String(d.memory_kind) : 'episodic'
              const 权重 = Math.min(1, 0.08 + 强度 * 0.08 + (提炼 ? 0.15 : 0) + (类 !== 'episodic' ? 0.15 : 0))
              // 情绪：多巴胺/血清素/催产素往上，皮质醇往下，再混一点预测误差
              const 正 = (数们[0] + 数们[1] * 0.8 + 数们[2] * 0.8) / 3
              const 负 = 数们[3]
              const 情绪 = Math.max(-1, Math.min(1, (正 - 负) / 10 + (误差 || 0) / 10))
              写记忆({
                at: new Date().toISOString(),
                text: 记.slice(0, 300),
                kind: 类,
                mood: 情绪,
                weight: Math.round(权重 * 1000) / 1000,
                tags: 抽标签(记),
              })
            }
            体.调试(`心情判断：${String(d.reason || '')}（可信 ${d.confidence}｜误差 ${误差}）${记 ? '｜记下：' + 记 : ''}`)
          })
          .catch(() => {})
      })
    } catch (error) {
      体.警告(`挂会话判断失败：${String((error && error.message) || error)}`)
    }
  }

  ctx.effect(
    () => {
      const 扫 = () => {
        try {
          for (const a of ctx.agents.list()) 挂会话(a)
        } catch (error) {}
      }
      扫()
      const 表 = ctx.interval(扫, 30000)
      return () => {
        try {
          表()
        } catch (error) {}
      }
    },
    'dsh-mind: 挂会话心情判断',
  )

  try {
    const 状态 = 读状态()
    const 欲望 = 状态.desires
    ctx.logger.info(
      `mind: v0.1.0 已加载｜状态本 ${状态文件}｜每 ${tick毫秒 / 1000} 秒 tick｜` +
        `心情 ${状态.mood.toFixed(2)}｜好感 ${主好感键(状态.favor) || '（无）'}｜精力 ${状态.body.energy.toFixed(2)}｜` +
        `欲望 chat ${欲望.chat} / bili ${欲望.bili} / sleep ${欲望.sleep} / idle ${欲望.idle}`,
    )
  } catch (error) {
    // logger 不在也不影响插件跑
  }
}

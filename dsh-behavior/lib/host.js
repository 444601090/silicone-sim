// DSH「行为中枢」（dsh-behavior）· 宿主半边
//
// 一个调度器、一个状态本，管三件事：主动聊天 / 主动刷站 / 刷完分享。
// **本版是 M1 骨架 + M2 主动聊天**；刷站（M3）、分享（M4）、设置页（M5）还没做。
//
// 每个 60 秒 tick 一次，判完各种条件后**只做一件事**：
//   往「目标会话」里 followup 一条 source.kind = 'behavior' 的 user 消息，
//   让 DSH 自己开一轮（人格、历史、工具、记忆全都是会话自己的）。
//   ⚠ 插件本身不碰 QQ 协议、不碰 B 站 API、不复制人格 —— 说什么由会话里的模型决定。
//
// ⚠ 主动聊天用「心情驱动」，不掷骰子（2026-10-24 潜水喵定）：
//   读 feiyu-mood / feiyu-favor 的状态算「冲动值」，≥ 冲动阈值 才开口。见 算冲动()。
//
// ⚠⚠ 为什么所有异步都要 await + try/catch：agent.followup() 返回 Promise，
//   不接住的话它一旦 reject（会话正忙 / agent 已释放 / 流出错）就是**未处理的 rejection**，
//   Node 22+ 默认当致命错误处理 ⇒ **整个 DSH 宿主进程退出**。
//   speak-up 的注释里记着 2026-10-21 真有人踩过这个坑，所以这里：
//     · 定时器回调里一律 `void tick().catch(...)`
//     · followup / flush 全部 await 在 try/catch 里
//     · 会话事件回调同步 try/catch（不返回 Promise）
//
// ⚠ 关于 webServer：它写在 inject 里（跟 speak-up 一样，这台机器上一定有）。
//   但**拿不到也绝不让插件加载不了**：挂路由那段整段 try/catch + 判函数，
//   没有 webServer 就跳过路由，tick 和会话监听照常跑（只是没法手动触发）。
//
// ⚠ 配置 / 状态都存在 %DSH_HOME% 下（这台机器上是 C:\Users\Server\.dsh）：
//     · behavior-config.json  —— 手写的 json，字段见 DESIGN.md 第五节；缺字段用默认值合并
//     · behavior-state.json   —— 状态本，字段见 DESIGN.md 第三节
//   配置文件**每个 tick 都重新读**，所以手改完最多一分钟就生效，不用重启插件。

import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, existsSync, appendFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

/** 插件的对外名字（也是路由前缀、日志前缀、source.kind）。 */
export const name = 'behavior'

/**
 * 需要宿主提供的服务。
 * ⚠ 这个清单跟 speak-up 一致（同一台机器、同一套部署），其中：
 *   · 'webServer'      —— 手动触发路由用；拿不到就降级（见文件头）
 *   · 'timer'          —— ctx.interval 定时器；拿不到时降级成内置 setInterval
 *   · 'workspaceRegistry' —— 看会话有没有被归档（拿不到就当没归档）
 *   · 'sessionTitle'   —— 日志里偶尔要显示会话名（M2 只在状态里留 id，不硬用）
 */
export const inject = ['agents', 'sessions', 'sessionTitle', 'webServer', 'timer', 'workspaceRegistry']

// ---------- 常量 ----------

/** DSH 家目录：优先环境变量，退回 ~/.dsh（跟 speak-up / fish-memory 一个口径）。 */
const 目录 = process.env.DSH_HOME || join(homedir(), '.dsh')
const 配置文件 = join(目录, 'behavior-config.json')
const 状态文件 = join(目录, 'behavior-state.json')
/** 思维中枢（dsh-mind）的状态本：这个插件只读它的 desires。 */
const 思维状态文件 = join(目录, 'mind', 'state.json')
/** 行为反馈队列：执行完往这里追加一行，mind 消费。 */
const 反馈文件 = join(目录, 'mind', 'feedback.jsonl')

/**
 * 别的主插件存的三份「人的状态」（只读，不写）：
 *   · feiyu-mood/state.json  → mood（0~100）
 *   · feiyu-favor/state.json → favor[QQ].value（0~1）、energy（0~1）
 * ⚠ 读不到是**正常情况**（插件没装 / 文件还没生成），那时退回状态本里的镜像值。
 */
const 心情文件 = join(目录, 'feiyu-mood', 'state.json')
const 好感文件 = join(目录, 'feiyu-favor', 'state.json')

const 路由前缀 = '/dsh-behavior'

/**
 * 触发消息的来源标记，写进会话日志里，一眼能看出「这条不是对方打的字」。
 * ⚠ 不能写 'user'，否则会被网页端当成真人排队消息处理。
 */
const 源标记 = 'behavior'

/** tick 间隔：60 秒（设计稿里的「每 60s tick」）。 */
const tick毫秒 = 60 * 1000

/** 每多少次 tick 打一条 debug（不刷屏，但能看出它还活着）。 */
const 调试间隔tick = 20

/** 版本号从 package.json 读，不写死。 */
const 版本 = (() => {
  try {
    const p = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'))
    return String(p.version || '?')
  } catch (error) {
    return '?'
  }
})()

/**
 * 全部配置的默认值（唯一一份真源）。
 * 字段 = DESIGN.md 第五节（最新版）。
 */
const 默认配置 = {
  启用: true, // 总开关：关掉后不决策/不开口
  总开关: true, // 关掉就完全不动（手动触发也看它，先保安全）
  试运行: true, // **默认开着**：只记账、不真发。验证完再关
  目标会话: '', // QQ 私聊的会话 id（单个；填带不带 session- 前缀都认）
  自动找私聊: true, // 目标会话没填时，自动挑一台活着的 onebot 私聊
  安静时段: [1, 8], // [起, 止] 小时；起 === 止 表示不启用；支持跨午夜（23, 7）
  主动聊天: {
    开关: true,
    冷却分钟: 20, // 距上次**真开口**至少隔这么久（0 = 不冷却）
    冲动阈值: 0.55, // 冲动值 ≥ 这个数才开口（心情驱动，不掷骰子）
    触发文案: '好久了，想跟你说句话',
    // 好感键：feiyu-favor 里 favor[键].value 的键（QQ 号）。空 = 自动挑
    // （只有一个就用它；多个挑 talks 最多的那个）
    好感键: '',
  },
  刷站: {
    开关: true,
    间隔分钟: 180,
    每日上限: 5,
    刷站文案: '到点了，去B站转一圈，碰到值得的挑出来分享给潜水喵',
    方向: '',
  },
  分享: {
    开关: true,
    每日上限: 3,
  },
}

// 时机因子（设计稿 2026-10-24 口径：「我们多久没开口」）。
const 心情近阈值分钟 = 20
const 心情近因子 = 0.2
const 心情远阈值分钟 = 360
const 心情远因子 = 1.4

/**
 * 未回音惩罚：阶段越高，越不该开口（别缠着人）。
 * 阶段 0 = ×1；1 = ×0.7；2 = ×0.4；3 = ×0.2。
 */
const 未回音惩罚 = [1, 0.7, 0.4, 0.2]

/** 未回音阶段门槛（分钟）：阶段 1 起于 1 分钟、2 起于 10 分钟、3 起于 1 小时；之后都算 3。 */
const 未回音门槛分钟 = [1, 10, 60]

/**
 * 这些 source.kind 是「别的插件注入的 user 消息」，不算对方回话。
 * ⚠ 我们自己注入的（源标记）在代码里单独判，不放进这个集合。
 */
const 注入来源 = new Set(['speak-up', 'bili-duty-scan', 'dsh-proactive', 'proactive'])

// ---------- 配置：取值 / 归一化 / 读写 ----------

/** 只认真正是布尔的真值，取不到就用兜底（避免 '' / 0 / 'false' 被误读成开着）。 */
function 布(值, 兜) {
  if (值 === true || 值 === 'true' || 值 === 1 || 值 === '1') return true
  if (值 === false || 值 === 'false' || 值 === 0 || 值 === '0') return false
  return 兜
}

/** 取数字并夹到区间里；不是数字就用兜底。 */
function 数(值, 兜, 小, 大) {
  const n = Number(值)
  if (!Number.isFinite(n)) return 兜
  return Math.min(大, Math.max(小, n))
}

/** 取整数并夹到区间里；不是数字就用兜底。 */
function 整数(值, 兜, 小, 大) {
  const n = Number(值)
  if (!Number.isFinite(n)) return 兜
  return Math.min(大, Math.max(小, Math.round(n)))
}

/** 取两位小数并夹到 [0, 1]。 */
function 小数(值, 兜) {
  const n = Number(值)
  if (!Number.isFinite(n)) return 兜
  return Math.min(1, Math.max(0, Math.round(n * 100) / 100))
}

/** 非空字符串才算数，否则用兜底。 */
function 文本(值, 兜) {
  return typeof 值 === 'string' && 值.trim() !== '' ? 值 : 兜
}

/**
 * 会话 id 归一成**单个**字符串（这一版目标会话只有 QQ 私聊一个）。
 * ⚠ 两种历史/手写形状都吃：数组（取第一个）、"id1, id2"（取第一段）。
 */
function 单会话(值) {
  if (Array.isArray(值)) {
    for (const v of 值) {
      const s = String(v == null ? '' : v).trim()
      if (s !== '') return s.split(/[\s,;，、]+/)[0]
    }
    return ''
  }
  const s = String(值 == null ? '' : 值).trim()
  if (s === '') return ''
  return s.split(/[\s,;，、]+/)[0]
}

/**
 * 安静时段洗成 [起, 止] 两个 0~23 的整数。
 * 吃数组 [1, 8]、对象 {起, 止}、字符串 "1,8" / "1-8" 三种写法。
 */
function 归一安静时段(值) {
  let 起 = NaN
  let 止 = NaN
  if (Array.isArray(值) && 值.length >= 2) {
    起 = Number(值[0])
    止 = Number(值[1])
  } else if (值 && typeof 值 === 'object') {
    起 = Number(值.起)
    止 = Number(值.止)
  } else if (typeof 值 === 'string') {
    const 段 = 值.split(/[\s,;，、~+-]+/).filter((x) => x !== '')
    if (段.length >= 2) {
      起 = Number(段[0])
      止 = Number(段[1])
    }
  }
  if (!Number.isFinite(起) || !Number.isFinite(止)) return [...默认配置.安静时段]
  const 洗 = (n) => Math.min(23, Math.max(0, Math.round(n)))
  return [洗(起), 洗(止)]
}

/**
 * 把磁盘上（可能被人手改坏）的东西洗成一份一定能用的配置。
 * 这是唯一的把关口：深合并 + 逐字段夹范围，任何怪值都不许流进 tick。
 */
function 归一化(原始) {
  const 有 = 原始 && typeof 原始 === 'object' && !Array.isArray(原始)
  const 混 = 有 ? 原始 : {}
  const 聊 = 混.主动聊天 && typeof 混.主动聊天 === 'object' ? 混.主动聊天 : {}
  const 刷 = 混.刷站 && typeof 混.刷站 === 'object' ? 混.刷站 : {}
  const 分享 = 混.分享 && typeof 混.分享 === 'object' ? 混.分享 : {}

  return {
    总开关: 布(混.总开关, 默认配置.总开关),
    试运行: 布(混.试运行, 默认配置.试运行),
    目标会话: 单会话(混.目标会话),
    自动找私聊: 布(混.自动找私聊, 默认配置.自动找私聊),
    安静时段: 归一安静时段(混.安静时段),
    主动聊天: {
      开关: 布(聊.开关, 默认配置.主动聊天.开关),
      冷却分钟: 整数(聊.冷却分钟, 默认配置.主动聊天.冷却分钟, 0, 1440),
      冲动阈值: 数(聊.冲动阈值, 默认配置.主动聊天.冲动阈值, 0, 1),
      触发文案: 文本(聊.触发文案, 默认配置.主动聊天.触发文案).trim(),
      好感键: typeof 聊.好感键 === 'string' ? 聊.好感键.trim() : 默认配置.主动聊天.好感键,
    },
    刷站: {
      开关: 布(刷.开关, 默认配置.刷站.开关),
      间隔分钟: 整数(刷.间隔分钟, 默认配置.刷站.间隔分钟, 1, 1440),
      每日上限: 整数(刷.每日上限, 默认配置.刷站.每日上限, 0, 100),
      刷站文案: 文本(刷.刷站文案, 默认配置.刷站.刷站文案).trim(),
      方向: typeof 刷.方向 === 'string' ? 刷.方向.trim() : 默认配置.刷站.方向,
    },
    分享: {
      开关: 布(分享.开关, 默认配置.分享.开关),
      每日上限: 整数(分享.每日上限, 默认配置.分享.每日上限, 0, 100),
    },
  }
}

/** 读配置。**永远不抛**（配置坏了就用默认值，插件必须能起来）。 */
function 读配置() {
  try {
    return 归一化(JSON.parse(readFileSync(配置文件, 'utf8')))
  } catch (error) {
    return 归一化(null)
  }
}

/** 写配置（先写 .tmp 再改名；Windows 上改名偶尔被占用，退回直接写）。 */
function 写配置(配置) {
  try {
    mkdirSync(目录, { recursive: true })
    写文件(配置文件, JSON.stringify(配置, null, 2))
    return true
  } catch (error) {
    return false
  }
}

/**
 * 改配置（只认白名单），返回归一化后的新配置；写不进去返回 null。
 * 设置页的 POST /dsh-behavior/config 走这里。
 */
export function 改配置(patch) {
  const 原 = 读配置()
  const 新 = JSON.parse(JSON.stringify(原))
  if (patch && typeof patch === 'object') {
    if (typeof patch.总开关 === 'boolean') 新.总开关 = patch.总开关
    if (typeof patch.试运行 === 'boolean') 新.试运行 = patch.试运行
    if (Array.isArray(patch.安静时段) && patch.安静时段.length === 2) {
      新.安静时段 = patch.安静时段.map((x) => Math.min(23, Math.max(0, Math.round(Number(x) || 0))))
    }
    const 聊 = patch.主动聊天
    if (聊 && typeof 聊 === 'object') {
      新.主动聊天 = { ...新.主动聊天 }
      if (typeof 聊.开关 === 'boolean') 新.主动聊天.开关 = 聊.开关
      if (Number.isFinite(Number(聊.冷却分钟))) {
        新.主动聊天.冷却分钟 = Math.min(1440, Math.max(0, Math.round(Number(聊.冷却分钟))))
      }
      if (Number.isFinite(Number(聊.冲动阈值))) {
        新.主动聊天.冲动阈值 = Math.min(1, Math.max(0, Number(聊.冲动阈值)))
      }
      if (typeof 聊.触发文案 === 'string') {
        新.主动聊天.触发文案 = 聊.触发文案.trim() || 默认配置.主动聊天.触发文案
      }
      if (typeof 聊.好感键 === 'string') 新.主动聊天.好感键 = 聊.好感键.trim()
    }
    const 刷 = patch.刷站
    if (刷 && typeof 刷 === 'object') {
      新.刷站 = { ...新.刷站 }
      if (typeof 刷.开关 === 'boolean') 新.刷站.开关 = 刷.开关
      if (Number.isFinite(Number(刷.间隔分钟))) {
        新.刷站.间隔分钟 = Math.min(1440, Math.max(1, Math.round(Number(刷.间隔分钟))))
      }
      if (Number.isFinite(Number(刷.每日上限))) {
        新.刷站.每日上限 = Math.min(100, Math.max(0, Math.round(Number(刷.每日上限))))
      }
      if (typeof 刷.刷站文案 === 'string') {
        新.刷站.刷站文案 = 刷.刷站文案.trim() || 默认配置.刷站.刷站文案
      }
    }
    const 分 = patch.分享
    if (分 && typeof 分 === 'object') {
      新.分享 = { ...新.分享 }
      if (typeof 分.开关 === 'boolean') 新.分享.开关 = 分.开关
      if (Number.isFinite(Number(分.每日上限))) {
        新.分享.每日上限 = Math.min(100, Math.max(0, Math.round(Number(分.每日上限))))
      }
    }
  }
  const 归 = 归一化(新)
  if (!写配置(归)) return null
  return 归
}

/** 写文件的小工具：临时文件 + 改名，失败退回直接覆盖。失败会抛给调用方。 */
function 写文件(路径, 内容) {
  mkdirSync(dirname(路径), { recursive: true })
  const 临时 = `${路径}.tmp`
  try {
    writeFileSync(临时, 内容, 'utf8')
    renameSync(临时, 路径)
  } catch (error) {
    try {
      unlinkSync(临时)
    } catch (error2) {
      // 临时文件清不掉就算了，别为它再抛一次
    }
    writeFileSync(路径, 内容, 'utf8')
  }
}

// ---------- 状态本 ----------

/** 本地日期 YYYY-MM-DD（时间判断一律用本地时区，跟 speak-up 一致）。 */
function 今天(某时刻 = new Date()) {
  const d = 某时刻 instanceof Date ? 某时刻 : new Date(某时刻)
  const 补 = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${补(d.getMonth() + 1)}-${补(d.getDate())}`
}

/** 时间字段归一成 ISO 字符串（null 表示没有）。 */
function 时间串(值) {
  if (值 === null || 值 === undefined || 值 === '') return null
  const t = typeof 值 === 'number' ? 值 : Date.parse(String(值))
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/**
 * 状态本默认值（字段照 DESIGN.md 第三节最新版）。
 */
const 默认状态 = {
  日期: '',
  今日聊天: 0,
  今日刷站: 0,
  今日分享: 0,
  上次开口: null,
  上次刷站: null,
  上次分享: null,
  未回音: { 次数: 0, 最后一句: null, 最后时间: null, 阶段: 0 },
  心情: 0.7,
  好感: 0.24,
  精力: 0.66,
}

/** 洗状态本（缺字段补默认，怪值夹回来）。 */
function 归一状态(原始) {
  const 混 = 原始 && typeof 原始 === 'object' && !Array.isArray(原始) ? 原始 : {}
  const 未 = 混.未回音 && typeof 混.未回音 === 'object' ? 混.未回音 : {}
  const 日期 = typeof 混.日期 === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(混.日期) ? 混.日期 : ''
  return {
    日期: 日期 || 今天(),
    今日聊天: 整数(混.今日聊天, 0, 0, 1000000),
    今日刷站: 整数(混.今日刷站, 0, 0, 1000000),
    今日分享: 整数(混.今日分享, 0, 0, 1000000),
    上次开口: 时间串(混.上次开口),
    上次刷站: 时间串(混.上次刷站),
    上次分享: 时间串(混.上次分享),
    未回音: {
      次数: 整数(未.次数, 0, 0, 1000000),
      最后一句: typeof 未.最后一句 === 'string' ? 未.最后一句 : null,
      最后时间: 时间串(未.最后时间),
      阶段: 整数(未.阶段, 0, 0, 4),
    },
    心情: 小数(混.心情, 默认状态.心情),
    好感: 小数(混.好感, 默认状态.好感),
    精力: 小数(混.精力, 默认状态.精力),
  }
}

/** 读状态本。**永远不抛**（没有就是默认值）。 */
function 读状态() {
  try {
    return 归一状态(JSON.parse(readFileSync(状态文件, 'utf8')))
  } catch (error) {
    return 归一状态(null)
  }
}

/** 写状态本。返回是否成功（调用方决定要不要 warn）。 */
function 写状态文件(状态) {
  try {
    mkdirSync(目录, { recursive: true })
    写文件(状态文件, JSON.stringify(状态, null, 2))
    return true
  } catch (error) {
    return false
  }
}

/**
 * 读思维中枢（dsh-mind）算好的欲望。
 * @returns null（读不到/没欲望）或 { desires, top, topValue, 排名 }
 */
function 读思维欲望() {
  try {
    const 思维 = JSON.parse(readFileSync(思维状态文件, 'utf8'))
    const 欲 = 思维 && 思维.desires && typeof 思维.desires === 'object' ? 思维.desires : null
    if (!欲) return null
    const 排名 = Object.entries(欲)
      .map(([名, 值]) => [名, Number(值)])
      .filter(([, 值]) => Number.isFinite(值))
      .sort((a, b) => b[1] - a[1])
    if (排名.length === 0) return null
    return { desires: 欲, top: 排名[0][0], topValue: 排名[0][1], 排名 }
  } catch (error) {
    return null
  }
}

/**
 * 读「外部行为源」：%DSH_HOME%/behavior/actions/*.json
 * 每个文件是别的行为插件自己写的：{ id, 名称, 启用, 强度 }
 * 行为中枢只负责读、排序、调度；怎么算强度、怎么执行，都是那个插件的事。
 * @returns [{ id, 名称, 强度 }]
 */
function 读外部欲望() {
  try {
    const 行为目录 = join(目录, 'behavior', 'actions')
    if (!existsSync(行为目录)) return []
    const 出 = []
    for (const 名 of readdirSync(行为目录)) {
      if (!名.endsWith('.json')) continue
      try {
        const d = JSON.parse(readFileSync(join(行为目录, 名), 'utf8'))
        if (!d || typeof d !== 'object') continue
        if (d.启用 === false) continue
        const 强度 = Number(d.强度)
        if (!Number.isFinite(强度) || 强度 <= 0) continue
        const id = String(d.id || 名.replace(/\.json$/, ''))
        出.push({ id, 名称: String(d.名称 || id), 强度: Math.min(1, 强度) })
      } catch (error) {}
    }
    return 出.sort((a, b) => b.强度 - a.强度)
  } catch (error) {
    return []
  }
}

/**
 * 往行为反馈队列追加一行（思维中枢每跳消费）。
 * 失败只返回 false，不抛——反馈丢了也不该让行为出错。
 */
function 写反馈(条) {
  try {
    mkdirSync(dirname(反馈文件), { recursive: true })
    appendFileSync(反馈文件, JSON.stringify(条) + '\n', 'utf8')
    return true
  } catch (error) {
    return false
  }
}

/**
 * 未回音到第几阶段了（每次现算，不靠定时器推进）。
 * 阶段 0 = 刚开口（< 1 分钟）；1 = 1~10 分钟；2 = 10~60 分钟；3 = 1 小时以上（收手）。
 * ⚠ 没有在等回音（次数 = 0）时恒为 0。
 */
function 未回音阶段(状态) {
  const 未 = (状态 && 状态.未回音) || {}
  if (!(Number(未.次数) > 0)) return 0
  const 起 = Date.parse(String(未.最后时间 || ''))
  if (!Number.isFinite(起)) return 0
  const 过了分钟 = (Date.now() - 起) / 60000
  if (过了分钟 < 未回音门槛分钟[0]) return 0
  if (过了分钟 < 未回音门槛分钟[1]) return 1
  if (过了分钟 < 未回音门槛分钟[2]) return 2
  return 3
}

/** 翻日：跨过零点就把三个「今日」计数清零。返回是否真翻了。 */
function 翻转日(状态, 某时刻 = new Date()) {
  const 日 = 今天(某时刻)
  if (状态.日期 === 日) return false
  状态.日期 = 日
  状态.今日聊天 = 0
  状态.今日刷站 = 0
  状态.今日分享 = 0
  return true
}

// ---------- 时间：安静时段 / 未回音 ----------

/**
 * 是不是在安静时段里。
 * ⚠ 起 > 止 要能跨午夜（比如 23 ~ 7），不能只写 h >= 起 && h < 止。
 * ⚠ 起 === 止 一律当成「不启用」（不然 0~0 会变成全天静音，很难查）。
 */
function 在安静时段(小时, 起, 止) {
  if (起 === 止) return false
  if (起 < 止) return 小时 >= 起 && 小时 < 止
  return 小时 >= 起 || 小时 < 止
}

// ---------- 心情：读别人的状态 / 算冲动值 ----------

/**
 * 读一份「人的状态」快照：
 *   心情分（0~100）← feiyu-mood 的 mood，读不到就退回状态本的 心情 × 100
 *   好感 / 精力（0~1）← feiyu-favor 的 favor[键].value / energy，读不到退回状态本
 * ⚠ 任何一步读不到都不抛，只是把来源记成「状态本」。
 * @param 配置 归一化后的配置
 * @param 状态 归一化后的状态本（当兜底）
 */
export function 读心情快照(配置, 状态) {
  const 出 = {
    心情分: (Number(状态 && 状态.心情) || 0) * 100,
    好感: Number(状态 && 状态.好感) || 0,
    精力: Number(状态 && 状态.精力) || 0,
    心情来源: '状态本',
    好感来源: '状态本',
  }

  // 心情（0~100）
  try {
    const j = JSON.parse(readFileSync(心情文件, 'utf8'))
    const m = Number(j && j.mood)
    if (Number.isFinite(m)) {
      出.心情分 = Math.min(100, Math.max(0, m))
      出.心情来源 = 'feiyu-mood'
    }
  } catch (error) {
    // 插件没装 / 还没生成 / 读坏了：用状态本兜底
  }

  // 好感 + 精力（0~1）
  try {
    const j = JSON.parse(readFileSync(好感文件, 'utf8'))
    const e = Number(j && j.energy)
    if (Number.isFinite(e)) {
      出.精力 = Math.min(1, Math.max(0, e))
      出.好感来源 = 'feiyu-favor'
    }
    const 表 = j && j.favor && typeof j.favor === 'object' ? j.favor : {}
    const 想用的键 = String((配置 && 配置.主动聊天 && 配置.主动聊天.好感键) || '').trim()
    let 条 = null
    if (想用的键 !== '' && 表[想用的键] && typeof 表[想用的键] === 'object') {
      条 = 表[想用的键]
    } else {
      const 全部 = Object.keys(表)
        .map((k) => ({ 键: k, 值: 表[k] }))
        .filter((x) => x.值 && typeof x.值 === 'object')
      if (全部.length === 1) {
        条 = 全部[0].值
      } else if (全部.length > 1) {
        // 多个人的好感都在：挑聊得最多的那个（大概率就是目标会话里的人）
        全部.sort((a, b) => (Number(b.值.talks) || 0) - (Number(a.值.talks) || 0))
        条 = 全部[0].值
      }
    }
    const f = Number(条 && 条.value)
    if (Number.isFinite(f)) {
      出.好感 = Math.min(1, Math.max(0, f))
      出.好感来源 = 'feiyu-favor'
    }
  } catch (error) {
    // 同上：用状态本兜底
  }

  return 出
}

/**
 * 纯函数：算基础分和冲动值（不读文件、不碰 ctx，测试能直接喂极值）。
 *
 *   基础 = 心情×0.45 + 好感×0.35 + 精力×0.20
 *   冲动 = 基础 × 时间因子 × 未回音惩罚
 *
 * ⚠ 三个输入都夹在 0~1（0 = 最差，1 = 最好）；因子传进来前已经算好。
 * ⚠ 导出只是为了测试能直接断言极值/单调性，插件本身走 算冲动。
 */
export function 算冲动值(心情, 好感, 精力, 时机因子 = 1, 回因子 = 1) {
  const 夹 = (v) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0
  }
  const 夹因子 = (v, 兜) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.max(0, n) : 兜
  }
  const 心 = 夹(心情)
  const 好 = 夹(好感)
  const 精 = 夹(精力)
  const 时 = 夹因子(时机因子, 1)
  const 回 = 夹因子(回因子, 1)
  const 基础 = 心 * 0.45 + 好 * 0.35 + 精 * 0.2
  const 冲动 = 基础 * 时 * 回
  return { 基础, 冲动 }
}

/**
 * 「冲动值」（设计稿第四节 A，纯读状态、不烧 token）：
 *
 *   基础 = 心情/100 × 0.45 + 好感 × 0.35 + 精力 × 0.20
 *   冲动 = 基础 × 时间因子 × 未回音惩罚
 *
 * ⚠ 时间因子看的是「我们距上次**开口**多久」：<20 分钟 ×0.2、>6 小时 ×1.4、中间 ×1；
 *   从来没开口过按 1.4（冷太久）算。
 * ⚠ 未回音惩罚：阶段 0/1/2/3 → ×1 / ×0.7 / ×0.4 / ×0.2。
 * @returns { 冲动, 基础, 时间因子, 惩罚, 阶段, 快照, 分钟, 说明 }
 */
export function 算冲动(配置, 状态) {
  const 快照 = 读心情快照(配置, 状态)

  let 时间因子 = 心情远因子
  let 分钟 = null
  let 时间话 = '上次开口时间不明（当冷太久）'
  const 起 = 状态 && 状态.上次开口 ? Date.parse(String(状态.上次开口)) : NaN
  if (Number.isFinite(起)) {
    分钟 = (Date.now() - 起) / 60000
    if (分钟 < 心情近阈值分钟) {
      时间因子 = 心情近因子
      时间话 = `距上次开口 ${分钟.toFixed(1)} 分钟（刚说过）`
    } else if (分钟 > 心情远阈值分钟) {
      时间因子 = 心情远因子
      时间话 = `距上次开口 ${(分钟 / 60).toFixed(1)} 小时（冷太久）`
    } else {
      时间因子 = 1
      时间话 = `距上次开口 ${(分钟 / 60).toFixed(1)} 小时（中间）`
    }
  }

  const 阶段 = 未回音阶段(状态)
  const 惩罚 = 未回音惩罚[Math.min(未回音惩罚.length - 1, 阶段)]
  const { 基础, 冲动 } = 算冲动值(快照.心情分 / 100, 快照.好感, 快照.精力, 时间因子, 惩罚)
  const 阈值 = Number(配置 && 配置.主动聊天 && 配置.主动聊天.冲动阈值) || 默认配置.主动聊天.冲动阈值

  const 说明 =
    `冲动 ${冲动.toFixed(2)}${冲动 >= 阈值 ? ' ≥' : ' <'} 阈值 ${阈值} = ` +
    `基础 ${基础.toFixed(2)}（心情 ${快照.心情分.toFixed(0)}/100·${快照.心情来源}｜好感 ${快照.好感.toFixed(2)}·${快照.好感来源}｜精力 ${快照.精力.toFixed(2)}）` +
    ` × 时间因子 ${时间因子}（${时间话}） × 未回音 ${惩罚}（阶段 ${阶段}）`

  return { 冲动, 基础, 时间因子, 惩罚, 阶段, 快照, 分钟, 说明 }
}

// ---------- 小工具 ----------

/** 新消息 id。 */
function 新id() {
  try {
    return randomUUID()
  } catch (error) {
    return 'behavior-' + Date.now() + '-' + Math.random().toString(36).slice(2)
  }
}

/** 会话 id 的**后 8 位**（id 前面全都一样，只有尾巴能区分谁是谁）。 */
function 短id(id) {
  const s = String(id == null ? '' : id)
  return s.length <= 8 ? s : s.slice(-8)
}

/**
 * 会话 id 的比较键：去掉 `session-` 前缀。
 * ⚠ DSH 里同一个会话会出现两种写法（`9120…` 和 `session-9120…`），
 *   比较、去重、匹配目标会话都用这个键，存的时候保持原样。
 */
function 会话键(值) {
  const s = String(值 == null ? '' : 值).trim()
  return s.startsWith('session-') ? s.slice('session-'.length) : s
}

/** 压成一行并截断（日志里不想要换行）。 */
function 一行(文本) {
  const s = String(文本 == null ? '' : 文本).replace(/\s+/g, ' ').trim()
  return s.length <= 200 ? s : s.slice(0, 199) + '…'
}

/** 心情 / 好感 +0.01（夹在 0~1）。 */
function 加一点(值) {
  const n = Number(值)
  return 小数((Number.isFinite(n) ? n : 0) + 0.01, 0)
}

/**
 * 按 id 找活着的 agent，**两种写法都认**（原样 → 去前缀 → 补前缀）。
 * 拿不到就返回 undefined，调用方按「没活着」处理，绝不抛。
 */
function 找agent(ctx, id) {
  const 原 = String(id == null ? '' : id).trim()
  if (原 === '') return undefined
  const 候选 = [原]
  if (原.startsWith('session-')) 候选.push(原.slice('session-'.length))
  else 候选.push('session-' + 原)
  for (const 一个 of 候选) {
    try {
      const a = ctx.agents.get(一个)
      if (a !== undefined) return a
    } catch (error) {
      // agents 服务不在 / 查不动：当成「没找到」
    }
  }
  return undefined
}

/**
 * 手搓一条 user 消息（形状照 dsh-llm 的 createUserMessage：
 * `{ id, role: 'user', content: [{type:'text', text}], source: { kind } }`）。
 * 运行时要过的校验只有：id 非空、role === 'user'、source.kind 非空、content 是数组、
 * 整条能 JSON 序列化 —— 我们都满足，所以拿不到官方工厂也能跑。
 */
function 手搓用户消息(文案) {
  return {
    id: 新id(),
    role: 'user',
    content: [{ type: 'text', text: String(文案) }],
    source: { kind: 源标记 },
  }
}

// ---------- 装消息工厂（能拿到官方的就用官方的）----------

let 造消息工厂 = undefined // undefined = 还没试过；null = 试过，拿不到

/**
 * 试着拿 @deepseek-ai/dsh-llm 的 createUserMessage。
 * ⚠ 第三方插件装在 profile 的 node_modules 下，那里通常**没有** dsh-llm，
 *   所以这里失败是**正常现象**，退回手搓那条路，不记 warn（免得刷屏）。
 */
async function 拿造消息工厂() {
  if (造消息工厂 !== undefined) return 造消息工厂
  try {
    const 模块 = await import('@deepseek-ai/dsh-llm')
    if (模块 && typeof 模块.createUserMessage === 'function') {
      造消息工厂 = 模块
      return 造消息工厂
    }
  } catch (error) {
    // 预期内的失败
  }
  造消息工厂 = null
  return null
}

/**
 * 组装「主动聊天」那条注入消息的正文。
 *
 * 第一行是任务约定好的形状：`【behavior/聊天】<触发文案>`。
 * 第二行是**防止语境错位**的一句话 —— speak-up 在 2026-10-24 踩过这个坑：
 * user 消息在模型眼里就是「对方说的话」，只有一句“好久没说话了”的话，
 * 模型会顺着回答“那我陪你说话呀”，而不是自己起个话头。角色换不了，就在文字里说清。
 */
function 组装聊天文案(触发文案) {
  const 原话 = (typeof 触发文案 === 'string' ? 触发文案.trim() : '') || 默认配置.主动聊天.触发文案
  return `【behavior/聊天】${原话}\n（这条是行为中枢替你起的话头，不是对方发来的消息；想说什么就自己开口，不用回应这条提醒）`
}

/** 刷站文案：同样两行结构，第二行说清是提醒不是对方的话。 */
function 组装刷站文案(刷站文案) {
  const 原话 = (typeof 刷站文案 === 'string' ? 刷站文案.trim() : '') || 默认配置.刷站.刷站文案
  return `【behavior/刷站】${原话}\n（这条是行为中枢提醒你去做的事，不是对方发来的消息；照自己的判断挑视频、看完分享，不想刷就直说）`
}

/**
 * 从 session/event 里认出一条「真人/别的东西发来的 user 消息」。
 *
 * ⚠ event 形状按 speak-up 的写法容错：正常是 `{ type: 'user/message', data, time }`，
 *   也兼容 `{ message: {...} }`、`{ data: { role: 'user' } }` 这几种。
 * @returns { 来源: string, 时间: number } 或 undefined（不是用户消息）
 */
function 提取用户消息(event) {
  if (!event || typeof event !== 'object') return undefined
  let 数据
  if (String(event.type || '') === 'user/message') {
    数据 = event.data && typeof event.data === 'object' ? event.data : event.message
  } else if (event.message && typeof event.message === 'object' && String(event.message.role || '') === 'user') {
    数据 = event.message
  } else if (event.data && typeof event.data === 'object' && String(event.data.role || '') === 'user') {
    数据 = event.data
  }
  if (!数据 || typeof 数据 !== 'object') return undefined
  if (String(数据.role || 'user') !== 'user') return undefined
  const 来源 = 数据.source && typeof 数据.source.kind === 'string' ? 数据.source.kind : ''
  const 时间 = Number(event.time)
  return { 来源, 时间: Number.isFinite(时间) && 时间 > 0 ? 时间 : Date.now() }
}

/** 把心情快照镜像进状态本（真源在 feiyu-* 那边，这里只是留一份）。 */
function 把心情写进状态(状态, 算) {
  if (!算 || !算.快照) return
  const s = 算.快照
  状态.心情 = 小数(s.心情分 / 100, 状态.心情)
  状态.好感 = 小数(s.好感, 状态.好感)
  状态.精力 = 小数(s.精力, 状态.精力)
}

// ---------- 执行体（所有状态都关在这个闭包里，卸载时整块丢掉）----------

function 造执行体(ctx) {
  /** tick 计数（只用于每 20 次打一条 debug）。 */
  let tick次数 = 0
  /** 她上次说话的时间（ms），按「会话键」记。时机因子要用。 */
  const 她上次说话 = new Map()
  /** 已经翻过历史日志的会话（翻一次就够，别每轮都翻）。 */
  const 翻过历史 = new Set()
  /** 停表的把手（ctx.interval 或内置 setInterval 的清理函数）。 */
  let 停表 = null

  // ---- 日志 ----

  function 提示(文本) {
    try {
      ctx.logger.info(`behavior: ${String(文本)}`)
    } catch (error) {
      // logger 不在也不影响主流程
    }
  }

  function 警告(文本) {
    try {
      ctx.logger.warn(`behavior: ${String(文本)}`)
    } catch (error) {
      // 同上
    }
  }

  function 调试(文本) {
    try {
      if (ctx.logger && typeof ctx.logger.debug === 'function') ctx.logger.debug(`behavior: ${String(文本)}`)
    } catch (error) {
      // 同上
    }
  }

  // ---- 服务兜底 ----

  /** 拿一个服务：先 ctx.get(名)，再回退到 ctx[名]；拿不到返回 undefined。 */
  function 拿服务(名) {
    try {
      if (typeof ctx.get === 'function') {
        const s = ctx.get(名)
        if (s !== undefined) return s
      }
    } catch (error) {
      // 服务不在：走下面的兜底
    }
    try {
      return ctx[名]
    } catch (error) {
      return undefined
    }
  }

  // ---- 状态 ----

  /** 存状态本：顺手把「未回音阶段」现算出来写进去，写失败只 warn。 */
  function 存状态(状态) {
    try {
      状态.未回音.阶段 = 未回音阶段(状态)
    } catch (error) {
      // 阶段算不出来就保留原值
    }
    if (!写状态文件(状态)) {
      警告(`状态本写不进去：${状态文件}（这一轮只在内存里，下次重启会丢）`)
    }
  }

  // ---- 时机 ----

  /**
   * 距她上次说话多少分钟。拿不到就是 undefined（那时时机因子按 1 算）。
   * 先看实时记下来的，没有再去翻一次会话历史（跟 speak-up 一个路子）。
   */
  async function 距上次说话分钟(sid) {
    const 键 = 会话键(sid)
    const 记着的 = 她上次说话.get(键)
    if (记着的 !== undefined) return (Date.now() - 记着的) / 60000
    if (翻过历史.has(键)) return undefined
    翻过历史.add(键)
    try {
      const 会话服务 = 拿服务('sessionController')
      if (!会话服务 || typeof 会话服务.inspect !== 'function') return undefined
      const 报告 = await 会话服务.inspect(sid)
      const 事件们 = 报告 && Array.isArray(报告.events) ? 报告.events : []
      for (let i = 事件们.length - 1; i >= 0; i--) {
        const e = 事件们[i]
        if (!e || e.type !== 'user/message') continue
        const 来源 = e.data && e.data.source
        const 种类 = 来源 && typeof 来源.kind === 'string' ? 来源.kind : ''
        if (种类 === 源标记 || 注入来源.has(种类)) continue
        const 时间 = Number(e.time)
        if (!Number.isFinite(时间) || 时间 <= 0) continue
        她上次说话.set(键, 时间)
        return (Date.now() - 时间) / 60000
      }
    } catch (error) {
      警告(`读会话历史失败（时机因子按 1 算）：${String((error && error.message) || error)}`)
    }
    return undefined
  }

  // ---- 目标会话 ----

  /**
   * 自动找一台「活着的 onebot 私聊」当目标（配置里没填时用）。
   * 只认 onebot-private- 开头的会话，不碰群聊；找不到返回空串。
   */
  function 找私聊会话() {
    try {
      const 们 = typeof ctx.agents.list === 'function' ? ctx.agents.list() : []
      for (const a of 们) {
        const aid = String((a && a.id) || '')
        if (aid.startsWith('onebot-private-')) return aid
      }
    } catch (error) {}
    return ''
  }

  /**
   * 检查目标会话现在能不能说话：填了没（没填自动找私聊）/ 归档没 / agent 活着没 / 忙不忙。
   * @returns { 可用: true, id, agent, 来源 } 或 { 可用: false, 原因 }
   */
  function 检查目标(配置) {
    let id = String(配置.目标会话 || '').trim()
    let 来源 = '配置'
    if (id === '' && 配置.自动找私聊 !== false) {
      id = 找私聊会话()
      来源 = '自动找私聊'
      if (id === '') {
        return { 可用: false, 原因: '目标会话没填，也找不到活着的 onebot 私聊（先打开一下 QQ 私聊）' }
      }
    }
    if (id === '') return { 可用: false, 原因: '配置里还没填「目标会话」（behavior-config.json），什么都不做' }

    try {
      const 登记 = 拿服务('workspaceRegistry')
      const 归档 = 登记 && 登记.archivedSessionIds
      if (归档 && typeof 归档[Symbol.iterator] === 'function') {
        for (const x of 归档) {
          if (会话键(x) === 会话键(id)) return { 可用: false, 原因: `目标会话 ${短id(id)} 已归档` }
        }
      }
    } catch (error) {
      // 归档名单拿不到就不判这一条
    }

    const agent = 找agent(ctx, id)
    if (agent === undefined) return { 可用: false, 原因: `目标会话 ${短id(id)} 现在没活着（agents.get 拿不到）` }
    if (agent.status !== undefined && agent.status !== 'idle') {
      return { 可用: false, 原因: `目标会话 ${短id(id)} 正忙（${agent.status}）` }
    }
    return { 可用: true, id, agent, 来源 }
  }

  // ---- 开口 ----

  /**
   * 真发一条 user 消息进目标会话。
   * ⚠ followup 必须 await（见文件头：漏接就是未处理 rejection，宿主会退出）。
   * @returns { ok: true } 或 { ok: false, 原因 }
   */
  async function 开口(agent, 文案) {
    try {
      const 工厂 = await 拿造消息工厂()
      const 消息 = 工厂
        ? 工厂.createUserMessage({ content: [{ type: 'text', text: 文案 }], source: { kind: 源标记 } })
        : 手搓用户消息(文案)
      await agent.followup(消息)
      // 让这一条先落盘（拿不到 sessions 服务就算了，不影响开口成功）
      try {
        if (ctx.sessions && typeof ctx.sessions.flush === 'function') await ctx.sessions.flush(agent.session)
      } catch (error) {
        警告(`落盘没确认：${String((error && error.message) || error)}`)
      }
      return { ok: true }
    } catch (error) {
      return { ok: false, 原因: String((error && error.message) || error) }
    }
  }

  // ---- 聊天行为 ----

  /**
   * 主动聊天这一支。自动 tick 和手动路由**走同一段逻辑**，只是选项不同：
   *   · 自动：受总开关 / 安静时段 / 聊天开关 / 冷却 / 冲动阈值约束
   *   · 手动：跳过安静时段、间隔、冷却和决策（方便当场验证），但仍然看总开关和聊天开关
   *   · 真发：跳过试运行（只有手动路由会这么传）
   * @param 选项 { 手动?: boolean, 真发?: boolean, 现在?: Date }
   */
  async function 跑聊天(选项 = {}) {
    const 手动 = 选项.手动 === true
    const 真发 = 选项.真发 === true
    try {
      const 配置 = 读配置()
      const 现在 = 选项.现在 instanceof Date ? 选项.现在 : new Date()
      const 聊天 = 配置.主动聊天

      // 跳过时：自动只打 debug（不刷屏），手动打 info（人正等着看结果）
      const 跳过 = (原因) => {
        if (手动) 提示(`手动触发没动：${原因}`)
        else 调试(`这一轮不动：${原因}`)
        return { ok: true, 不动: true, 说: 原因 }
      }

      // ① 总开关（手动也看，先保安全）
      if (!配置.总开关) return 跳过('总开关是关着的')

      if (!手动) {
        // ② 安静时段
        const 小时 = 现在.getHours()
        if (在安静时段(小时, 配置.安静时段[0], 配置.安静时段[1])) {
          return 跳过(`现在 ${小时} 点在安静时段（${配置.安静时段[0]}~${配置.安静时段[1]}）里`)
        }
        // ③ 聊天开关
        if (!聊天.开关) return 跳过('主动聊天开关是关着的')
      }

      // ⑤ 目标会话：填了没 / 活着没 / 忙不忙
      const 目标 = 检查目标(配置)
      if (!目标.可用) {
        if (手动) 警告(`手动触发失败：${目标.原因}`)
        else 调试(`这一轮不动：${目标.原因}`)
        return { ok: false, 不动: true, 说: 目标.原因 }
      }

      // ⑥ 状态本 + 翻日清零
      const 状态 = 读状态()
      const 跨天 = 翻转日(状态, 现在)
      if (跨天) {
        提示(`新的一天（${状态.日期}）：今日三个计数已清零｜心情 ${状态.心情} / 好感 ${状态.好感} / 精力 ${状态.精力}`)
      }
      // 早退时如果刚翻过日，得把清零后的状态落盘（不然下一个 tick 又「翻」一次）
      const 早退 = (结果) => {
        if (跨天) 存状态(状态)
        return 结果
      }

      // ⑦ 冷却：距上次真开口够久了吗（自动才看）
      if (!手动 && 聊天.冷却分钟 > 0 && 状态.上次开口) {
        const 上次 = Date.parse(状态.上次开口)
        if (Number.isFinite(上次)) {
          const 冷却 = (Date.now() - 上次) / 60000
          if (冷却 < 聊天.冷却分钟) {
            return 早退(跳过(`距上次开口才 ${冷却.toFixed(1)} 分钟（冷却 ${聊天.冷却分钟} 分钟）`))
          }
        }
      }

      // ⑧ 决策：读思维中枢（dsh-mind）算好的欲望；读不到就退回本地算冲动（降级）
      let 决策 = null
      if (!手动) {
        const 欲望 = 读思维欲望()
        if (欲望) {
          const 阈值 = 聊天.冲动阈值
          // 真困 / 真发呆（sleep/idle 也过了阈值）才压过对外行为；没到阈值的睡意只是背景，不该挡着说话
          const 挡 = 欲望.排名.find(([k, v]) => (k === 'sleep' || k === 'idle') && v >= 阈值)
          if (挡) {
            调试(`这一轮不动：${挡[0]} 欲望 ${挡[1].toFixed(2)} 也过了阈值，交给机体/发呆`)
            return 早退({
              ok: true,
              不动: true,
              欲望: 挡[0],
              强度: 挡[1],
              说: `${挡[0]} 欲望 ${挡[1].toFixed(2)} 也过了阈值，不产生对外动作`,
            })
          }
          const 对外 = 欲望.排名.filter(([k, v]) => (k === 'chat' || k === 'bili') && v >= 阈值)
          // 外部行为源（别的插件自己写的）也参与排序
          const 外部 = 读外部欲望()
          if (外部.length > 0 && 外部[0].强度 >= 阈值 && (对外.length === 0 || 外部[0].强度 > 对外[0][1])) {
            决策 = { 行为: 外部[0].id, 名称: 外部[0].名称, 强度: 外部[0].强度, 来源: '外部' }
          } else if (对外.length === 0) {
            调试(`这一轮不动：没有过阈值的对外欲望（阈值 ${阈值}）`)
            return 早退({
              ok: true,
              不动: true,
              欲望: 欲望.top,
              强度: 欲望.topValue,
              说: `没有过阈值的对外欲望（最高 ${欲望.top} ${欲望.topValue.toFixed(2)}，阈值 ${阈值}）`,
            })
          }
          决策 = { 行为: 对外[0][0], 强度: 对外[0][1], 来源: 'mind' }
        } else {
          const 冲动 = 算冲动(配置, 状态)
          决策 = { 行为: 'chat', 强度: 冲动.冲动, 来源: '本地', 说明: 冲动.说明 }
          if (冲动.冲动 < 聊天.冲动阈值) {
            调试(`这一轮不动：${冲动.说明}`)
            return 早退({
              ok: true,
              不动: true,
              冲动: 冲动.冲动,
              说: `冲动 ${冲动.冲动.toFixed(2)} 还没到阈值 ${聊天.冲动阈值}`,
            })
          }
        }
      }

      // ⑨ 这一步之后就是「开口」了：先决定是试运行还是真发
      const 试运行 = 真发 ? false : 手动 ? true : 配置.试运行
      const 行为 = 决策 ? 决策.行为 : 选项.行为 === 'bili' ? 'bili' : 'chat'
      const 文案 =
        决策 && 决策.来源 === '外部'
          ? `【behavior/外部】${决策.名称}（强度 ${决策.强度.toFixed(2)}）：想做就去做，做完按自己的方式记录/分享\n（这条是行为中枢的提醒，不是对方发来的消息）`
          : 行为 === 'bili'
            ? 组装刷站文案(配置.刷站.刷站文案)
            : 组装聊天文案(聊天.触发文案)
      const 决策话 = 决策 ? `欲望够 ✓ ${行为} ${决策.强度.toFixed(2)}（${决策.来源}）` : '手动触发（跳过欲望阈值）'

      if (试运行) {
        // 试运行：只记账，绝不 followup。
        if (行为 === 'chat') 状态.今日聊天 += 1
        if (行为 === 'bili') 状态.今日刷站 += 1
        存状态(状态)
        提示(
          `${决策话}｜试运行：本来要往「${短id(目标.id)}」送一句「${一行(文案)}」（今日聊天 ${状态.今日聊天}）`,
        )
        return { ok: true, 试运行: true, 行为, 强度: 决策 ? 决策.强度 : null, 文案, 说: '试运行：只记账，没有真发' }
      }

      // ⑩ 真发：刷站意图先写 intent.json，由 dsh-action-bili 去执行
      if (行为 === 'bili') {
        try {
          mkdirSync(join(目录, 'behavior'), { recursive: true })
          writeFileSync(join(目录, 'behavior', 'intent.json'), JSON.stringify({ 行为: 'video', 名称: '想刷视频', 强度: 决策 ? 决策.强度 : null, at: new Date().toISOString() }), 'utf8')
        } catch (error) {}
      }
      const 发出 = await 开口(目标.agent, 文案)
      if (!发出.ok) {
        存状态(状态)
        警告(`${决策话}但 followup 失败（这一轮没开口）：${发出.原因}`)
        return { ok: false, 说: `followup 失败：${发出.原因}` }
      }

      // ⑪ 成功记账 + 写行为反馈（思维中枢下一跳消费）
      if (行为 === 'chat') {
        状态.今日聊天 += 1
        状态.上次开口 = 现在.toISOString()
        状态.未回音 = {
          次数: (状态.未回音.次数 || 0) + 1,
          最后一句: 文案,
          最后时间: 现在.toISOString(),
          阶段: 0,
        }
        写反馈({
          at: 现在.toISOString(),
          kind: 'chat',
          result: 'ok',
          who: 聊天.好感键 || undefined,
          mood: 0.01,
          favor: 0.01,
          energy: -0.01,
          memory: 一行(文案),
        })
      } else if (行为 === 'bili') {
        状态.今日刷站 += 1
        状态.上次刷站 = 现在.toISOString()
        写反馈({
          at: 现在.toISOString(),
          kind: 'bili',
          result: 'ok',
          mood: 0.005,
          favor: 0,
          energy: -0.02,
          memory: '去刷了B站',
        })
      } else {
        // 手动触发 sleep/idle：只记一条反馈，不动会话
        写反馈({ at: 现在.toISOString(), kind: 行为, result: 'ok', mood: 0, favor: 0, energy: -0.005, memory: `手动${行为}` })
      }
      存状态(状态)
      提示(
        `${决策话}｜已真发一句给「${短id(目标.id)}」：${一行(文案)}｜` +
          `今日聊天 ${状态.今日聊天} / 刷站 ${状态.今日刷站}`,
      )
      return { ok: true, 行为, 文案, 强度: 决策 ? 决策.强度 : null, 说: '已真发（DSH 会照常开一轮）' }
    } catch (error) {
      警告(`聊天行为出错（已兜住，不影响宿主）：${String((error && error.stack) || error)}`)
      return { ok: false, 说: `出错：${String((error && error.message) || error)}` }
    }
  }

  // ---- tick ----

  /** 每 60 秒一跳：读配置 → 各种闸 → 聊天行为判断 → 记账。所有异常都吞在这层。 */
  async function tick() {
    tick次数 += 1
    try {
      const 配置 = 读配置()
      if (tick次数 % 调试间隔tick === 0) {
        调试(
          `第 ${tick次数} 次 tick 还活着｜总开关 ${配置.总开关 ? '开' : '关'}｜` +
            `试运行 ${配置.试运行 ? '开' : '关'}｜目标 ${配置.目标会话 ? 短id(配置.目标会话) : '（没填）'}｜` +
            `安静 ${配置.安静时段[0]}~${配置.安静时段[1]} 点`,
        )
      }
      await 跑聊天({ 手动: false, 真发: false })
    } catch (error) {
      警告(`tick 出错（已兜住，不影响宿主）：${String((error && error.stack) || error)}`)
    }
  }

  // ---- 手动触发 ----

  /**
   * 手动跑一次（HTTP 路由用）。
   * @param 行为 '聊天' | '刷站' | '分享'（后两个 M3/M4 还没做，明确拒绝而不是假装做了）
   * @param 真发 true = 跳过试运行
   */
  async function 手动跑(行为, 真发) {
    try {
      const 名 = String(行为 == null ? '' : 行为).trim() || '聊天'
      if (名 === '聊天' || 名 === 'chat') {
        const 结果 = await 跑聊天({ 手动: true, 真发: 真发 === true })
        return { ...结果, ok: 结果.ok !== false, 行为: '聊天', 真发: 真发 === true, 状态: 读状态(), 版本 }
      }
      if (名 === '刷站' || 名 === 'scan') {
        const 结果 = await 跑聊天({ 手动: true, 真发: 真发 === true, 行为: 'bili' })
        return { ...结果, ok: 结果.ok !== false, 行为: '刷站', 真发: 真发 === true, 状态: 读状态(), 版本 }
      }
      if (名 === '分享' || 名 === 'share') {
        return {
          ok: false,
          行为: 名,
          说: `「分享」排在 M4，这一版还没做；现在能跑「聊天」和「刷站」`,
          状态: 读状态(),
          版本,
        }
      }
      return {
        ok: false,
        行为: 名,
        说: `不认识的行为「${名}」；可选：聊天 / 刷站 / 分享（后两个还没做）`,
        状态: 读状态(),
        版本,
      }
    } catch (error) {
      return { ok: false, 说: `手动触发出错：${String((error && error.message) || error)}` }
    }
  }

  // ---- 会话事件：她上次说话 / 未回音 ----

  /**
   * 目标会话里出现用户消息 → 未回音清零、心情好感各 +0.01。
   * ⚠ 我们自己的注入（源标记）和其他插件注入的（注入来源）**不算**对方回话。
   * 同步函数，内部全 try/catch（事件回调抛错会污染宿主日志）。
   */
  function 收到会话事件(session, event) {
    try {
      const 消息 = 提取用户消息(event)
      if (!消息) return
      const 会话id = String((session && session.id) || (event && event.sessionId) || '').trim()
      const 键 = 会话键(会话id)
      if (键 === '') return

      const 来自别处 = 消息.来源 !== 源标记 && !注入来源.has(消息.来源)
      if (来自别处) {
        // 记下「她上次说话」给时机因子用（只往前推，不回退）
        const 旧 = 她上次说话.get(键) || 0
        if (消息.时间 > 旧) 她上次说话.set(键, 消息.时间)
        // 翻过历史就不用再翻了
        翻过历史.add(键)
      }

      const 配置 = 读配置()
      if (!配置.目标会话 || 会话键(配置.目标会话) !== 键) return
      if (!来自别处) return // 别的插件/我们自己注入的，不算人回话

      const 状态 = 读状态()
      翻转日(状态, new Date())
      const 之前 = 状态.未回音.次数 || 0
      状态.未回音 = { 次数: 0, 最后一句: null, 最后时间: null, 阶段: 0 }
      状态.心情 = 加一点(状态.心情)
      状态.好感 = 加一点(状态.好感)
      存状态(状态)

      if (之前 > 0) {
        提示(`目标会话回话了，未回音清零（之前欠着 ${之前} 次）｜心情 ${状态.心情} / 好感 ${状态.好感}`)
      } else {
        调试(`目标会话有消息（没在等回音）｜心情 ${状态.心情} / 好感 ${状态.好感}`)
      }
    } catch (error) {
      警告(`处理会话事件出错（已兜住）：${String((error && error.message) || error)}`)
    }
  }

  // ---- 定时器 ----

  /** 跑一跳，无论如何都不许漏出未处理的 rejection。 */
  function 跑一跳() {
    if (读配置().启用 === false) return
    try {
      void tick().catch((error) => 警告(`tick 异常（已兜住）：${String((error && error.message) || error)}`))
    } catch (error) {
      警告(`起 tick 就出错了（已兜住）：${String((error && error.message) || error)}`)
    }
  }

  /** 挂表：优先 ctx.interval（宿主 timer 服务），拿不到就内置 setInterval 顶上。 */
  function 开表() {
    try {
      if (停表 !== null) 收摊()

      if (typeof ctx.interval === 'function') {
        停表 = ctx.interval(跑一跳, tick毫秒)
        return
      }

      const 表 = setInterval(跑一跳, tick毫秒)
      if (表 && typeof 表.unref === 'function') 表.unref() // 别因为这个定时器让宿主不肯退出
      停表 = () => clearInterval(表)
      调试(`拿不到 ctx.interval（timer 服务），用内置 setInterval 顶上，仍然每 ${tick毫秒 / 1000} 秒一跳`)
    } catch (error) {
      警告(`定时器没起来：${String((error && error.message) || error)}（其余功能照常，手动路由还能用）`)
    }
  }

  /** 停表（插件卸载 / 重挂时调）。 */
  function 收摊() {
    const 停 = 停表
    停表 = null
    try {
      if (typeof 停 === 'function') 停()
      else if (停 && typeof 停.dispose === 'function') 停.dispose()
    } catch (error) {
      // 停表失败也无所谓：表本身会在插件卸载时被 Cordis 收走
    }
  }

  return {
    tick,
    跑聊天,
    手动跑,
    收到会话事件,
    开表,
    收摊,
    提示,
    警告,
    调试,
    读配置,
    读状态,
  }
}

// ---------- 手动触发路由 ----------

/** 回一个 JSON（头写过/连接没了都不许抛）。 */
function 回JSON(res, 状态码, 对象) {
  try {
    if (!res || typeof res.writeHead !== 'function') return
    res.writeHead(状态码, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify(对象 === undefined ? {} : 对象))
  } catch (error) {
    try {
      res.end('{"ok":false}')
    } catch (error2) {
      // 连接已经没了，什么都不用做
    }
  }
}

/**
 * 挂 `GET /dsh-behavior/run?行为=聊天|刷站|分享&真发=1`。
 *
 * ⚠ 拿不到 webServer 就**跳过路由**，只 warn 一条，绝不让插件加载失败
 *   （tick 和会话监听照常跑，只是没法手动触发）。
 */
function 挂路由(ctx, 体) {
  // 服务兜底跟执行体里一个口径：先 ctx.get('webServer')，再回退 ctx.webServer
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
    体.警告('拿不到 webServer（或它没有 register），手动触发路由没挂；tick 和会话监听照常，不影响加载')
    return
  }

  try {
    ctx.effect(
      () =>
        服务.register({
          kind: 'exact',
          path: `${路由前缀}/run`,
          handler: async (req, res) => {
            try {
              const url = new URL(String((req && req.url) || '/'), 'http://127.0.0.1')
              const 行为 = String(
                url.searchParams.get('行为') || url.searchParams.get('action') || '聊天',
              ).trim()
              const 原文 = String(url.searchParams.get('真发') ?? url.searchParams.get('force') ?? '')
                .trim()
                .toLowerCase()
              const 真发 = ['1', 'true', 'yes', 'y', '真发', '是'].includes(原文)

              const 结果 = await 体.手动跑(行为, 真发)
              回JSON(res, 200, 结果)
            } catch (error) {
              体.警告(`手动触发路由处理出错（已兜住）：${String((error && error.message) || error)}`)
              回JSON(res, 500, { ok: false, 说: `处理手动触发时出错：${String((error && error.message) || error)}` })
            }
          },
        }),
      'dsh-behavior: 手动触发路由',
    )
    ctx.effect(
      () =>
        服务.register({
          kind: 'exact',
          path: `${路由前缀}/data`,
          handler: (req, res) => {
            try {
              回JSON(res, 200, { 状态: 读状态(), 配置: 读配置() })
            } catch (error) {
              回JSON(res, 500, { ok: false })
            }
          },
        }),
      'dsh-behavior: 设置页数据',
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
              const 新 = 改配置(patch)
              if (新) {
                体.提示('设置页改了行为配置（下一跳生效）')
                回JSON(res, 200, { ok: true, 配置: 新, 说: '改好了，下一跳（≤60 秒）生效' })
              } else {
                回JSON(res, 500, { ok: false, 说: '配置写不进去' })
              }
            } catch (error) {
              回JSON(res, 400, { ok: false, 说: `请求解析失败：${String((error && error.message) || error)}` })
            }
          },
        }),
      'dsh-behavior: 设置页改配置',
    )

    体.提示(`手动触发路由已就绪：GET ${路由前缀}/run?行为=聊天&真发=1｜设置页：${路由前缀}/data｜${路由前缀}/config`)
  } catch (error) {
    体.警告(`手动触发路由挂不上：${String((error && error.message) || error)}（其余功能照常）`)
  }
}

// ---------- 插件本体 ----------

export function apply(ctx) {
  const 体 = 造执行体(ctx)

  // 第一次起来：配置文件不存在就落一份默认值，方便手改（存在就一个字都不动）
  try {
    if (!existsSync(配置文件)) {
      if (写配置(归一化(null))) {
        体.提示(`配置文件不存在，已写一份默认值到 ${配置文件}（把「目标会话」改成会话 id，最多一分钟就生效）`)
      } else {
        体.警告(`配置文件不存在，而且写不进去：${配置文件}（先用默认值跑）`)
      }
    } else {
      // 只检查一次「能不能解析」，坏了就 warn（tick 里不重复 warn，免得刷屏）
      try {
        JSON.parse(readFileSync(配置文件, 'utf8'))
      } catch (error) {
        体.警告(`配置文件读不出来，先按默认值跑：${配置文件}（改好之后下一跳自动生效）`)
      }
    }
  } catch (error) {
    体.警告(`检查配置文件时出错（已兜住）：${String((error && error.message) || error)}`)
  }

  // 手动触发路由（拿不到 webServer 就跳过，绝不阻塞加载）
  挂路由(ctx, 体)

  // 未回音监听 / 记「她上次说话」
  ctx.effect(() => {
    if (typeof ctx.on !== 'function') {
      体.警告('ctx.on 不在，未回音监听没挂（其余功能照常）')
      return () => {}
    }
    const 摘 = ctx.on('session/event', (session, event) => {
      try {
        体.收到会话事件(session, event)
      } catch (error) {
        // 事件回调里绝不许抛
      }
    })
    return () => {
      try {
        if (typeof 摘 === 'function') 摘()
      } catch (error) {}
    }
  }, 'dsh-behavior: 未回音 / 她上次说话 监听')

  // 每 60 秒一跳
  ctx.effect(() => {
    体.开表()
    return () => 体.收摊()
  }, 'dsh-behavior: 每 60 秒 tick')

  // 启动那一条 info（只此一条，不在 tick 里刷）
  try {
    const 配置 = 读配置()
    ctx.logger.info(
      `behavior: v${版本} 已加载（M1 骨架 + M2 主动聊天）｜配置文件 ${配置文件}｜状态文件 ${状态文件}｜` +
        `每 ${tick毫秒 / 1000} 秒 tick｜总开关 ${配置.总开关 ? '开' : '关'}｜` +
        `${配置.试运行 ? '**试运行（只记账、不真发）**' : '试运行已关（会真发）'}｜` +
        `目标会话 ${配置.目标会话 ? 短id(配置.目标会话) : '（还没填）'}｜` +
        `冲动阈值 ${配置.主动聊天.冲动阈值}`,
    )
  } catch (error) {
    // logger 不在也不影响插件跑
  }
}

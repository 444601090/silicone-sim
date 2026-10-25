// DSH「机体」（dsh-body）· 宿主半边
//
// 管三样东西：精力 energy、体力 stamina、感受 sensors（时间 / 天气 / 温湿度）。
// 维护一个能自己睡、自己醒的生物钟状态，写 %DSH_HOME%/body/state.json 给思维和行为插件读。
//
// ⚠ 这个插件不碰 QQ、不碰 B 站、不调模型：它是「身体」。
// ⚠ 唯一真源：body/state.json（本插件独占写）。
// ⚠ 任何网络失败 / 读不到 / 写失败都只 warn，绝不让插件加载失败或让宿主崩。
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, watch } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 插件对外名字（也是日志前缀）。 */
export const name = 'body'

/** 需要宿主的 timer 服务（ctx.interval 就是它；没声明的话访问会直接抛错）。 */
export const inject = ['timer', 'webServer']

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
const 机体目录 = join(根目录, 'body')
const 状态文件 = join(机体目录, 'state.json')
const 配置文件 = join(机体目录, 'config.json')
/** 思维写完的激素补丁：身体每跳消费一次，然后清空。 */
const 激素补丁文件 = join(机体目录, 'hormone-patch.json')
/** 思维写完的精力/体力补丁（每轮思考/工作都会扣一点）：{ 精力: -0.004, 体力: -0.006 } */
const 体力补丁文件 = join(机体目录, 'body-patch.json')
/** 思维中枢的状态本：只读它的 desires.idle（发呆时体力不掉反回）。 */
const 思维状态文件 = join(根目录, 'mind', 'state.json')

/** tick 间隔：60 秒。 */
const tick毫秒 = 5 * 60 * 1000 // 兜底：有补丁时会被文件监听立刻叫醒
/** 每多少次 tick 打一条 debug（不刷屏）。 */
const 调试间隔tick = 20
/** 两次 tick 最长按多少分钟算（防止关机一天后精力一夜清零）。 */
const 最长推进分钟 = 180

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

// ---------- 默认配置 ----------

const 默认配置 = {
  作息: { 类型: '白昼', 弹性起点: 8 }, // 白昼=8~24 醒；黑夜=16~次日8 醒；弹性=起点起连续 12 小时醒
  启用: true, // 总开关：关掉后不推进（数据保留）
  天气开关: true, // 关掉就不联网（只留时间感受）
  自动定位: true, // 用 ip-api 自动找所在城市
  纬度: 39.9, // 定位失败时的兜底（北京）
  经度: 116.4,
  天气刷新分钟: 30, // 多久拉一次天气
  /** 身体参数（每小时口径），面板里可调 */
  身体: {
    白天掉精力: 0.03, // 白天每小时掉 3%（16 小时清醒约掉 48%）
    夜间掉精力: 0.04, // 夜里醒着掉得更快
    睡觉回精力: 0.12, // 每小时回 12%（8 小时回满）
    耗体力: 0.015,
    发呆回体力: 0.02, // 发呆时体力慢慢回
    睡觉回体力: 0.18,
    困阈值: 0.15, // 精力低于这个 → 自动睡
    夜间犯困: 0.35, // 夜间精力低于这个 → 睡
    睡饱: 0.9, // 精力到这个数 → 醒
    该醒: 0.6, // 白天 7 点后精力高于这个 → 醒
  },
}

// ---------- 默认状态 ----------

const 默认状态 = {
  schema: 3,
  updatedAt: null,
  /** 活性旧的镜像（0~1，兼容 mind/behavior 读 energy）：活性/100 */
  energy: 0.6,
  /** 耐力：独立值 0~1（体力） */
  stamina: 0.8,
  /** 血糖 mmol/L（正常 3.9~6.1） */
  glucose: 5.0,
  /** 腺苷 nmol/L（人体清醒静息约 30-50，累积到 300 很困，睡着降到 20-30） */
  adenosine: 50,
  /** 褪黑素 pg/mL（白天 5 左右、夜间 50-200） */
  melatonin: 5,
  awake: true,
  asleepSince: null,
  /** 激素：身体的化学状态（真实单位，见 激素参考）。心情由思维解读，行为会反过来调节它 */
  hormones: {
    多巴胺: 50,
    血清素: 190,
    催产素: 5,
    皮质醇: 350,
    肾上腺素: 30,
  },
  sensors: { hour: 12, weather: null, weatherAt: null },
}

/**
 * 激素参考区间（真实单位 + 正常范围）。
 * ⚠ 这是「外周血浓度」的参考值，不是中枢递质活性；心理建模上只当「相对活性」用。
 *   多巴胺外周浓度和心理的关系最弱，这里也一起列出来当占位。
 */
export const 激素参考 = {
  多巴胺: { 基准: 50, 下限: 10, 上限: 90, 单位: 'pg/mL' },
  血清素: { 基准: 190, 下限: 101, 上限: 283, 单位: 'ng/mL' },
  催产素: { 基准: 5, 下限: 1, 上限: 10, 单位: 'pg/mL' },
  皮质醇: { 基准: 350, 下限: 138, 上限: 690, 单位: 'nmol/L' },
  肾上腺素: { 基准: 30, 下限: 10, 上限: 50, 单位: 'pg/mL' },
}

/** 把真实值折算成「在正常范围里的位置」0~1（低于下限算 0，高于上限算 1）。 */
export function 激素位置(名, 值) {
  const r = 激素参考[名]
  if (!r) return 0.5
  const n = Number(值)
  if (!Number.isFinite(n)) return 0.5
  return Math.min(1, Math.max(0, (n - r.下限) / (r.上限 - r.下限)))
}

/** 按「正常范围的比例」加减一个激素（比例 0.01 = 整个区间的 1%）。 */
function 激素加减(激素, 名, 比例) {
  const r = 激素参考[名]
  if (!r) return
  const n = Number(激素[名])
  const 基 = Number.isFinite(n) ? n : r.基准
  激素[名] = Math.max(0, 基 + 比例 * (r.上限 - r.下限))
}

// ---------- 精力 / 体力参数见 默认配置.身体（面板可调） ----------

/**
 * 推进生物钟（纯函数，测试能直接喂极值）：
 *   醒着：精力/体力按小时掉；睡着：按小时回。
 *   自动睡：精力 < 0.15，或夜间（22~6 点）且精力 < 0.35。
 *   自动醒：精力 ≥ 0.9，或白天 7 点后且精力 > 0.6。
 *
 * @param {object} 状态 当前状态（energy/stamina/awake）
 * @param {number} 分钟 距上次更新过了多少分钟（钳到 0~180）
 * @param {Date} 时刻 现在
 * @param {number} 发呆 思维的 idle 欲望（> 0.6 时体力不掉反回）
 * @returns {object} 新状态字段 { energy, stamina, awake, 睡了?, 醒了? }
 */
/**
 * 昼夜节律系数（乘在激素基线上）：早上精神、午后低、夜里低。
 * @param {number} 小时 0~23
 */
export function 昼夜系数(小时) {
  const 时 = Number.isFinite(Number(小时)) ? Number(小时) : new Date().getHours()
  const 晨 = 时 >= 6 && 时 < 10
  const 午后 = 时 >= 14 && 时 < 16
  const 夜 = 时 >= 23 || 时 < 6
  return {
    多巴胺: 晨 ? 1.15 : 午后 ? 0.9 : 夜 ? 0.8 : 1.0,
    血清素: 晨 ? 1.1 : 夜 ? 0.85 : 1.0,
    催产素: 夜 ? 0.95 : 1.0,
    皮质醇: 晨 ? 0.9 : 夜 ? 1.1 : 1.0,
    肾上腺素: 晨 ? 1.1 : 午后 ? 0.9 : 1.0,
  }
}

/**
 * 身体状态反过来影响激素（每跳一点点，慢慢积）：
 *   精力 < 0.3 → 多巴胺降、皮质醇升（累到没心情）
 *   体力 < 0.25 → 肾上腺素降（没劲折腾）
 */
export function 身体影响激素(状态) {
  const 出 = { ...((状态 && 状态.hormones) || 默认状态.hormones) }
  const 精力 = 夹01(状态 && 状态.energy, 默认状态.energy)
  const 体力 = 夹01(状态 && 状态.stamina, 默认状态.stamina)
  if (精力 < 0.3) {
    const 重 = (0.3 - 精力) / 0.3
    激素加减(出, '多巴胺', -0.001 * 重)
    激素加减(出, '皮质醇', 0.0012 * 重)
  }
  if (体力 < 0.25) {
    const 重 = (0.25 - 体力) / 0.25
    激素加减(出, '肾上腺素', -0.0008 * 重)
  }
  return 出
}

/**
 * 天气体感影响激素（每跳一点点）：
 *   晴 → 血清素 +
 *   阴/雨/雪 → 皮质醇 +
 *   太热/太冷 → 肾上腺素 +（难受、躁）
 *   湿度 ≥ 85% → 皮质醇 +
 */
export function 天气影响激素(激素, 天气) {
  const 出 = { ...(激素 || {}) }
  if (!天气) return 出
  const 文 = String(天气.text || '')
  const 温 = Number(天气.temp)
  const 湿 = Number(天气.humidity)
  if (文.includes('晴')) 激素加减(出, '血清素', 0.0002)
  if (文.includes('雨') || 文.includes('雪') || 文.includes('阴')) {
    激素加减(出, '皮质醇', 0.00015)
  }
  if (Number.isFinite(温) && (温 >= 30 || 温 <= 5)) {
    激素加减(出, '肾上腺素', 0.0002)
  }
  if (Number.isFinite(湿) && 湿 >= 85) 激素加减(出, '皮质醇', 0.0001)
  return 出
}

/**
 * 活性（觉醒度）0~100：多巴胺/肾上腺素促醒，腺苷/褪黑素促困。
 * 这是派生值，不存盘（读的时候算）。
 */
export function 算活性(状态) {
  const 激 = (状态 && 状态.hormones) || {}
  const 多 = 激素位置('多巴胺', 激.多巴胺)
  const 肾 = 激素位置('肾上腺素', 激.肾上腺素)
  const 腺 = Math.min(1, Math.max(0, (Number(状态 && 状态.adenosine) || 50) / 300))
  const 褪 = Math.min(1, Math.max(0, (Number(状态 && 状态.melatonin) || 5) / 200))
  const 值 = 50 + 多 * 30 + 肾 * 20 - 腺 * 40 - 褪 * 30
  return Math.max(0, Math.min(100, Math.round(值)))
}

export function 推进(状态, 分钟, 时刻 = new Date(), 发呆 = 0, 参数 = 默认配置.身体) {
  const 旧 = 状态 && typeof 状态 === 'object' ? 状态 : {}
  const 秒 = Math.min(最长推进分钟, Math.max(0, Number(分钟) || 0)) * 60
  const 小时 = 秒 / 3600
  const 时 = 时刻.getHours()
  // 作息类型 → 当前是不是「休息时段」
  const 作息 = (参数 && 参数.作息) || { 类型: '白昼', 弹性起点: 8 }
  const 是休息 = (小时数) => {
    const 类型 = String(作息.类型 || '白昼')
    if (类型 === '黑夜') return 小时数 >= 8 && 小时数 < 16
    if (类型 === '弹性') {
      const 起 = Number(作息.弹性起点) || 8
      const 醒着 = ((小时数 - 起 + 24) % 24) < 12
      return !醒着
    }
    return 小时数 < 8 // 白昼：0~8 休息
  }
  const 夜间 = 是休息(时)

  const 醒着 = 旧.awake !== false
  const 激 = { ...默认状态.hormones, ...((旧 && 旧.hormones) || {}) }

  // 腺苷：醒着累积（每小时 +6），睡着清除（每小时 -12），最低留 5
  let 腺苷 = Number(旧.adenosine) || 50
  腺苷 = 醒着 ? 腺苷 + 小时 * 25 : 腺苷 - 小时 * 40
  腺苷 = Math.max(10, Math.min(300, 腺苷))

  // 褪黑素：夜里往 100 靠，白天往 5 靠
  const 目标褪 = 夜间 ? 100 : 5
  let 褪黑素 = Number(旧.melatonin) || 5
  褪黑素 += (目标褪 - 褪黑素) * Math.min(1, 小时 * 1.5)
  褪黑素 = Math.max(0, Math.min(200, 褪黑素))

  // 血糖：平时缓慢降；皮质醇高（应激）会升一点；低于 4.0 自动吃饭回 5.5
  let 血糖 = Number(旧.glucose) || 5.0
  血糖 -= 小时 * 0.15
  if (激素位置('皮质醇', 激.皮质醇) > 0.8) 血糖 += 小时 * 0.12
  // 吃饭交给行为中枢（自动作息）：低血糖不再自动补，只夹紧
  血糖 = Math.max(3.0, Math.min(8.0, 血糖))

  // 耐力：独立值；血糖决定掉/回速度（低血糖掉得快、回得慢）
  let 耐力 = 夹01(旧.stamina, 默认状态.stamina)
  const 血糖系 = Math.max(0.3, Math.min(1.5, 血糖 / 5.0))
  if (醒着) {
    const 在发呆 = Number(发呆) > 0.6
    耐力 += 小时 * (在发呆 ? 参数.发呆回体力 * 血糖系 : -参数.耗体力 * (1.5 - 血糖系 * 0.6))
  } else {
    耐力 += 小时 * 参数.睡觉回体力 * 血糖系
  }
  耐力 = 夹01(耐力)

  // 活性（派生）
  const 活性 = 算活性({ hormones: 激, adenosine: 腺苷, melatonin: 褪黑素 })

  // 睡/醒：活性 <30 困、<45 且夜间也困；活性 >60 且早上 6 点后醒
  let awake = 醒着
  let 睡了 = false
  let 醒了 = false
  if (醒着) {
    if (活性 < 30 || (夜间 && 活性 < 45)) {
      awake = false
      睡了 = true
    }
  } else {
    const 可以醒的时间 = 时 >= 6 && 时 < 22
    if (可以醒的时间 && 活性 > 60) {
      awake = true
      醒了 = true
    }
  }

  return {
    energy: 活性 / 100,
    stamina: 耐力,
    glucose: 血糖,
    adenosine: 腺苷,
    melatonin: 褪黑素,
    活性,
    睡了,
    醒了,
    awake,
  }
}

// ---------- 天气（感受）----------

/** WMO 天气码 → 中文。 */
function 天气文字(码) {
  const n = Number(码)
  if (!Number.isFinite(n)) return '未知'
  if (n === 0) return '晴'
  if (n <= 2) return '多云'
  if (n === 3) return '阴'
  if (n === 45 || n === 48) return '雾'
  if (n >= 51 && n <= 57) return '毛毛雨'
  if (n >= 61 && n <= 67) return '雨'
  if (n >= 71 && n <= 77) return '雪'
  if (n >= 80 && n <= 82) return '阵雨'
  if (n >= 85 && n <= 86) return '阵雪'
  if (n >= 95) return '雷雨'
  return '未知'
}

/** 带超时的 fetch（拿不到就返回 null）。 */
async function 取JSON(url, 毫秒 = 8000) {
  try {
    const 响应 = await fetch(url, { signal: AbortSignal.timeout(毫秒) })
    if (!响应.ok) return null
    return await 响应.json()
  } catch (error) {
    return null
  }
}

/** 自动定位（ip-api，免 key）；失败返回 null。 */
async function 定位() {
  const 数据 = await 取JSON('http://ip-api.com/json/?lang=zh-CN&fields=status,city,lat,lon', 6000)
  if (!数据 || 数据.status !== 'success') return null
  const 纬 = Number(数据.lat)
  const 经 = Number(数据.lon)
  if (!Number.isFinite(纬) || !Number.isFinite(经)) return null
  return { 纬度: 纬, 经度: 经, 城市: String(数据.city || '') }
}

/** 拉天气（Open-Meteo，免 key）；失败返回 null。 */
async function 拉天气(配置) {
  const 纬 = Number(配置.纬度)
  const 经 = Number(配置.经度)
  if (!Number.isFinite(纬) || !Number.isFinite(经)) return null
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${纬}&longitude=${经}` +
    `&current=temperature_2m,relative_humidity_2m,weather_code&timezone=Asia%2FShanghai`
  const 数据 = await 取JSON(url, 8000)
  const 当前 = 数据 && 数据.current
  if (!当前) return null
  return {
    text: 天气文字(当前.weather_code),
    temp: Number.isFinite(Number(当前.temperature_2m)) ? Math.round(Number(当前.temperature_2m)) : null,
    humidity: Number.isFinite(Number(当前.relative_humidity_2m)) ? Math.round(Number(当前.relative_humidity_2m)) : null,
    at: new Date().toISOString(),
  }
}

// ---------- 配置 / 状态读写 ----------

function 归一配置(原始) {
  const 混 = 原始 && typeof 原始 === 'object' ? 原始 : {}
  const 身 = 混.身体 && typeof 混.身体 === 'object' ? 混.身体 : {}
  const 身体 = {}
  for (const 键 of Object.keys(默认配置.身体)) {
    身体[键] = 夹01(身[键], 默认配置.身体[键])
  }
  const 作息 = 混.作息 && typeof 混.作息 === 'object' ? 混.作息 : {}
  const 作息类型 = ['白昼', '黑夜', '弹性'].includes(String(作息.类型 || '')) ? String(作息.类型) : 默认配置.作息.类型
  const 弹性起点 = Number.isFinite(Number(作息.弹性起点))
    ? Math.min(23, Math.max(0, Number(作息.弹性起点)))
    : 默认配置.作息.弹性起点
  return {
    作息: { 类型: 作息类型, 弹性起点 },
    天气开关: 混.天气开关 !== false,
    自动定位: 混.自动定位 !== false,
    纬度: Number.isFinite(Number(混.纬度)) ? Number(混.纬度) : 默认配置.纬度,
    经度: Number.isFinite(Number(混.经度)) ? Number(混.经度) : 默认配置.经度,
    天气刷新分钟: Number.isFinite(Number(混.天气刷新分钟))
      ? Math.min(360, Math.max(5, Number(混.天气刷新分钟)))
      : 默认配置.天气刷新分钟,
    身体,
  }
}

function 读配置() {
  try {
    return 归一配置(JSON.parse(readFileSync(配置文件, 'utf8')))
  } catch (error) {
    return 归一配置(null)
  }
}

function 归一状态(原始) {
  const 混 = 原始 && typeof 原始 === 'object' ? 原始 : {}
  const 感 = 混.sensors && typeof 混.sensors === 'object' ? 混.sensors : {}
  const 天气 = 感.weather && typeof 感.weather === 'object' ? 感.weather : null
  const 激 = 混.hormones && typeof 混.hormones === 'object' ? 混.hormones : {}
  return {
    schema: 3,
    updatedAt: 时间串(混.updatedAt),
    // 旧版是 0~1 的精力；保留字段兼作「活性/100」镜像，供 mind/behavior 读
    energy: 夹01(混.energy, 默认状态.energy),
    stamina: 夹01(混.stamina, 默认状态.stamina),
    glucose: Number.isFinite(Number(混.glucose)) ? Math.max(3.0, Math.min(8.0, Number(混.glucose))) : 默认状态.glucose,
    adenosine: Number.isFinite(Number(混.adenosine)) ? Math.max(10, Math.min(300, Number(混.adenosine))) : 默认状态.adenosine,
    melatonin: Number.isFinite(Number(混.melatonin)) ? Math.max(0, Math.min(200, Number(混.melatonin))) : 默认状态.melatonin,
    awake: 混.awake !== false,
    asleepSince: 时间串(混.asleepSince),
    hormones: (() => {
      const 出 = {}
      for (const 名 of Object.keys(激素参考)) {
        const r = 激素参考[名]
        const n = Number(激[名])
        // 旧版存的是 0~1 的尺度：明显低于下限的一律按基准值重设（一次性迁移）
        const 像旧版 = Number.isFinite(n) && n > 0 && n < r.下限 * 0.2
        出[名] = !Number.isFinite(n) || 像旧版 ? r.基准 : Math.max(0, Math.min(r.上限 * 1.2, n))
      }
      return 出
    })(),
    sensors: {
      hour: Number.isFinite(Number(感.hour)) ? Number(感.hour) : new Date().getHours(),
      weather: 天气
        ? {
            text: typeof 天气.text === 'string' ? 天气.text : '未知',
            temp: Number.isFinite(Number(天气.temp)) ? Number(天气.temp) : null,
            humidity: Number.isFinite(Number(天气.humidity)) ? Number(天气.humidity) : null,
            at: 时间串(天气.at),
          }
        : null,
      weatherAt: 时间串(感.weatherAt),
    },
  }
}

function 读状态() {
  try {
    if (!existsSync(状态文件)) return 归一状态(null)
    return 归一状态(JSON.parse(readFileSync(状态文件, 'utf8')))
  } catch (error) {
    return 归一状态(null)
  }
}

function 写状态(状态, 日志) {
  try {
    原子写(状态文件, JSON.stringify(状态, null, 2))
    return true
  } catch (error) {
    if (日志) 日志.警告(`写机体状态失败：${String((error && error.message) || error)}`)
    return false
  }
}

// ---------- 执行体 ----------

function 造执行体(ctx) {
  let tick次数 = 0
  let 停表 = null
  let 监听器 = null
  let 防抖 = null
  /** 上次拉天气的时间（ms），避免每次 tick 都联网。 */
  let 上次天气 = 0

  function 提示(文本) {
    try {
      ctx.logger.info(`body: ${文本}`)
    } catch (error) {}
  }
  function 警告(文本) {
    try {
      ctx.logger.warn(`body: ${文本}`)
    } catch (error) {}
  }
  function 调试(文本) {
    try {
      if (ctx.logger.debug) ctx.logger.debug(`body: ${文本}`)
      else ctx.logger.info(`body: ${文本}`)
    } catch (error) {}
  }

  /** 一跳：读状态 → 推进生物钟 → 天气 → 写盘。 */
  async function 跑一跳() {
    if (读配置().启用 === false) return
    tick次数 += 1
    try {
      const 配置 = 读配置()
      const 状态 = 读状态()
      const 现在 = new Date()

      // 1. 距上次更新多久（没记录过就按 1 分钟算）
      const 上次 = 状态.updatedAt ? Date.parse(状态.updatedAt) : NaN
      const 分钟 = Number.isFinite(上次) ? (现在.getTime() - 上次) / 60000 : 1

      // 2. 推进生物钟（先瞄一眼思维的 idle 欲望：发呆时体力不掉反回）
      let 发呆 = 0
      try {
        const 思维 = JSON.parse(readFileSync(思维状态文件, 'utf8'))
        发呆 = Number(思维 && 思维.desires && 思维.desires.idle) || 0
      } catch (error) {}
      const 结果 = 推进(状态, 分钟, 现在, 发呆, 配置.身体)
      状态.energy = 结果.energy
      状态.stamina = 结果.stamina
      状态.glucose = 结果.glucose
      状态.adenosine = 结果.adenosine
      状态.melatonin = 结果.melatonin

      // 2.5 激素：昼夜节律基线 + 身体状态联动 + 天气体感 + 消费思维补丁
      if (!状态.hormones) 状态.hormones = { ...默认状态.hormones }
      const 时节律 = 昼夜系数(现在.getHours())
      const 小时 = 现在.getHours()
      for (const 名 of Object.keys(激素参考)) {
        const r = 激素参考[名]
        const 基线 = r.基准 * 时节律[名]
        状态.hormones[名] = 状态.hormones[名] + (基线 - 状态.hormones[名]) * 0.02
      }
      // 皮质醇有独立的昼夜节律：早上高、晚上低（临床也是这样）
      const 皮质醇节律 = 小时 >= 6 && 小时 < 10 ? 1.4 : 小时 >= 22 || 小时 < 6 ? 0.4 : 1.0
      const 皮质醇基线 = 激素参考.皮质醇.基准 * 皮质醇节律
      状态.hormones.皮质醇 = 状态.hormones.皮质醇 + (皮质醇基线 - 状态.hormones.皮质醇) * 0.03
      const 当前天气 = 状态.sensors && 状态.sensors.weather
      if (当前天气) 状态.hormones = 天气影响激素(状态.hormones, 当前天气)

      try {
        const patch = JSON.parse(readFileSync(激素补丁文件, 'utf8'))
        if (patch && typeof patch === 'object') {
          for (const 名 of Object.keys(激素参考)) {
            const v = Number(patch[名])
            if (Number.isFinite(v) && v !== 0) 激素加减(状态.hormones, 名, v)
          }
          writeFileSync(激素补丁文件, '{}', 'utf8')
        }
      } catch (error) {
        // 没有补丁文件就跳过
      }

      // 2.6 精力/体力补丁（思维每轮思考/工作扣的）
      try {
        const 补 = JSON.parse(readFileSync(体力补丁文件, 'utf8'))
        if (补 && typeof 补 === 'object') {
          const 精 = Number(补.精力)
          const 体 = Number(补.体力)
          const 糖 = Number(补.血糖)
          const 腺 = Number(补.腺苷)
          // 精力（活性偏移）落成多巴胺：活性是派生的，改多巴胺让它自然降
          if (Number.isFinite(精) && 精 !== 0) 激素加减(状态.hormones, '多巴胺', 精 * 0.8)
          if (Number.isFinite(体) && 体 !== 0) 状态.stamina = 夹01(状态.stamina + 体, 状态.stamina)
          if (Number.isFinite(糖) && 糖 !== 0) {
            状态.glucose = Math.max(3.0, Math.min(8.0, (Number(状态.glucose) || 5.0) + 糖))
          }
          if (Number.isFinite(腺) && 腺 !== 0) {
            状态.adenosine = Math.max(10, Math.min(300, (Number(状态.adenosine) || 50) + 腺))
          }
          if (补.唤醒 === true && !状态.awake) {
            状态.awake = true
            状态.asleepSince = null
            提示('被消息吵醒了')
          }
          if (补.睡觉 === true && 状态.awake) {
            状态.awake = false
            状态.asleepSince = new Date().toISOString()
            提示('自己躺下了（吃饭/睡觉行为）')
          }
          writeFileSync(体力补丁文件, '{}', 'utf8')
        }
      } catch (error) {
        // 没有补丁就跳过
      }

      if (结果.睡了) {
        状态.awake = false
        状态.asleepSince = 现在.toISOString()
        提示(`睡着了（活性 ${算活性(状态)}${现在.getHours() >= 22 || 现在.getHours() < 6 ? '，夜里犯困' : ''}）`)
      } else if (结果.醒了) {
        状态.awake = true
        状态.asleepSince = null
        提示(`醒了（活性 ${算活性(状态)}）`)
      } else if (!结果.awake && 状态.awake) {
        状态.awake = false
      } else if (结果.awake && !状态.awake) {
        状态.awake = true
        状态.asleepSince = null
      }

      // 3. 感受：小时
      状态.sensors.hour = 现在.getHours()

      // 4. 感受：天气（按配置间隔刷新，失败不影响）
      if (配置.天气开关) {
        const 天气间隔 = 配置.天气刷新分钟 * 60000
        if (Date.now() - 上次天气 >= 天气间隔) {
          上次天气 = Date.now()
          try {
            const 位置 = 配置.自动定位 ? await 定位() : null
            const 经纬 = 位置 ? { 纬度: 位置.纬度, 经度: 位置.经度 } : { 纬度: 配置.纬度, 经度: 配置.经度 }
            const 天气 = await 拉天气(经纬)
            if (天气) {
              状态.sensors.weather = 天气
              状态.sensors.weatherAt = 天气.at
              调试(`天气 ${天气.text} ${天气.temp}℃ 湿度 ${天气.humidity}%`)
            }
          } catch (error) {
            调试(`拉天气失败（不影响精力）：${String((error && error.message) || error)}`)
          }
        }
      }

      // 5. 写盘
      状态.updatedAt = 现在.toISOString()
      写状态(状态, { 警告 })

      if (tick次数 % 调试间隔tick === 0) {
        const 天气 = 状态.sensors.weather
        调试(
          `还活着｜精力 ${状态.energy.toFixed(2)}｜体力 ${状态.stamina.toFixed(2)}｜` +
            `${状态.awake ? '醒着' : '睡着'}｜${状态.sensors.hour} 点｜` +
            `${天气 ? `${天气.text} ${天气.temp}℃ 湿度 ${天气.humidity}%` : '天气未知'}`,
        )
      }
    } catch (error) {
      警告(`tick 出错（已兜住，不影响宿主）：${String((error && error.message) || error)}`)
    }
  }

  function 开表() {
    try {
      if (停表 !== null) 收摊()
      // 文件监听：补丁一出现就立刻跑一跳（300ms 防抖）
      try {
        监听器 = watch(机体目录, { persistent: false }, (事件, 文件名) => {
          if (文件名 !== 'body-patch.json' && 文件名 !== 'hormone-patch.json') return
          if (防抖) clearTimeout(防抖)
          防抖 = setTimeout(() => {
            Promise.resolve()
              .then(跑一跳)
              .catch(() => {})
          }, 300)
        })
        调试('已监听补丁：有变化立刻跑一跳')
      } catch (error) {}
      const 回调 = () => {
        Promise.resolve()
          .then(跑一跳)
          .catch((error) => 警告(`这一跳出错：${String((error && error.message) || error)}`))
      }
      if (typeof ctx.interval === 'function') {
        停表 = ctx.interval(回调, tick毫秒)
        return
      }
      const 表 = setInterval(回调, tick毫秒)
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

/** 改配置（只认白名单），返回新配置或 null。 */
export function 改配置(patch) {
  const 原 = 读配置()
  const 新 = { ...原, 身体: { ...原.身体 } }
  if (patch && typeof patch === 'object') {
    if (typeof patch.天气开关 === 'boolean') 新.天气开关 = patch.天气开关
    if (typeof patch.自动定位 === 'boolean') 新.自动定位 = patch.自动定位
    if (Number.isFinite(Number(patch.天气刷新分钟))) {
      新.天气刷新分钟 = Math.min(360, Math.max(5, Number(patch.天气刷新分钟)))
    }
    if (patch.作息 && typeof patch.作息 === 'object') {
      新.作息 = { ...(原.作息 || {}) }
      const 类型 = String(patch.作息.类型 || '')
      if (['白昼', '黑夜', '弹性'].includes(类型)) 新.作息.类型 = 类型
      if (Number.isFinite(Number(patch.作息.弹性起点))) {
        新.作息.弹性起点 = Math.min(23, Math.max(0, Number(patch.作息.弹性起点)))
      }
    }
    if (patch.身体 && typeof patch.身体 === 'object') {
      for (const 键 of Object.keys(默认配置.身体)) {
        if (Number.isFinite(Number(patch.身体[键]))) 新.身体[键] = 夹01(Number(patch.身体[键]), 新.身体[键])
      }
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
          path: '/dsh-body/data',
          handler: (req, res) => {
            const 状态 = 读状态()
            回JSON(res, 200, { 状态: { ...状态, 活性: 算活性(状态) }, 配置: 读配置() })
          },
        }),
      'dsh-body: 设置页数据',
    )
    ctx.effect(
      () =>
        服务.register({
          kind: 'exact',
          path: '/dsh-body/config',
          handler: async (req, res) => {
            try {
              const 块 = []
              for await (const 片 of req) 块.push(片)
              const 原文 = Buffer.concat(块).toString('utf8')
              const patch = 原文 ? JSON.parse(原文) : {}
              const 新 = 改配置(patch)
              if (新) {
                体.提示('设置页改了机体参数（下一跳生效）')
                回JSON(res, 200, { ok: true, 配置: 新, 说: '改好了，下一跳（≤60 秒）生效' })
              } else {
                回JSON(res, 500, { ok: false, 说: '配置写不进去' })
              }
            } catch (error) {
              回JSON(res, 400, { ok: false, 说: `请求解析失败：${String((error && error.message) || error)}` })
            }
          },
        }),
      'dsh-body: 设置页改配置',
    )
    体.提示('设置页接口已就绪：GET /dsh-body/data｜POST /dsh-body/config')

  // 睡 / 醒 接口：用户说「去睡吧」「醒醒」时调
  if (服务 && typeof 服务.register === 'function') {
    const 动手 = (动作) => {
      const 状态 = { ...读状态({ 提示: 体.提示, 警告: 体.警告 }) }
      if (动作 === 'sleep') {
        if (状态.awake === false) return '已经睡着了'
        状态.awake = false
        状态.asleepSince = new Date().toISOString()
        写状态(状态, { 提示: 体.提示, 警告: 体.警告 })
        return '已入睡'
      }
      状态.awake = true
      状态.asleepSince = null
      写状态(状态, { 提示: 体.提示, 警告: 体.警告 })
      return '已醒来'
    }
    try {
      ctx.effect(
        () =>
          服务.register({
            kind: 'exact',
            path: '/dsh-body/sleep',
            handler: (req, res) => {
              res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ ok: true, 说: 动手('sleep') }))
            },
          }),
        'dsh-body: 强制入睡',
      )
      ctx.effect(
        () =>
          服务.register({
            kind: 'exact',
            path: '/dsh-body/wake',
            handler: (req, res) => {
              res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ ok: true, 说: 动手('wake') }))
            },
          }),
        'dsh-body: 强制醒来',
      )
    } catch (error) {}
  }
  } catch (error) {
    体.警告(`设置页接口挂不上：${String((error && error.message) || error)}`)
  }
}

// ---------- 插件本体 ----------

export function apply(ctx) {
  const 体 = 造执行体(ctx)

  ctx.effect(
    () => {
      体.开表()
      return () => 体.收摊()
    },
    'dsh-body: 每 60 秒推进一次生物钟',
  )

  挂路由(ctx, 体)

  try {
    const 状态 = 读状态()
    const 天气 = 状态.sensors.weather
    ctx.logger.info(
      `body: v0.1.0 已加载｜状态本 ${状态文件}｜每 ${tick毫秒 / 1000} 秒 tick｜` +
        `精力 ${状态.energy.toFixed(2)}｜体力 ${状态.stamina.toFixed(2)}｜${状态.awake ? '醒着' : '睡着'}｜` +
        `${天气 ? `${天气.text} ${天气.temp}℃` : '天气未知'}`,
    )
  } catch (error) {
    // logger 不在也不影响插件跑
  }
}

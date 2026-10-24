// dsh-behavior 冒烟测试（M3）：读思维欲望 / 降级算冲动 / 刷站 / 反馈
// 用法：node tests/smoke.mjs
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const 临时家 = join(tmpdir(), 'behavior-smoke-' + Date.now())
mkdirSync(join(临时家, 'mind'), { recursive: true })
mkdirSync(join(临时家, 'feiyu-mood'), { recursive: true })
mkdirSync(join(临时家, 'feiyu-favor'), { recursive: true })
writeFileSync(join(临时家, 'feiyu-mood', 'state.json'), JSON.stringify({ mood: 88 }))
writeFileSync(join(临时家, 'feiyu-favor', 'state.json'), JSON.stringify({ favor: { '444601090': { value: 0.3 } }, energy: 0.8 }))
process.env.DSH_HOME = 临时家

const 配置 = {
  总开关: true,
  试运行: true,
  目标会话: 'session-test',
  安静时段: [1, 8],
  主动聊天: { 开关: true, 冷却分钟: 0, 冲动阈值: 0.55, 触发文案: '测试一下', 好感键: '' },
  刷站: { 开关: true, 间隔分钟: 180, 每日上限: 5, 刷站文案: '去刷个B站', 方向: '' },
  分享: { 开关: true, 每日上限: 3 },
}
function 写配置(改 = {}) {
  writeFileSync(join(临时家, 'behavior-config.json'), JSON.stringify({ ...配置, ...改 }, null, 2))
}
function 写欲望(欲) {
  writeFileSync(join(临时家, 'mind', 'state.json'), JSON.stringify({ desires: 欲, updatedAt: new Date().toISOString() }))
}
function 清状态() {
  writeFileSync(join(临时家, 'behavior-state.json'), JSON.stringify({ 日期: '', 今日聊天: 0, 今日刷站: 0, 今日分享: 0 }))
}

const 日志 = []
const followups = []
let 跑一跳 = null

const 假会话 = { id: 'session-test' }
const 假agent = {
  id: 'session-test',
  status: 'idle',
  session: 假会话,
  followup: async (m) => {
    followups.push(m)
  },
}

const ctx = {
  logger: {
    info: (s) => 日志.push(['info', s]),
    warn: (s) => 日志.push(['warn', s]),
    debug: (s) => 日志.push(['debug', s]),
  },
  agents: { get: (id) => (String(id).includes('test') ? 假agent : undefined), list: () => [假agent] },
  sessions: { get: () => 假会话, flush: async () => {} },
  sessionTitle: { get: () => '测试会话' },
  webServer: { register: () => () => {} },
  interval: (fn) => {
    跑一跳 = fn
    return () => {}
  },
  on: () => () => {},
  effect: (fn) => {
    const r = fn()
    return typeof r === 'function' ? r : () => {}
  },
  get: () => undefined,
  workspaceRegistry: undefined,
}

const mod = await import('../lib/host.js')
mod.apply(ctx)
if (typeof 跑一跳 !== 'function') {
  console.error('FAIL: 没有挂上定时器回调')
  process.exit(1)
}

const 等待 = () => new Promise((r) => setTimeout(r, 150))
const 最后日志 = () => 日志.filter(([k]) => k === 'info' || k === 'debug').map(([, v]) => String(v)).slice(-1)[0] || ''
const 重置 = () => {
  日志.length = 0
  followups.length = 0
}

let 失败 = 0
const 断言 = (名, 条件, 详情 = '') => {
  if (条件) console.log('✓', 名, 详情)
  else {
    console.log('✗', 名, 详情)
    失败 += 1
  }
}

// ---------- 场景 1：没有 mind 文件 → 降级用本地算冲动 ----------
清状态()
写配置()
await import('node:fs').then(({ unlinkSync }) => {
  try {
    unlinkSync(join(临时家, 'mind', 'state.json'))
  } catch (e) {}
})
重置()
跑一跳()
await 等待()
const 日志1 = 最后日志()
断言('无 mind 文件 → 降级本地冲动并记账', 日志1.includes('冲动') || 日志1.includes('试运行'), 日志1.slice(0, 100))

// ---------- 场景 2：mind 欲望 chat 0.9 → 走聊天 ----------
清状态()
写配置()
写欲望({ chat: 0.9, bili: 0.2, sleep: 0.1, idle: 0.1 })
重置()
跑一跳()
await 等待()
const 日志2 = 最后日志()
断言('mind 欲望 chat 0.90 → 走聊天（mind 来源）', 日志2.includes('chat 0.90') && 日志2.includes('mind'), 日志2.slice(0, 110))

// ---------- 场景 3：欲望全低 → 不动 ----------
清状态()
写欲望({ chat: 0.2, bili: 0.2, sleep: 0.2, idle: 0.2 })
重置()
跑一跳()
await 等待()
const 日志3 = 最后日志()
断言('欲望全低 → 这一轮不动', 日志3.includes('不动') || 日志3.includes('阈值'), 日志3.slice(0, 110))

// ---------- 场景 4：最高欲望是 sleep → 不对外开口 ----------
清状态()
写欲望({ chat: 0.4, bili: 0.3, sleep: 0.95, idle: 0.2 })
重置()
跑一跳()
await 等待()
const 日志4 = 最后日志()
断言('最高欲望 sleep → 交给身体，不开口', 日志4.includes('sleep') && 日志4.includes('过了阈值'), 日志4.slice(0, 110))

// ---------- 场景 5：最高欲望 bili + 关试运行 → 真发刷站文案 + 反馈 ----------
清状态()
写配置({ 试运行: false })
写欲望({ chat: 0.3, bili: 0.9, sleep: 0.2, idle: 0.1 })
try {
  writeFileSync(join(临时家, 'mind', 'feedback.jsonl'), '')
} catch (e) {}
重置()
跑一跳()
await 等待()
const 文案 = 文案文本(followups[0])
const 反馈 = existsSync(join(临时家, 'mind', 'feedback.jsonl'))
  ? readFileSync(join(临时家, 'mind', 'feedback.jsonl'), 'utf8').trim()
  : ''
断言('bili 最高 → 真发刷站文案', 文案.includes('刷站'), 文案.slice(0, 80))
断言('真发后写了 bili 反馈', 反馈.includes('"kind":"bili"') || 反馈.includes('"kind": "bili"'), 反馈.slice(0, 100))

function 文案文本(m) {
  try {
    const 内容 = m && m.content
    if (Array.isArray(内容)) return 内容.map((c) => c.text || '').join('')
    return String(m)
  } catch (e) {
    return ''
  }
}

console.log('')
if (失败 > 0) {
  console.log(`FAIL：${失败} 项不通过`)
  process.exit(1)
}
rmSync(临时家, { recursive: true, force: true })
console.log('SMOKE OK：降级 / mind 欲望 / 阈值 / sleep 不开口 / 刷站反馈 全部通过')

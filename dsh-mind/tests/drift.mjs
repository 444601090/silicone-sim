// dsh-mind 每日结算测试：记忆（最近互动）→ 好感 → 心情
// 用法：node tests/drift.mjs
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const 临时家 = join(tmpdir(), 'mind-drift-' + Date.now())
mkdirSync(join(临时家, 'mind'), { recursive: true })
process.env.DSH_HOME = 临时家

const 状态文件 = join(临时家, 'mind', 'state.json')
const 天前 = (n) => new Date(Date.now() - n * 86400000).toISOString()

function 写状态(改) {
  writeFileSync(
    状态文件,
    JSON.stringify({
      mood: 0.6,
      favor: { '444601090': { value: 0.3, name: '', last: 天前(1), talks: 5 } },
      memory: { lastTalkAt: 天前(5), lastFeedAt: null, lastSleepAt: null, events: 0, lastDriftDate: null },
      body: { energy: 0.6, stamina: 0.8 },
      desires: {},
      cooldown: {},
      ...改,
    }),
  )
}

const 日志 = []
const 回调们 = []
let 跑一跳 = null
const ctx = {
  logger: {
    info: (s) => 日志.push(['info', s]),
    warn: (s) => 日志.push(['warn', s]),
    debug: (s) => 日志.push(['debug', s]),
  },
  interval: (fn) => {
    回调们.push(fn)
    return () => {}
  },
  effect: (fn) => {
    const r = fn()
    return typeof r === 'function' ? r : () => {}
  },
}

const mod = await import('../lib/host.js')
mod.apply(ctx)
跑一跳 = 回调们[0]
const 等待 = () => new Promise((r) => setTimeout(r, 120))

let 失败 = 0
const 断言 = (名, 条件, 详情 = '') => {
  if (条件) console.log('✓', 名, 详情)
  else {
    console.log('✗', 名, 详情)
    失败 += 1
  }
}

// 第一跳：5 天没聊 → 好感 -0.012、心情 -0.008
写状态()
跑一跳()
await 等待()
const s1 = JSON.parse(readFileSync(状态文件, 'utf8'))
断言('5 天没聊 → 好感下降 -0.012', Math.abs(s1.favor['444601090'].value - 0.288) < 1e-9, `好感=${s1.favor['444601090'].value.toFixed(3)}`)
断言('心情跟着降（写成皮质醇补丁）', (() => { try { const p = JSON.parse(readFileSync(join(临时家, 'body', 'hormone-patch.json'), 'utf8')); return Number(p.皮质醇) > 0 } catch (e) { return false } })(), '')

// 第二跳：同一天，不再结算
跑一跳()
await 等待()
const s2 = JSON.parse(readFileSync(状态文件, 'utf8'))
断言('同一天再跑一跳不重复结算', Math.abs(s2.favor['444601090'].value - s1.favor['444601090'].value) < 1e-9 && Math.abs(s2.mood - s1.mood) < 1e-9)

// 第三天：改成昨天聊过、清掉 lastDriftDate → 好感 +0.004、心情 +0.003
写状态({
  favor: { '444601090': { value: 0.3, name: '', last: 天前(1), talks: 5 } },
  memory: { lastTalkAt: 天前(0.5), lastFeedAt: null, lastSleepAt: null, events: 3, lastDriftDate: null },
})
跑一跳()
await 等待()
const s3 = JSON.parse(readFileSync(状态文件, 'utf8'))
断言('昨天聊过 → 好感 +0.004', Math.abs(s3.favor['444601090'].value - 0.304) < 1e-9, `好感=${s3.favor['444601090'].value.toFixed(3)}`)
断言('心情上升（写成血清素/催产素补丁）', (() => { try { const p = JSON.parse(readFileSync(join(临时家, 'body', 'hormone-patch.json'), 'utf8')); return Number(p.血清素) > 0 || Number(p.催产素) > 0 } catch (e) { return false } })(), '')

console.log('')
if (失败 > 0) {
  console.log(`FAIL：${失败} 项不通过`)
  process.exit(1)
}
rmSync(临时家, { recursive: true, force: true })
console.log('DRIFT OK：记忆 → 好感 → 心情 慢变量跑通')

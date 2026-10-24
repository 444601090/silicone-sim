// dsh-body 冒烟测试：假 ctx 跑一跳，验证读状态 → 推进 → 写盘（关天气，不走网络）
// 用法：node tests/smoke.mjs
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const 临时家 = join(tmpdir(), 'body-smoke-' + Date.now())
mkdirSync(join(临时家, 'body'), { recursive: true })
writeFileSync(join(临时家, 'body', 'config.json'), JSON.stringify({ 天气开关: false }))
// 60 分钟前精力 0.8
const 一小时前 = new Date(Date.now() - 60 * 60 * 1000).toISOString()
writeFileSync(
  join(临时家, 'body', 'state.json'),
  JSON.stringify({ updatedAt: 一小时前, energy: 0.8, stamina: 0.9, awake: true, sensors: { hour: 10 } }),
)
process.env.DSH_HOME = 临时家

const 日志 = []
let 跑一跳 = null

const ctx = {
  logger: {
    info: (s) => 日志.push(['info', s]),
    warn: (s) => 日志.push(['warn', s]),
    debug: (s) => 日志.push(['debug', s]),
  },
  interval: (fn) => {
    跑一跳 = fn
    return () => {}
  },
  effect: (fn) => {
    const r = fn()
    return typeof r === 'function' ? r : () => {}
  },
}

const mod = await import('../lib/host.js')
mod.apply(ctx)

if (typeof 跑一跳 !== 'function') {
  console.error('FAIL: apply 没有挂上定时器回调')
  process.exit(1)
}

跑一跳() // 回调是同步触发 async 的内部跑一跳，等一会
await new Promise((r) => setTimeout(r, 300))

const 状态文件 = join(临时家, 'body', 'state.json')
const 状态 = JSON.parse(readFileSync(状态文件, 'utf8'))
console.log('跑完：', JSON.stringify({ energy: 状态.energy, stamina: 状态.stamina, awake: 状态.awake, hour: 状态.sensors.hour }))

// 白天醒着 60 分钟 → 精力应掉 0.03 左右（±0.005 容差）
if (Math.abs(状态.energy - 0.77) > 0.02) {
  console.error(`FAIL: 精力推进不对（期望约 0.77，实际 ${状态.energy}）`)
  process.exit(1)
}
if (!状态.updatedAt) {
  console.error('FAIL: updatedAt 没写')
  process.exit(1)
}

console.log('\n日志：')
for (const [k, v] of 日志) console.log(` ${k}: ${String(v).slice(0, 150)}`)

rmSync(临时家, { recursive: true, force: true })
console.log('\nSMOKE OK：推进 / 写盘 正常')

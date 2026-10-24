// dsh-mind 冒烟测试：假 ctx 起插件、跑两跳、验证导入/欲望/反馈消费
// 用法：node tests/smoke.mjs
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const 临时家 = join(tmpdir(), 'mind-smoke-' + Date.now())
mkdirSync(join(临时家, 'feiyu-mood'), { recursive: true })
mkdirSync(join(临时家, 'feiyu-favor'), { recursive: true })
writeFileSync(join(临时家, 'feiyu-mood', 'state.json'), JSON.stringify({ mood: 80 }))
writeFileSync(
  join(临时家, 'feiyu-favor', 'state.json'),
  JSON.stringify({ favor: { '444601090': { value: 0.4, talks: 5 } }, energy: 0.55 }),
)
process.env.DSH_HOME = 临时家

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

if (typeof 跑一跳 !== 'function') {
  console.error('FAIL: apply 没有挂上定时器回调')
  process.exit(1)
}

// 第一跳：应该导入旧状态并算出欲望
跑一跳()
await new Promise((r) => setTimeout(r, 100))

const 状态文件 = join(临时家, 'mind', 'state.json')
if (!existsSync(状态文件)) {
  console.error('FAIL: mind/state.json 没生成')
  process.exit(1)
}
const 状态 = JSON.parse(readFileSync(状态文件, 'utf8'))
console.log('第一跳后：', JSON.stringify({ mood: 状态.mood, favor: 状态.favor, energy: 状态.body.energy, desires: 状态.desires }))

if (!状态.hormones || !Number.isFinite(状态.hormones.多巴胺)) {
  console.error('FAIL: 激素没生成')
  process.exit(1)
}
if (!(状态.mood > 0 && 状态.mood < 1)) {
  console.error(`FAIL: 心情应在 0~1（实际 ${状态.mood}）`)
  process.exit(1)
}
if (!状态.favor['444601090']) {
  console.error('FAIL: 好感没从 feiyu-favor 导入')
  process.exit(1)
}

// 第二跳：写一条行为反馈，验证消费
const 反馈文件 = join(临时家, 'mind', 'feedback.jsonl')
writeFileSync(反馈文件, JSON.stringify({ at: new Date().toISOString(), kind: 'chat', result: 'ok', mood: 0.05, favor: 0.02, energy: -0.03, memory: '聊了一句' }) + '\n')

跑一跳()
await new Promise((r) => setTimeout(r, 100))

const 状态2 = JSON.parse(readFileSync(状态文件, 'utf8'))
console.log('第二跳后：', JSON.stringify({ mood: 状态2.mood, favor: 状态2.favor['444601090'].value, energy: 状态2.body.energy, lastTalkAt: 状态2.memory.lastTalkAt, cooldown: 状态2.cooldown }))

const 补丁 = (() => {
  try {
    return JSON.parse(readFileSync(join(临时家, 'body', 'hormone-patch.json'), 'utf8'))
  } catch (e) {
    return null
  }
})()
if (!补丁 || !Object.keys(补丁).some((k) => Number(补丁[k]) !== 0)) {
  console.error('FAIL: 反馈没写成激素补丁（激素归机体管）')
  process.exit(1)
}
if (Math.abs(状态2.favor['444601090'].value - 0.42) > 1e-9) {
  console.error(`FAIL: 好感没加上 0.02（实际 ${状态2.favor['444601090'].value}）`)
  process.exit(1)
}
if (readFileSync(反馈文件, 'utf8').trim() !== '') {
  console.error('FAIL: 反馈消费后没清空')
  process.exit(1)
}
if (!状态2.memory.lastTalkAt) {
  console.error('FAIL: 聊天后 lastTalkAt 没更新')
  process.exit(1)
}

console.log('\n日志：')
for (const [k, v] of 日志) console.log(` ${k}: ${String(v).slice(0, 160)}`)

rmSync(临时家, { recursive: true, force: true })
console.log('\nSMOKE OK：导入 / 欲望 / 反馈消费 / 清空 全部通过')

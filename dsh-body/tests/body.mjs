// dsh-body 生物钟校验：推进函数的极值 / 方向 / 边界 / 夹紧
// 用法：node tests/body.mjs
import { 推进, 昼夜系数, 身体影响激素, 天气影响激素 } from '../lib/host.js'

let 失败 = 0
const 断言 = (名, 条件, 详情 = '') => {
  if (条件) console.log('✓', 名, 详情)
  else {
    console.log('✗', 名, 详情)
    失败 += 1
  }
}
const f = (n) => Number(n).toFixed(3)
const 白天 = new Date('2026-10-24T10:00:00+08:00')
const 深夜 = new Date('2026-10-24T23:30:00+08:00')
const 早上 = new Date('2026-10-24T08:00:00+08:00')

console.log('\n=== 一、醒着的消耗 ===')
const 白天醒 = 推进({ energy: 0.6, stamina: 0.8, awake: true }, 60, 白天)
断言('白天醒着 60 分钟：精力 -0.03、体力 -0.015',
  Math.abs(白天醒.energy - 0.57) < 1e-9 && Math.abs(白天醒.stamina - 0.785) < 1e-9,
  `精力=${f(白天醒.energy)} 体力=${f(白天醒.stamina)}`)

const 深夜醒 = 推进({ energy: 0.6, stamina: 0.8, awake: true }, 60, 深夜)
断言('深夜醒着 60 分钟：精力掉得更快（-0.04）', Math.abs(深夜醒.energy - 0.56) < 1e-9, `精力=${f(深夜醒.energy)}`)

console.log('\n=== 二、睡着的恢复 ===')
const 发呆时 = 推进({ energy: 0.6, stamina: 0.5, awake: true }, 60, 白天, 0.8)
断言('发呆（idle 0.8）时体力不掉反回 +0.02', Math.abs(发呆时.stamina - 0.52) < 1e-9, `体力=${f(发呆时.stamina)}`)

const 睡1 = 推进({ energy: 0.5, stamina: 0.5, awake: false }, 60, 白天)
断言('睡着 60 分钟：精力 +0.12、体力 +0.18',
  Math.abs(睡1.energy - 0.62) < 1e-9 && Math.abs(睡1.stamina - 0.68) < 1e-9,
  `精力=${f(睡1.energy)} 体力=${f(睡1.stamina)}`)

console.log('\n=== 三、自动睡 / 自动醒 ===')
const 困了 = 推进({ energy: 0.14, stamina: 0.8, awake: true }, 1, 白天)
断言('精力 0.14 → 自动睡着', 困了.awake === false && 困了.睡了 === true, `awake=${困了.awake}`)

const 夜里困 = 推进({ energy: 0.3, stamina: 0.8, awake: true }, 1, 深夜)
断言('夜里 23:30 精力 0.3 → 睡着', 夜里困.awake === false && 夜里困.睡了 === true)

const 白天困 = 推进({ energy: 0.3, stamina: 0.8, awake: true }, 1, 白天)
断言('白天 10 点精力 0.3 → 还撑着（不自动睡）', 白天困.awake === true && 白天困.睡了 === false)

const 睡饱 = 推进({ energy: 0.95, stamina: 0.5, awake: false }, 1, 早上)
断言('早上 8 点睡着精力 0.95 → 醒（睡饱）', 睡饱.awake === true && 睡饱.醒了 === true)

const 半夜满 = 推进({ energy: 0.95, stamina: 0.5, awake: false }, 1, 深夜)
断言('夜里 23:30 精力 0.95 → 继续睡（不许半夜醒）', 半夜满.awake === false)

const 早上醒 = 推进({ energy: 0.65, stamina: 0.5, awake: false }, 1, 早上)
断言('早上 8 点睡着精力 0.65 → 醒（白天该醒）', 早上醒.awake === true && 早上醒.醒了 === true)

const 夜里不醒 = 推进({ energy: 0.65, stamina: 0.5, awake: false }, 1, 深夜)
断言('夜里 23:30 睡着精力 0.65 → 继续睡', 夜里不醒.awake === false)

console.log('\n=== 四、边界夹紧 ===')
const 超界 = 推进({ energy: 5, stamina: -3, awake: true }, 1, 白天)
断言('精力 5→1、体力 -3→0', 超界.energy <= 1 && 超界.stamina === 0, `精力=${f(超界.energy)} 体力=${f(超界.stamina)}`)

const 长睡 = 推进({ energy: 0, stamina: 0, awake: false }, 9999, 白天)
断言('一次最多推进 180 分钟（精力不会一夜暴涨）', Math.abs(长睡.energy - 0.36) < 1e-9, `精力=${f(长睡.energy)}`)

console.log('\n=== 五、单调性 ===')
let 上次 = 1.1
let 单调 = true
const 读数 = []
for (let i = 0; i <= 10; i++) {
  const r = 推进({ energy: 1, stamina: 1, awake: true }, i * 10, 白天)
  读数.push(r.energy)
  if (r.energy > 上次 + 1e-9) 单调 = false
  上次 = r.energy
}
断言('醒着时间越长精力越低（单调不增）', 单调, `0=${f(读数[0])} … 100 分钟=${f(读数[10])}`)

console.log('')
if (失败 > 0) {
  console.log(`FAIL：${失败} 项不通过`)
  process.exit(1)
}
console.log('\n=== 六、激素联动 ===')
const 晨 = 昼夜系数(8)
const 夜 = 昼夜系数(23)
断言('早上多巴胺基线高于夜里', 晨.多巴胺 > 夜.多巴胺 && 晨.血清素 > 夜.血清素, `晨 ${晨.多巴胺} / 夜 ${夜.多巴胺}`)

const 默认激素 = { 多巴胺: 0.5, 血清素: 0.65, 催产素: 0.55, 皮质醇: 0.2, 肾上腺素: 0.3 }
const 累 = 身体影响激素({ energy: 0.1, stamina: 0.2, hormones: { ...默认激素 } })
断言('精力见底 → 多巴胺降、皮质醇升', 累.多巴胺 < 0.5 && 累.皮质醇 > 0.2, JSON.stringify({ 多: 累.多巴胺.toFixed(4), 皮: 累.皮质醇.toFixed(4) }))

const 晴 = 天气影响激素({ ...默认激素 }, { text: '晴', temp: 25, humidity: 50 })
断言('晴天 → 血清素升', 晴.血清素 > 0.65)

const 雨 = 天气影响激素({ ...默认激素 }, { text: '雨', temp: 25, humidity: 90 })
断言('雨天 → 皮质醇升', 雨.皮质醇 > 0.2)

if (失败 > 0) {
  console.log(`FAIL：${失败} 项不通过`)
  process.exit(1)
}
console.log('BODY OK：消耗 / 恢复 / 睡醒判断 / 边界 / 激素联动 全部通过')

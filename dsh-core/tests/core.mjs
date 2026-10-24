// dsh-core 测试：快照读取 + 改配置白名单
// 用法：node tests/core.mjs
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const 临时家 = join(tmpdir(), 'core-test-' + Date.now())
mkdirSync(join(临时家, 'body'), { recursive: true })
mkdirSync(join(临时家, 'mind'), { recursive: true })
writeFileSync(
  join(临时家, 'body', 'state.json'),
  JSON.stringify({ updatedAt: new Date().toISOString(), energy: 0.55, stamina: 0.7, awake: true, sensors: { hour: 18, weather: { text: '阴', temp: 19, humidity: 88, at: new Date().toISOString() } } }),
)
writeFileSync(
  join(临时家, 'mind', 'state.json'),
  JSON.stringify({
    updatedAt: new Date().toISOString(),
    mood: 0.7,
    favor: { '444601090': { value: 0.42, talks: 42 } },
    desires: { chat: 0.29, bili: 0.18, sleep: 0.36, idle: 0.25, mc: 0 },
    desireTop: 'sleep',
    memory: { lastTalkAt: null, lastFeedAt: null },
  }),
)
writeFileSync(join(临时家, 'behavior-state.json'), JSON.stringify({ 今日聊天: 1, 今日刷站: 0, 今日分享: 0 }))
writeFileSync(
  join(临时家, 'behavior-config.json'),
  JSON.stringify({ 总开关: true, 试运行: true, 安静时段: [1, 8], 主动聊天: { 开关: true, 冲动阈值: 0.55 } }),
)
process.env.DSH_HOME = 临时家

const mod = await import('../lib/host.js')

let 失败 = 0
const 断言 = (名, 条件, 详情 = '') => {
  if (条件) console.log('✓', 名, 详情)
  else {
    console.log('✗', 名, 详情)
    失败 += 1
  }
}

const d = mod.快照()
console.log('快照：', JSON.stringify({ 机体: d.机体, 思维: d.思维.欲望, 行为: d.行为 }, null, 1).slice(0, 400))

断言('机体快照读到精力/天气', d.机体.ok && d.机体.精力 === 0.55 && d.机体.天气.text === '阴')
断言('思维快照读到心情/好感/欲望', d.思维.ok && d.思维.心情 === 0.7 && d.思维.好感.值 === 0.42 && d.思维.欲望.sleep === 0.36)
断言('行为快照读到今日计数', d.行为.ok && d.行为.今日聊天 === 1 && d.行为.试运行 === true)
断言('配置快照读到阈值', d.配置.冲动阈值 === 0.55 && d.配置.安静时段[0] === 1)

// 改配置：只认白名单
const r1 = mod.改配置({ 试运行: false, 主动聊天: { 冲动阈值: 0.6 }, 乱塞的字段: 123 })
断言('改配置成功', r1.ok === true)
const 新配置 = JSON.parse(readFileSync(join(临时家, 'behavior-config.json'), 'utf8'))
断言('试运行被改成 false', 新配置.试运行 === false)
断言('冲动阈值被改成 0.6', 新配置.主动聊天.冲动阈值 === 0.6)
断言('乱塞的字段被忽略', 新配置.乱塞的字段 === undefined)

// 越界阈值会被夹回来
mod.改配置({ 主动聊天: { 冲动阈值: 9 } })
const 夹后 = JSON.parse(readFileSync(join(临时家, 'behavior-config.json'), 'utf8'))
断言('阈值 9 被夹成 1', 夹后.主动聊天.冲动阈值 === 1)

console.log('')
if (失败 > 0) {
  console.log(`FAIL：${失败} 项不通过`)
  process.exit(1)
}
rmSync(临时家, { recursive: true, force: true })
console.log('CORE OK：快照 / 改配置 全部通过')

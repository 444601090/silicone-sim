// dsh-memory 测试：存储 / 检索 / 遗忘 / 巩固 / 收件箱
// 用法：node tests/memory.mjs
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const 临时家 = join(tmpdir(), 'memory-test-' + Date.now())
mkdirSync(join(临时家, 'memory'), { recursive: true })
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

console.log('\n=== 一、造条目 ===')
const 条1 = mod.造条目({ text: '潜水喵在弄三插件生物钟', kind: 'episodic', tags: ['插件', '生物钟'], mood: 0.5 })
断言('条目有 id/时间/文本/类型', Boolean(条1.id && 条1.at && 条1.text === '潜水喵在弄三插件生物钟' && 条1.kind === 'episodic'), JSON.stringify({ id: 条1.id, kind: 条1.kind }))
const 承诺 = mod.造条目({ text: '答应他每天复盘', kind: 'promise' })
断言('承诺类型保留', 承诺.kind === 'promise')

console.log('\n=== 二、检索（联想）===')
const 条目们 = [
  mod.造条目({ text: '潜水喵喜欢 B 站数据拆解视频', kind: 'preference', tags: ['B站', '视频'] }),
  mod.造条目({ text: '今天把机体插件写好了', kind: 'episodic', tags: ['插件'] }),
  mod.造条目({ text: '他说明天要早起', kind: 'episodic', tags: ['作息'] }),
]
const 结果1 = mod.检索(条目们, 'B站 视频')
断言('查到相关条目', 结果1.length === 1 && 结果1[0].tags.includes('B站'), `命中 ${结果1.length}`)
const 结果2 = mod.检索(条目们, '插件')
断言('按 tag 也能查到', 结果2.length === 1 && 结果2[0].text.includes('机体'))
const 结果3 = mod.检索(条目们, '完全无关的词')
断言('没命中就空', 结果3.length === 0)
const 结果4 = mod.检索(条目们, '早起 作息')
断言('多词命中', 结果4.length === 1 && 结果4[0].text.includes('早起'))

console.log('\n=== 三、遗忘与巩固 ===')
const 弱 = { ...条目们[1], kind: 'episodic', strength: 0.5, accessCount: 0 }
const 强 = { ...条目们[1], kind: 'episodic', strength: 0.5, accessCount: 5 }
const 遗忘后 = mod.遗忘([弱, 强])
const 弱2 = 遗忘后.find((e) => e.accessCount === 0)
const 强2 = 遗忘后.find((e) => e.accessCount === 5)
断言('被反复想起的记得更牢', 强2.strength > 弱2.strength, `${弱2.strength.toFixed(4)} vs ${强2.strength.toFixed(4)}`)
const 承诺2 = mod.遗忘([{ ...承诺, kind: 'promise', strength: 0.5 }])
断言('承诺几乎不忘', 承诺2.length === 1 && 承诺2[0].strength === 0.5)
const 巩固后 = mod.巩固(弱)
断言('巩固后次数 +1、鲜活度回升', 巩固后.accessCount === 1 && 巩固后.strength > 弱.strength)
断言('遗忘会淘汰快没的', mod.遗忘([{ ...弱, strength: 0.005 }]).length === 0)

console.log('\n=== 四、收件箱 + 状态读写（假 ctx）===')
const 状态 = { schema: 1, updatedAt: null, entries: [] }
writeFileSync(join(临时家, 'memory', 'inbox.jsonl'), JSON.stringify({ text: '收件箱里的一条', kind: 'semantic' }) + '\n', 'utf8')
const 吃了 = mod.消费收件箱(状态, null)
断言('收件箱被消费', 吃了 === 1 && 状态.entries.length === 1 && 状态.entries[0].text === '收件箱里的一条')
断言('收件箱清空', readFileSync(join(临时家, 'memory', 'inbox.jsonl'), 'utf8').trim() === '')

const 日志 = []
const 回调们 = []
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
  get: () => undefined,
}
mod.apply(ctx)
const 跑一跳 = 回调们[0]
if (typeof 跑一跳 === 'function') {
  跑一跳()
  const 存 = JSON.parse(readFileSync(join(临时家, 'memory', 'state.json'), 'utf8'))
  断言('apply 后状态文件生成', Array.isArray(存.entries), `条目 ${存.entries.length}`)
} else {
  断言('apply 后定时器注册成功', false)
}

console.log('\n=== 五、情绪一致性 + 联想扩散 ===')
const 正 = mod.造条目({ text: '他夸我今天写得不错', kind: 'episodic', mood: 0.8 })
const 负 = mod.造条目({ text: '他说我今天有点冷淡', kind: 'episodic', mood: -0.8 })
const 好心情 = mod.检索([正, 负], '今天', 5, { 倾向: 0.8 })
const 坏心情 = mod.检索([正, 负], '今天', 5, { 倾向: -0.8 })
断言('好心情时正面记忆排前', 好心情[0].id === 正.id, 好心情[0].text)
断言('坏心情时负面记忆排前', 坏心情[0].id === 负.id, 坏心情[0].text)

const 源 = mod.造条目({ text: '潜水喵在弄生物钟插件', tags: ['生物钟'] })
const 联 = mod.造条目({ text: '夜里激素会往下掉', tags: ['激素'] })
源.links = { [联.id]: 0.8 }
const 扩散 = mod.检索([源, 联], '生物钟', 5, { 倾向: 0 })
断言('联想扩散带出没直接命中的条目', 扩散.length === 2 && 扩散[1].id === 联.id, 扩散.map((x) => x.text).join(' / '))

console.log('')
if (失败 > 0) {
  console.log(`FAIL：${失败} 项不通过`)
  process.exit(1)
}
rmSync(临时家, { recursive: true, force: true })
console.log('MEMORY OK：存储 / 检索 / 遗忘 / 巩固 / 收件箱 全部通过')

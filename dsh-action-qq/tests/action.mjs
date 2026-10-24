// dsh-action-qq 测试：消息压缩 / 挑可回
// 用法：node tests/action.mjs
import { 压消息, 挑可回 } from '../lib/host.js'

let 失败 = 0
const 断言 = (名, 条件, 详情 = '') => {
  if (条件) console.log('✓', 名, 详情)
  else {
    console.log('✗', 名, 详情)
    失败 += 1
  }
}

console.log('\n=== 一、压消息 ===')
const 段1 = [
  { type: 'text', data: { text: '今天好热' } },
  { type: 'image', data: { file: 'x.jpg' } },
  { type: 'face', data: { id: 1 } },
]
断言('文字+图片+表情', 压消息(段1) === '今天好热[图片][表情]', 压消息(段1))
断言('@ 和语音', 压消息([{ type: 'at', data: { qq: '123' } }, { type: 'record', data: {} }]) === '@123[语音]')
断言('空输入不崩', 压消息(null) === '' && 压消息([]) === '')

console.log('\n=== 二、挑可回 ===')
const 消息们 = [
  { user_id: '999', sender: { nickname: '潜水喵' }, message: [{ type: 'text', data: { text: '在吗' } }], time: 1792840000 },
  { user_id: '111', sender: { nickname: '我自己' }, message: [{ type: 'text', data: { text: '我说的话' } }], time: 1792840010 },
  { user_id: '222', sender: { nickname: '路人' }, message: [{ type: 'image', data: {} }], time: 1792840020 },
  { user_id: '333', sender: { nickname: '群友' }, message: [{ type: 'text', data: { text: '这个插件有点意思' } }], time: 1792840030 },
]
const 可回 = 挑可回(消息们, '111', 5)
断言('过滤自己的消息', !可回.some((x) => x.号 === '111'))
断言('只留文字消息（图/语音压缩后为空？不，标了[图片]）', 可回.length === 3, 可回.map((x) => x.文本).join(' / '))
断言('按时间顺序在后', 可回[可回.length - 1].文本 === '这个插件有点意思', 可回.map((x) => x.文本).join(' / '))
const 上限 = 挑可回(消息们, null, 2)
断言('上限生效', 上限.length === 2, String(上限.length))

console.log('')
if (失败 > 0) {
  console.log(`FAIL：${失败} 项不通过`)
  process.exit(1)
}
console.log('ACTION-QQ OK：压消息 / 挑可回 全部通过')

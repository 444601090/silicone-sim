// dsh-better-video 测试：账号洗 / 挑账号 / 挑候选
// 用法：node tests/video.mjs
import { 洗账号, 挑账号, 挑候选 } from '../lib/host.js'

let 失败 = 0
const 断言 = (名, 条件, 详情 = '') => {
  if (条件) console.log('✓', 名, 详情)
  else {
    console.log('✗', 名, 详情)
    失败 += 1
  }
}

console.log('\n=== 一、账号 ===')
const a1 = 洗账号({ 平台: 'bilibili', 名称: '小肥鱼', 凭证: 'SESSDATA=xx' })
断言('账号有 id/平台/名称', Boolean(a1.id) && a1.平台 === 'bilibili' && a1.名称 === '小肥鱼')
const a2 = 洗账号({ 平台: 'weibo', 名称: '', 凭证: '' })
断言('不认识的平台回落 bilibili', a2.平台 === 'bilibili')
断言('没名字给默认名', a2.名称 === '未命名账号')

console.log('\n=== 二、挑账号（轮换）===')
const 账号们 = [
  { id: 'a', 平台: 'bilibili', 名称: 'A', 启用: true, 上次使用: '2026-10-24T10:00:00.000Z' },
  { id: 'b', 平台: 'bilibili', 名称: 'B', 启用: true, 上次使用: null },
  { id: 'c', 平台: 'youtube', 名称: 'C', 启用: false, 上次使用: null },
]
const 挑 = 挑账号(账号们)
断言('跳过硬性停用的', 挑.id === 'b', 挑.id)
断言('轮换：没用的先上', 挑.id !== 'a')

const 全停 = 挑账号(账号们.map((x) => ({ ...x, 启用: false })))
断言('全停用 → 返回 null', 全停 === null)

console.log('\n=== 三、挑候选 ===')
const 数据 = { list: [{ bvid: 'BV1', title: '低', play: 10 }, { bvid: 'BV2', title: '高', play: 300 }, { bvid: '' }] }
const 候选 = 挑候选(数据, 2)
断言('过滤无 bvid、播放降序', 候选.length === 2 && 候选[0].bvid === 'BV2', 候选.map((x) => x.title).join(' / '))
断言('坏输入不崩', 挑候选(null, 3).length === 0)

console.log('')
if (失败 > 0) {
  console.log(`FAIL：${失败} 项不通过`)
  process.exit(1)
}
console.log('VIDEO OK：账号 / 轮换 / 候选 全部通过')

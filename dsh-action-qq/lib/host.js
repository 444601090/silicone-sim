// DSH「逛QQ」（dsh-action-qq）· 宿主半边
//
// 执行插件：中枢说「去逛QQ」时，这里接活——看群消息、挑话回、发出去。
// 走 NapCat 的 HTTP 接口（OneBot 11 标准）。地址/令牌在 %DSH_HOME%/action-qq/config.json 里配。
//
// 能做：看群/私聊消息、发文字/图片（经 NapCat）、挑着回
// 做不了（协议限制，别硬凑）：视频通话、改头像/昵称、QQ空间动态
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

export const name = 'action-qq'

export const inject = ['timer', 'webServer']

const 目录 = process.env.DSH_HOME || join(homedir(), '.dsh')
const 配置目录 = join(目录, 'action-qq')
const 配置文件 = join(配置目录, 'config.json')
const 意图文件 = join(目录, 'behavior', 'intent.json')
const 结果文件 = join(目录, 'behavior', 'actions', 'qq-result.json')

const 轮询毫秒 = 30 * 1000

const 默认配置 = {
  /** NapCat / OneBot 11 HTTP 地址。 */
  地址: 'http://127.0.0.1:3000',
  /** 访问令牌（NapCat 配置里那个）；没设就留空。 */
  令牌: '',
  /** 逛哪个群（群号，逗号分隔）。留空 = 不主动逛，只响应意图。 */
  群号: '',
  /** 每次看多少条历史。 */
  看几条: 20,
}

function 读配置() {
  try {
    const j = JSON.parse(readFileSync(配置文件, 'utf8'))
    return { ...默认配置, ...j }
  } catch (error) {
    return { ...默认配置 }
  }
}

function 原子写(路径, 文本) {
  mkdirSync(dirname(路径), { recursive: true })
  writeFileSync(路径, 文本, 'utf8')
}

/** 调 NapCat 的 OneBot HTTP 接口。 */
async function 调接口(配置, 路径, 参数 = {}, 方法 = 'POST') {
  const 基 = String(配置.地址 || '').replace(/\/$/, '')
  const 头 = { 'content-type': 'application/json' }
  if (配置.令牌) 头.authorization = `Bearer ${配置.令牌}`
  const url = `${基}${路径}`
  const 响应 = await fetch(url, {
    method: 方法,
    headers: 头,
    body: 方法 === 'GET' ? undefined : JSON.stringify(参数),
  })
  const 文本 = await 响应.text()
  let 数据
  try {
    数据 = JSON.parse(文本)
  } catch (error) {
    数据 = { raw: 文本 }
  }
  if (!响应.ok || (数据 && 数据.status === 'failed')) {
    throw new Error(`接口失败 ${路径}：${数据.retcode || 响应.status} ${数据.message || 数据.wording || ''}`)
  }
  return 数据
}

/** 把 OneBot 消息段数组压成可读文本（图片/表情标出来，不展开）。 */
export function 压消息(消息段们) {
  if (!Array.isArray(消息段们)) return ''
  const 出 = []
  for (const 段 of 消息段们) {
    if (!段 || typeof 段 !== 'object') continue
    if (段.type === 'text') 出.push(String(段.data && 段.data.text ? 段.data.text : ''))
    else if (段.type === 'image') 出.push('[图片]')
    else if (段.type === 'face') 出.push('[表情]')
    else if (段.type === 'at') 出.push(`@${(段.data && 段.data.qq) || '某人'}`)
    else if (段.type === 'record') 出.push('[语音]')
    else if (段.type === 'reply') 出.push('[引用]')
  }
  return 出.join('').trim()
}

/** 从群历史里挑出「值得回」的几条：别人的、有内容的、最近的。 */
export function 挑可回(消息们, 我的号 = null, 上限 = 5) {
  if (!Array.isArray(消息们)) return []
  const 出 = []
  for (const m of 消息们) {
    if (!m || typeof m !== 'object') continue
    const 发送者 = String((m.sender && (m.sender.user_id || m.sender.user_id)) || m.user_id || '')
    if (我的号 && 发送者 === String(我的号)) continue
    const 文本 = 压消息(m.message)
    if (!文本) continue
    出.push({
      群: String(m.group_id || ''),
      号: 发送者,
      昵称: String((m.sender && (m.sender.card || m.sender.nickname)) || m.nickname || ''),
      文本: 文本.slice(0, 200),
      时间: Number(m.time) ? new Date(Number(m.time) * 1000).toISOString() : null,
    })
  }
  return 出.slice(-上限)
}

/** 执行「逛QQ」：看配置里的群 → 挑几条 → 写成结果。 */
async function 逛一圈(体) {
  const 配置 = 读配置()
  const 群们 = String(配置.群号 || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (群们.length === 0) {
    体.警告('没配群号，逛不了（先填 action-qq/config.json 的 群号）')
    return false
  }
  for (const 群号 of 群们) {
    try {
      const 数据 = await 调接口(配置, '/get_group_msg_history', { group_id: Number(群号), count: Number(配置.看几条) || 20 })
      const 消息们 = (数据 && (数据.data && 数据.data.messages)) || 数据.data || []
      const 可回 = 挑可回(消息们, null, 5)
      原子写(
        结果文件,
        JSON.stringify(
          { 群: 群号, at: new Date().toISOString(), 可回, 提示: 可回.length ? '挑一条回，或者只看不接' : '群里最近没什么可接的话' },
          null,
          2,
        ),
      )
      体.提示(`逛了群 ${群号}：${可回.length} 条可回`)
      return true
    } catch (error) {
      体.警告(`逛群 ${群号} 失败：${String((error && error.message) || error)}`)
    }
  }
  return false
}

async function 看意图(体) {
  let 意图
  try {
    if (!existsSync(意图文件)) return
    意图 = JSON.parse(readFileSync(意图文件, 'utf8'))
  } catch (error) {
    return
  }
  if (!意图 || 意图.行为 !== 'qq') return
  try {
    原子写(意图文件, '{}')
  } catch (error) {}
  await 逛一圈(体)
}

export function apply(ctx) {
  const 提示 = (t) => {
    try {
      ctx.logger.info(`action-qq: ${t}`)
    } catch (error) {}
  }
  const 警告 = (t) => {
    try {
      ctx.logger.warn(`action-qq: ${t}`)
    } catch (error) {}
  }
  const 体 = { 提示, 警告 }

  let 停表 = null
  ctx.effect(
    () => {
      停表 = ctx.interval(() => {
        看意图(体).catch(() => {})
      }, 轮询毫秒)
      return () => {
        try {
          if (typeof 停表 === 'function') 停表()
          else if (停表 && typeof 停表.dispose === 'function') 停表.dispose()
        } catch (error) {}
        停表 = null
      }
    },
    'dsh-action-qq: 轮询意图',
  )

  let 服务
  try {
    服务 = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
  } catch (error) {
    服务 = undefined
  }
  if (服务 && typeof 服务.register === 'function') {
    try {
      ctx.effect(
        () =>
          服务.register({
            kind: 'exact',
            path: '/dsh-action-qq/data',
            handler: (req, res) => {
              let 结果 = null
              try {
                结果 = JSON.parse(readFileSync(结果文件, 'utf8'))
              } catch (error) {}
              const 配置 = 读配置()
              res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
              res.end(JSON.stringify({ 配置: { ...配置, 令牌: 配置.令牌 ? '***' : '' }, 结果 }))
            },
          }),
        'dsh-action-qq: 数据',
      )
      ctx.effect(
        () =>
          服务.register({
            kind: 'exact',
            path: '/dsh-action-qq/send',
            handler: async (req, res) => {
              try {
                const 块 = []
                for await (const 片 of req) 块.push(片)
                const d = JSON.parse(Buffer.concat(块).toString('utf8') || '{}')
                const 配置 = 读配置()
                const 群号 = Number(d.群 || d.group_id)
                const 文本 = String(d.text || '').trim()
                if (!群号 || !文本) throw new Error('要群号和 text')
                const 数据 = await 调接口(配置, '/send_group_msg', { group_id: 群号, message: [{ type: 'text', data: { text: 文本 } }] })
                res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
                res.end(JSON.stringify({ ok: true, 数据: 数据 && 数据.data }))
              } catch (error) {
                res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
                res.end(JSON.stringify({ ok: false, 说: String((error && error.message) || error) }))
              }
            },
          }),
        'dsh-action-qq: 发消息',
      )
    } catch (error) {}
  }

  提示(`已加载｜NapCat ${读配置().地址}｜群 ${读配置().群号 || '（没配）'}｜轮询 ${轮询毫秒 / 1000} 秒`)
}

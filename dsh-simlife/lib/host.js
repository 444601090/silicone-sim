/**
 * dsh-simlife —— 模拟人生
 * 三合一：机体（body）+ 思维（mind）+ 记忆（memory），各自独立模块，统一入口。
 * 附带：作用域切换（从 dsh-core 搬来，写 %DSH_HOME%/scope.json）。
 *
 * ⚠ 依赖声明必须覆盖三个子模块的并集，且不能写不存在的服务（写错会导致宿主依赖注入失败、整个 host 起不来）。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as 机体 from './mod-body.js'
import * as 思维 from './mod-mind.js'
import * as 记忆 from './mod-memory.js'

export const name = 'simlife'

// 三个子模块 inject 的并集（body: timer/webServer；mind: +llm/agents；memory: +systemPrompt）
export const inject = ['timer', 'webServer', 'llm', 'agents', 'systemPrompt']

const 目录 = process.env.DSH_HOME || join(homedir(), '.dsh')

function 回JSON(res, 码, 对象) {
  try {
    res.writeHead(码, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(对象))
  } catch (error) {}
}

async function 读请求体(req) {
  const 块 = []
  for await (const 片 of req) 块.push(片)
  const 原文 = Buffer.concat(块).toString('utf8')
  return 原文 ? JSON.parse(原文) : {}
}

/** 当前作用域（scope.json 的「作用域」；全局 = .dsh 根）。 */
function 读作用域() {
  try {
    const j = JSON.parse(readFileSync(join(目录, 'scope.json'), 'utf8'))
    return j && j.作用域 && j.作用域 !== '全局' ? String(j.作用域) : '全局'
  } catch (error) {
    return '全局'
  }
}

/** 读 DSH 工作区注册表（storages/workspace.json）里的工作区。 */
function 读工作区们() {
  try {
    const j = JSON.parse(readFileSync(join(目录, 'storages', 'workspace.json'), 'utf8'))
    const t = (j && j.tables && j.tables.workspaces) || {}
    const 出 = []
    for (const w of Object.values(t)) {
      const 名 = String((w && (w.title || w.path)) || '').trim()
      const 路径 = String((w && w.path) || '').trim()
      if (名 && !出.some((x) => x.名 === 名)) 出.push({ 名, 路径 })
    }
    return 出
  } catch (error) {
    return []
  }
}

/** 列出可用作用域：scopes/ 下的目录 + 所有工作区 + 兜底当前。 */
function 扫作用域们() {
  const 出 = ['全局']
  try {
    const 目 = join(目录, 'scopes')
    for (const 名 of readdirSync(目)) {
      try {
        if (statSync(join(目, 名)).isDirectory() && !出.includes(名)) 出.push(名)
      } catch (error) {}
    }
  } catch (error) {}
  // 工作区也算可切换的作用域（切过去会在 scopes/ 下建同名数据目录）
  for (const w of 读工作区们()) {
    if (!出.includes(w.名)) 出.push(w.名)
  }
  const 当前 = 读作用域()
  if (!出.includes(当前)) 出.push(当前)
  return 出
}

/** 工作区列表（给 UI 显示路径用）。 */
function 扫工作区们() {
  return 读工作区们()
}

export function apply(ctx) {
  // 三个模块依次挂载——各自独立，一个出错不拖累另外两个
  const 模块们 = [
    ['机体', 机体],
    ['思维', 思维],
    ['记忆', 记忆],
  ]
  for (const [名, 模] of 模块们) {
    try {
      if (typeof 模.apply === 'function') 模.apply(ctx)
    } catch (error) {
      try {
        ctx.get('webServer') // 只是探一下服务存在
      } catch (error2) {}
    }
  }

  // ---- 作用域切换 ----
  try {
    let 服务
    try {
      服务 = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
    } catch (error) {
      服务 = undefined
    }
    if (服务 && typeof 服务.register === 'function') {
      const 注册 = (路径, 处理) =>
        ctx.effect(() => 服务.register({ kind: 'exact', path: 路径, handler: 处理 }), `dsh-simlife: ${路径}`)

      注册('/dsh-simlife/data', (req, res) => {
        回JSON(res, 200, { 作用域: 读作用域(), 作用域们: 扫作用域们(), 工作区们: 扫工作区们() })
      })

      注册('/dsh-simlife/切换', async (req, res) => {
        try {
          const d = await 读请求体(req)
          const 名 = String(d.作用域 || '').trim()
          if (!名) throw new Error('作用域不能为空')
          if (名 !== '全局' && !existsSync(join(目录, 'scopes', 名))) {
          // 不是已有 scope：再看看是不是一个已注册的工作区，是就建数据目录
          const 工作区 = 读工作区们().some((w) => w.名 === 名)
          if (!工作区) throw new Error('作用域不存在: ' + 名)
          mkdirSync(join(目录, 'scopes', 名), { recursive: true })
        }
          let 原 = {}
          try {
            原 = JSON.parse(readFileSync(join(目录, 'scope.json'), 'utf8'))
          } catch (error) {}
          原.作用域 = 名
          mkdirSync(目录, { recursive: true })
          writeFileSync(join(目录, 'scope.json'), JSON.stringify(原, null, 2), 'utf8')
          回JSON(res, 200, { ok: true, 作用域: 名 })
        } catch (error) {
          回JSON(res, 400, { ok: false, 说: String((error && error.message) || error) })
        }
      })
    }
  } catch (error) {}
}

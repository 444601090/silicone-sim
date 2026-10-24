/**
 * dsh-action-qq —— 浏览器半端（设置里的一页「逛QQ」）
 * ============================================================================
 * 配置：NapCat 地址 / 令牌 / 要逛的群号；看最近一次逛到的可回消息。
 * 数据走 /dsh-action-qq/*。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-action-qq',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const API = '/dsh-action-qq'

    const CSS = `
[data-qq-wrap]{display:flex;flex-direction:column;gap:14px;padding:4px 2px 24px;}
[data-qq-sec]{display:flex;flex-direction:column;gap:8px;padding-top:10px;border-top:1px solid rgba(127,127,127,.18);}
[data-qq-h]{font-size:13px;font-weight:600;opacity:.85;}
[data-qq-row]{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
[data-qq-input]{flex:1;min-width:160px;padding:6px 9px;border-radius:7px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;font-size:13px;}
[data-qq-btn]{padding:6px 12px;border-radius:7px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;font-size:13px;cursor:pointer;}
[data-qq-btn]:hover{background:rgba(127,127,127,.12);}
[data-qq-item]{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border-radius:8px;background:rgba(127,127,127,.06);}
[data-qq-name]{font-size:13px;font-weight:600;}
[data-qq-text]{font-size:13px;line-height:1.5;}
[data-qq-meta]{font-size:11.5px;opacity:.6;}
[data-qq-msg]{font-size:12px;opacity:.75;min-height:16px;}
`

    function Panel() {
      const [d, setD] = React.useState(null)
      const [地址, set地址] = React.useState('')
      const [令牌, set令牌] = React.useState('')
      const [群号, set群号] = React.useState('')
      const [msg, setMsg] = React.useState('')

      const 拉 = async () => {
        try {
          const r = await fetch(API + '/data', { cache: 'no-store' })
          const j = await r.json()
          setD(j)
          const c = j.配置 || {}
          set地址(c.地址 || '')
          set令牌('')
          set群号(c.群号 || '')
        } catch (e) {}
      }
      React.useEffect(() => {
        拉()
      }, [])

      const 保存 = async () => {
        try {
          const 体 = { 地址, 群号, 看几条: (d && d.配置 && d.配置.看几条) || 20 }
          if (令牌) 体.令牌 = 令牌
          const r = await fetch(API + '/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(体),
          })
          const j = await r.json()
          setMsg(j.ok ? '保存好了' : j.说 || '失败')
          拉()
        } catch (e) {
          setMsg('请求失败')
        }
      }

      if (!d) return h('div', { 'data-qq-wrap': '' }, h('div', { 'data-qq-meta': '' }, '正在读配置…'))

      const 结果 = d.结果 || null
      const 可回 = (结果 && 结果.可回) || []
      const 结果行 = 结果
        ? h('div', { 'data-qq-meta': '' }, `群 ${结果.群} · ${结果.at ? String(结果.at).slice(5, 16).replace('T', ' ') : ''} · ${结果.提示 || ''}`)
        : h('div', { 'data-qq-meta': '' }, '还没逛过')
      const 消息块 = 可回.map((m, i) =>
        h('div', { 'data-qq-item': '', key: i, style: { marginTop: 6 } },
          h('div', { 'data-qq-name': '' }, m.昵称 || m.号 || '某人'),
          h('div', { 'data-qq-text': '' }, m.文本),
          h('div', { 'data-qq-meta': '' }, m.时间 ? String(m.时间).slice(5, 16).replace('T', ' ') : '')))

      return h('div', { 'data-qq-wrap': '' },
        h('div', { 'data-qq-sec': '' },
          h('div', { 'data-qq-h': '' }, 'NapCat 连接'),
          h('div', { 'data-qq-row': '' },
            h('input', { 'data-qq-input': '', placeholder: 'NapCat 地址（默认 http://127.0.0.1:3000）', value: 地址, onChange: (e) => set地址(e.target.value) }),
            h('input', { 'data-qq-input': '', placeholder: '令牌（没设就留空）', value: 令牌, onChange: (e) => set令牌(e.target.value), style: { maxWidth: 200 } }),
            h('button', { 'data-qq-btn': '', onClick: 保存 }, '保存')),
          h('div', { 'data-qq-row': '' },
            h('input', { 'data-qq-input': '', placeholder: '要逛的群号（多个用逗号）', value: 群号, onChange: (e) => set群号(e.target.value) })),
          h('div', { 'data-qq-msg': '' }, msg)),
        h('div', { 'data-qq-sec': '' },
          h('div', { 'data-qq-h': '' }, '最近一次逛到的'),
          结果行,
          消息块),
        h('div', { 'data-qq-sec': '' },
          h('div', { 'data-qq-h': '' }, '说明'),
          h('div', { 'data-qq-meta': '' }, '看群消息走 NapCat 的 OneBot HTTP 接口，需要 NapCat 开了 HTTP 服务器。')))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-action-qq')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-action-qq: 设置页样式')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'action-qq', order: 47, label: '更好的QQ浏览' },
          () => h(Panel),
        ))
      },
    }
  },
})

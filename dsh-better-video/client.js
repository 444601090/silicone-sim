/**
 * dsh-better-video —— 浏览器半端（设置里的一页「更好的视频浏览」）
 * ============================================================================
 * 账号管理：加账号（平台/名称/凭证）、启用/停用、删除；看最近一次刷到的候选。
 * 数据走 /dsh-better-video/*。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-better-video',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const API = '/dsh-better-video'

    const CSS = `
[data-bv-wrap]{display:flex;flex-direction:column;gap:14px;padding:4px 2px 24px;}
[data-bv-sec]{display:flex;flex-direction:column;gap:8px;padding-top:10px;border-top:1px solid rgba(127,127,127,.18);}
[data-bv-h]{font-size:13px;font-weight:600;opacity:.85;}
[data-bv-row]{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
[data-bv-input]{flex:1;min-width:160px;padding:6px 9px;border-radius:7px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;font-size:13px;}
[data-bv-select]{padding:6px 9px;border-radius:7px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;font-size:13px;}
[data-bv-btn]{padding:6px 12px;border-radius:7px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;font-size:13px;cursor:pointer;}
[data-bv-btn]:hover{background:rgba(127,127,127,.12);}
[data-bv-item]{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;background:rgba(127,127,127,.06);}
[data-bv-name]{font-size:13px;font-weight:600;}
[data-bv-meta]{font-size:11.5px;opacity:.6;}
[data-bv-msg]{font-size:12px;opacity:.75;min-height:16px;}
`

    function Panel() {
      const [d, setD] = React.useState(null)
      const [平台, set平台] = React.useState('bilibili')
      const [名称, set名称] = React.useState('')
      const [凭证, set凭证] = React.useState('')
      const [msg, setMsg] = React.useState('')

      const 拉 = async () => {
        try {
          const r = await fetch(API + '/data', { cache: 'no-store' })
          setD(await r.json())
        } catch (e) {}
      }
      React.useEffect(() => {
        拉()
      }, [])

      const 提交 = async (路径, 体) => {
        try {
          const r = await fetch(API + 路径, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(体 || {}),
          })
          const j = await r.json()
          setMsg(j.ok ? '好了' : j.说 || '失败')
          if (j.ok) {
            set名称('')
            set凭证('')
            拉()
          }
        } catch (e) {
          setMsg('请求失败')
        }
      }

      if (!d) return h('div', { 'data-bv-wrap': '' }, h('div', { 'data-bv-meta': '' }, '正在读账号…'))

      const 账号们 = d.账号们 || []
      const 结果 = d.结果
      const 平台表 = d.平台们 || []
      const 候选列表 = (结果 && 结果.候选) || []

      const 配置 = d.配置 || {}

      return h('div', { 'data-bv-wrap': '' },
        h('div', { 'data-bv-sec': '' },
          h('div', { 'data-bv-h': '' }, '独立定时（不装行为中枢也能自己刷）'),
          h('div', { 'data-bv-row': '' },
            h('button', { 'data-bv-btn': '', onClick: () => 提交('/config', { 自动刷: !配置.自动刷 }) },
              配置.自动刷 ? '自动刷：开' : '自动刷：关'),
            h('input', {
              'data-bv-input': '', type: 'number', min: 10, value: 配置.间隔分钟 || 180,
              style: { maxWidth: 90 },
              onChange: (e) => {},
              onBlur: (e) => 提交('/config', { 间隔分钟: Number(e.target.value) || 180 }),
            }),
            h('span', { 'data-bv-meta': '' }, '分钟刷一次'),
            h('button', { 'data-bv-btn': '', onClick: () => 提交('/config', { 响应中枢: 配置.响应中枢 === false }) },
              配置.响应中枢 === false ? '响应中枢：关' : '响应中枢：开'),
            h('input', {
              'data-bv-input': '', placeholder: '时段 9-23（空=不限）', value: 配置.时段 || '',
              style: { maxWidth: 150 },
              onChange: (e) => {},
              onBlur: (e) => 提交('/config', { 时段: e.target.value }),
            })),
          h('div', { 'data-bv-meta': '' }, 配置.上次自动刷 ? `上次自动刷：${String(配置.上次自动刷).slice(5, 16).replace('T', ' ')}` : '还没自动刷过')),

        h('div', { 'data-bv-sec': '' },
          h('div', { 'data-bv-h': '' }, '添加账号'),
          h('div', { 'data-bv-row': '' },
            h('select', { 'data-bv-select': '', value: 平台, onChange: (e) => set平台(e.target.value) },
              平台表.map((p) => h('option', { key: p.id, value: p.id }, p.名))),
            h('input', { 'data-bv-input': '', placeholder: '账号名（比如：小肥鱼）', value: 名称, onChange: (e) => set名称(e.target.value) }),
            h('input', { 'data-bv-input': '', placeholder: '凭证（cookie / token；先留空也行）', value: 凭证, onChange: (e) => set凭证(e.target.value) }),
            h('button', { 'data-bv-btn': '', onClick: () => 提交('/accounts/add', { 平台, 名称, 凭证 }) }, '加')),
          h('div', { 'data-bv-msg': '' }, msg)),

        h('div', { 'data-bv-sec': '' },
          h('div', { 'data-bv-h': '' }, `账号（${账号们.length}）`),
          账号们.length === 0
            ? h('div', { 'data-bv-meta': '' }, '还没有账号——加一个，刷新时会按顺序轮换用')
            : 账号们.map((a) =>
                h('div', { 'data-bv-item': '', key: a.id },
                  h('div', { style: { flex: 1 } },
                    h('div', { 'data-bv-name': '' }, a.名称),
                    h('div', { 'data-bv-meta': '' },
                      `${(平台表.find((p) => p.id === a.平台) || {}).名 || a.平台} · ${a.启用 === false ? '停用' : '启用'} · 上次用 ${a.上次使用 ? String(a.上次使用).slice(5, 16).replace('T', ' ') : '还没用过'}`)),
                  h('button', { 'data-bv-btn': '', onClick: () => 提交('/accounts/update', { id: a.id, 启用: a.启用 === false }) }, a.启用 === false ? '启用' : '停用'),
                  h('button', { 'data-bv-btn': '', onClick: () => 提交('/accounts/remove', { id: a.id }) }, '删')))),

        h('div', { 'data-bv-sec': '' },
          h('div', { 'data-bv-h': '' }, '最近一次刷到的'),
          结果
            ? h('div', { 'data-bv-meta': '' }, `${结果.账号名 || ''} · ${结果.关键词 || ''} · ${结果.at ? String(结果.at).slice(5, 16).replace('T', ' ') : ''}`)
            : h('div', { 'data-bv-meta': '' }, '还没刷过'),
          候选列表.map((v, i) =>
            h('div', { 'data-bv-item': '', key: i, style: { marginTop: 6 } },
              h('div', { style: { flex: 1 } },
                h('div', { 'data-bv-name': '' }, v.title),
                h('div', { 'data-bv-meta': '' }, `${v.author} · ${v.play} 播放 · ${v.duration || ''}`))))))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-better-video')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-better-video: 设置页样式')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'better-video', order: 48, label: '更好的上网冲浪' },
          () => h(Panel),
        ))
      },
    }
  },
})

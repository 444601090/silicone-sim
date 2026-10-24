/**
 * dsh-memory —— 浏览器半端（设置里的一页「记忆」）
 * ============================================================================
 * 自注册脚本（和 dsh-feiyu-mood 同一约定）：
 *     window.__ModuleLoader__.load({ id: '<包名>', factory: (require) => ({ inject, apply }) })
 *
 * 这一页：看记忆条目（按联想检索）、记一条、看淡忘程度。
 * 数据走宿主的 /dsh-memory/data、/dsh-memory/query、/dsh-memory/add。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-memory',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const API = '/dsh-memory'

    const CSS = `
[data-mm-wrap]{display:flex;flex-direction:column;gap:14px;padding:4px 2px 24px;}
[data-mm-hero]{display:flex;gap:20px;flex-wrap:wrap;align-items:flex-end;padding:14px 16px;border-radius:12px;background:rgba(127,127,127,.08);}
[data-mm-big]{font-size:28px;font-weight:600;line-height:1;}
[data-mm-sub]{font-size:12px;opacity:.65;margin-top:4px;}
[data-mm-sec]{display:flex;flex-direction:column;gap:8px;padding-top:10px;border-top:1px solid rgba(127,127,127,.18);}
[data-mm-h]{font-size:13px;font-weight:600;opacity:.85;}
[data-mm-row]{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
[data-mm-input]{flex:1;min-width:200px;padding:6px 9px;border-radius:7px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;font-size:13px;}
[data-mm-btn]{padding:6px 12px;border-radius:7px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;font-size:13px;cursor:pointer;}
[data-mm-btn]:hover{background:rgba(127,127,127,.12);}
[data-mm-item]{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border-radius:8px;background:rgba(127,127,127,.06);}
[data-mm-text]{font-size:13px;line-height:1.5;}
[data-mm-meta]{font-size:11.5px;opacity:.6;display:flex;gap:10px;flex-wrap:wrap;}
[data-mm-kind]{display:inline-block;font-size:11px;padding:0 6px;border-radius:5px;background:rgba(127,127,127,.18);}
[data-mm-msg]{font-size:12px;opacity:.75;min-height:16px;}
`

    const 类型名 = { promise: '承诺', preference: '偏好', semantic: '事实', episodic: '情景' }

    const 强度条 = (v) => {
      const n = Math.max(0, Math.min(1, Number(v) || 0))
      return '█'.repeat(Math.round(n * 10)) + '░'.repeat(10 - Math.round(n * 10))
    }

    function Panel() {
      const [d, setD] = React.useState(null)
      const [查询, set查询] = React.useState('')
      const [结果, set结果] = React.useState(null)
      const [新记忆, set新记忆] = React.useState('')
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

      const 搜索 = async () => {
        try {
          const r = await fetch(API + '/query', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: 查询, 条数: 20 }),
          })
          const j = await r.json()
          set结果(j.结果 || [])
          setMsg(j.ok ? `查到 ${(j.结果 || []).length} 条（查过就算想起，会变鲜活）` : j.说 || '')
        } catch (e) {
          setMsg('搜索失败')
        }
      }

      const 加 = async () => {
        const t = 新记忆.trim()
        if (!t) return
        try {
          const r = await fetch(API + '/add', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: t, kind: 'semantic' }),
          })
          const j = await r.json()
          setMsg(j.ok ? '记下了' : j.说 || '失败')
          set新记忆('')
          拉()
        } catch (e) {
          setMsg('提交失败')
        }
      }

      if (!d) return h('div', { 'data-mm-wrap': '' }, h('div', { 'data-mm-sub': '' }, '正在读记忆…'))

      const 状态 = d.状态 || {}
      const 条目们 = Array.isArray(状态.entries) ? 状态.entries : []
      const 鲜活 = 条目们.filter((e) => (e.strength || 0) > 0.3).length
      const 展示 = 结果 === null ? 条目们.slice(-20).reverse() : 结果

      const 条目 = (e, i) =>
        h('div', { 'data-mm-item': '', key: e.id || i },
          h('div', { 'data-mm-text': '' }, e.text),
          h('div', { 'data-mm-meta': '' },
            h('span', { 'data-mm-kind': '' }, 类型名[e.kind] || e.kind),
            h('span', '', '鲜活 ' + 强度条(e.strength)),
            h('span', '', '想起 ' + (e.accessCount || 0) + ' 次'),
            h('span', '', e.at ? String(e.at).slice(5, 16).replace('T', ' ') : '')))

      return h('div', { 'data-mm-wrap': '' },
        h('div', { 'data-mm-hero': '' },
          h('div', {}, h('div', { 'data-mm-big': '' }, String(条目们.length)), h('div', { 'data-mm-sub': '' }, '记忆条数')),
          h('div', {}, h('div', { 'data-mm-big': '' }, String(鲜活)), h('div', { 'data-mm-sub': '' }, '还鲜活（>0.3）'))),

        h('div', { 'data-mm-sec': '' },
          h('div', { 'data-mm-h': '' }, '联想检索'),
          h('div', { 'data-mm-row': '' },
            h('input', {
              'data-mm-input': '',
              placeholder: '输入几个词，比如「B站 视频」「插件 生物钟」',
              value: 查询,
              onChange: (e) => set查询(e.target.value),
              onKeyDown: (e) => {
                if (e.key === 'Enter') 搜索()
              },
            }),
            h('button', { 'data-mm-btn': '', onClick: 搜索 }, '查'),
            h('button', { 'data-mm-btn': '', onClick: () => { set结果(null); setMsg('') } }, '看全部')),
          h('div', { 'data-mm-msg': '' }, msg)),

        h('div', { 'data-mm-sec': '' },
          h('div', { 'data-mm-h': '' }, 结果 === null ? '最近 20 条' : '检索结果'),
          展示.length === 0
            ? h('div', { 'data-mm-sub': '' }, 结果 === null ? '还没有记忆' : '没查到——换个词试试')
            : 展示.map(条目)),

        h('div', { 'data-mm-sec': '' },
          h('div', { 'data-mm-h': '' }, '手动记一条'),
          h('div', { 'data-mm-row': '' },
            h('input', {
              'data-mm-input': '',
              placeholder: '一句事实/偏好，比如「他喜欢数据拆解类视频」',
              value: 新记忆,
              onChange: (e) => set新记忆(e.target.value),
              onKeyDown: (e) => {
                if (e.key === 'Enter') 加()
              },
            }),
            h('button', { 'data-mm-btn': '', onClick: 加 }, '记下'))),

        h('div', { 'data-mm-sub': '' }, '记忆会淡忘：越久越淡，被反复想起的记得更久，承诺几乎不忘。'),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-memory')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-memory: 设置页样式')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'memory', order: 49, label: '硅基模拟-记忆' },
          () => h(Panel),
        ))
      },
    }
  },
})

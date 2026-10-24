/**
 * dsh-behavior —— 浏览器半端（设置里的一页「行为」）
 * ============================================================================
 * 自注册脚本（和 dsh-feiyu-mood 同一约定）：
 *     window.__ModuleLoader__.load({ id: '<包名>', factory: (require) => ({ inject, apply }) })
 *
 * 这一页：看今日行为，调开关（总开关/试运行/安静时段/冷却/阈值/文案/刷站）。
 * 数据走宿主的 /dsh-behavior/data 和 /dsh-behavior/config。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-behavior',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const API = '/dsh-behavior'

    const CSS = `
[data-bh-wrap]{display:flex;flex-direction:column;gap:14px;padding:4px 2px 24px;}
[data-bh-hero]{display:flex;gap:18px;flex-wrap:wrap;align-items:flex-end;padding:14px 16px;border-radius:12px;background:rgba(127,127,127,.08);}
[data-bh-big]{font-size:30px;font-weight:600;line-height:1;}
[data-bh-sub]{font-size:12px;opacity:.65;margin-top:4px;}
[data-bh-sec]{display:flex;flex-direction:column;gap:8px;padding-top:10px;border-top:1px solid rgba(127,127,127,.18);}
[data-bh-h]{font-size:13px;font-weight:600;opacity:.85;}
[data-bh-row]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
[data-bh-grow]{flex:1;min-width:170px;}
[data-bh-label]{font-size:13px;}
[data-bh-note]{font-size:12px;opacity:.6;line-height:1.5;}
[data-bh-num]{width:110px;padding:6px 9px;border-radius:7px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;font-size:13px;}
[data-bh-text]{flex:1;min-width:220px;padding:6px 9px;border-radius:7px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;font-size:13px;}
[data-bh-btn]{padding:6px 12px;border-radius:7px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;font-size:13px;cursor:pointer;}
[data-bh-btn]:hover{background:rgba(127,127,127,.12);}
[data-bh-btn][data-on]{border-color:rgba(90,170,120,.8);color:rgb(90,170,120);}
[data-bh-btn][data-off]{border-color:rgba(200,110,110,.8);color:rgb(200,120,120);}
[data-bh-msg]{font-size:12px;opacity:.75;min-height:16px;}
`

    function Panel() {
      const [d, setD] = React.useState(null)
      const [msg, setMsg] = React.useState('')

      const 拉 = async () => {
        try {
          const r = await fetch(API + '/data', { cache: 'no-store' })
          setD(await r.json())
        } catch (e) {}
      }
      React.useEffect(() => {
        let 活 = true
        const 跑 = async () => {
          try {
            const r = await fetch(API + '/data', { cache: 'no-store' })
            const j = await r.json()
            if (活) setD(j)
          } catch (e) {}
        }
        跑()
        const 表 = setInterval(跑, 5000)
        return () => {
          活 = false
          clearInterval(表)
        }
      }, [])

      const 提交 = async (patch) => {
        try {
          const r = await fetch(API + '/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(patch),
          })
          const j = await r.json()
          setMsg(j.说 || '')
          拉()
        } catch (e) {
          setMsg('提交失败')
        }
      }

      if (!d) return h('div', { 'data-bh-wrap': '' }, h('div', { 'data-bh-note': '' }, '正在读行为状态…'))

      const s = d.状态 || {}
      const c = d.配置 || {}
      const 聊 = c.主动聊天 || {}
      const 刷 = c.刷站 || {}
      const 安 = Array.isArray(c.安静时段) ? c.安静时段 : [1, 8]

      // ---- 小部件 ----
      const 开关钮 = (标签, 开, 点) =>
        h('button', { 'data-bh-btn': '', 'data-on': 开 ? '' : undefined, 'data-off': 开 ? undefined : '', onClick: 点 },
          `${标签}：${开 ? '开' : '关'}`)

      const 行 = (左, 右, 注) =>
        h('div', { 'data-bh-row': '', key: 左 },
          h('div', { 'data-bh-grow': '' },
            h('div', { 'data-bh-label': '' }, 左),
            注 ? h('div', { 'data-bh-note': '' }, 注) : null),
          右)

      const 数字 = (值, 单位, 提交值, 最小, 最大) =>
        h('div', { 'data-bh-row': '', style: { gap: 6 } },
          h('input', {
            'data-bh-num': '',
            type: 'number',
            min: 最小,
            max: 最大,
            defaultValue: String(值),
            onBlur: (e) => {
              const n = Number(e.target.value)
              if (Number.isFinite(n)) 提交值(n)
            },
          }),
          h('span', { 'data-bh-note': '' }, 单位))

      const 文本 = (值, 提交值) =>
        h('input', {
          'data-bh-text': '',
          defaultValue: 值 || '',
          onBlur: (e) => 提交值(e.target.value),
        })

      return h('div', { 'data-bh-wrap': '' },
        h('div', { 'data-bh-hero': '' },
          h('div', {},
            h('div', { 'data-bh-big': '' }, String(s.今日聊天 || 0)),
            h('div', { 'data-bh-sub': '' }, '今日聊天')),
          h('div', {},
            h('div', { 'data-bh-big': '' }, String(s.今日刷站 || 0)),
            h('div', { 'data-bh-sub': '' }, '今日刷站')),
          h('div', {},
            h('div', { 'data-bh-big': '' }, String((s.未回音 && s.未回音.次数) || 0)),
            h('div', { 'data-bh-sub': '' }, '未回音')),
          h('div', {},
            h('div', { 'data-bh-big': '' }, s.上次开口 ? String(s.上次开口).slice(11, 16) : '—'),
            h('div', { 'data-bh-sub': '' }, '上次开口'))),

        h('div', { 'data-bh-sec': '' },
          h('div', { 'data-bh-h': '' }, '总开关'),
          行('总开关', 开关钮('总开关', c.总开关 !== false, () => 提交({ 总开关: c.总开关 === false })), '关掉就完全不动'),
          行('试运行', 开关钮('试运行', c.试运行 !== false, () => 提交({ 试运行: c.试运行 === false })), '只记账、不真发；确认行为正常后再关'),
          行('安静时段', h('div', { 'data-bh-row': '', style: { gap: 6 } },
            数字(安[0], '点起', (n) => 提交({ 安静时段: [n, 安[1]] }), 0, 23),
            数字(安[1], '点止', (n) => 提交({ 安静时段: [安[0], n] }), 0, 23)), '这段时间不主动开口')),

        h('div', { 'data-bh-sec': '' },
          h('div', { 'data-bh-h': '' }, '聊天'),
          行('欲望阈值', 数字(聊.冲动阈值, '', (n) => 提交({ 主动聊天: { 冲动阈值: n } }), 0, 1),
            '冲动 ≥ 阈值才开口；阈值越低越爱说话'),
          行('冷却（分钟）', 数字(聊.冷却分钟, '分钟', (n) => 提交({ 主动聊天: { 冷却分钟: n } }), 0, 1440), '刚开过口这段时间内不再开'),
          行('触发文案', 文本(聊.触发文案, (v) => 提交({ 主动聊天: { 触发文案: v } })), '这是起话头的动机，不是要说的话')),

        h('div', { 'data-bh-sec': '' },
          h('div', { 'data-bh-h': '' }, '刷站'),
          行('刷站开关', 开关钮('刷站', 刷.开关 !== false, () => 提交({ 刷站: { 开关: 刷.开关 === false } })), ''),
          行('间隔（分钟）', 数字(刷.间隔分钟, '分钟', (n) => 提交({ 刷站: { 间隔分钟: n } }), 1, 1440), '两轮之间至少隔这么久'),
          行('每日上限', 数字(刷.每日上限, '轮', (n) => 提交({ 刷站: { 每日上限: n } }), 0, 100), ''),
          行('刷站文案', 文本(刷.刷站文案, (v) => 提交({ 刷站: { 刷站文案: v } })), '')),
        h('div', { 'data-bh-msg': '' }, msg),
        h('div', { 'data-bh-note': '' }, '改完下一跳（≤60 秒）生效。行为由思维的欲望驱动，不自己掷骰子。'),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-behavior')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-behavior: 设置页样式')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'behavior', order: 48, label: '硅基模拟-行为' },
          () => h(Panel),
        ))
      },
    }
  },
})

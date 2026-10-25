/**
 * dsh-mind —— 浏览器半端（设置里的一页「思维」）
 * ============================================================================
 * 自注册脚本（和 dsh-feiyu-mood 同一约定）：
 *     window.__ModuleLoader__.load({ id: '<包名>', factory: (require) => ({ inject, apply }) })
 *
 * 这一页：看心情/好感/欲望，调「心情低落怎么放大想聊」和「每日结算（陪伴/冷落）」。
 * 数据走宿主的 /dsh-mind/data 和 /dsh-mind/config。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-mind',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const API = '/dsh-mind'

    const CSS = `
[data-md-wrap]{display:flex;flex-direction:column;gap:14px;padding:4px 2px 24px;}
[data-md-hero]{display:grid;grid-template-columns:1fr 1fr;gap:16px 18px;align-items:end;padding:14px 16px;border-radius:12px;background:rgba(127,127,127,.08);}
[data-md-big]{font-size:30px;font-weight:600;line-height:1;}
[data-md-sub]{font-size:12px;opacity:.65;margin-top:4px;}
[data-md-bar]{height:7px;border-radius:4px;background:rgba(127,127,127,.22);overflow:hidden;margin-top:6px;min-width:160px;}
[data-md-bar>i]{display:block;height:100%;border-radius:4px;background:rgba(90,170,120,.9);}
[data-md-bar.desire>i]{background:rgba(110,130,220,.9);}
[data-md-bar.stress>i]{background:rgba(220,110,110,.9);}
[data-md-sec]{display:flex;flex-direction:column;gap:8px;padding-top:10px;border-top:1px solid rgba(127,127,127,.18);}
[data-md-h]{font-size:13px;font-weight:600;opacity:.85;}
[data-md-row]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
[data-md-grow]{flex:1;min-width:170px;}
[data-md-label]{font-size:13px;}
[data-md-note]{font-size:12px;opacity:.6;line-height:1.5;}
[data-md-num]{width:110px;padding:6px 9px;border-radius:7px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;font-size:13px;}
[data-md-msg]{font-size:12px;opacity:.75;min-height:16px;}
`

    const 欲望中文 = { eat: '想吃饭', sleep: '想睡觉', fun: '想娱乐', idle: '发呆', chat: '想聊天' }
    const 条 = (v) => Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 100)
    // 欲望不显示精确小数：人对自己「有多想」只有模糊感觉
    const 欲望档 = (v) => {
      const n = Number(v) || 0
      if (n >= 0.65) return '很想'
      if (n >= 0.4) return '有点想'
      if (n >= 0.2) return '一点点'
      return '没什么'
    }

    // ⚠ 普通函数（不是组件）：不能在里面用 hooks —— 它是被 Panel 直接调用的，
    //   在里面放 useState 会让 hooks 数量随渲染变化（React #310 崩页面）。
    function 数值行(左, 值, 单位, 注, 提交, 小数) {
      return h('div', { 'data-md-row': '' },
        h('div', { 'data-md-grow': '' },
          h('div', { 'data-md-label': '' }, 左),
          注 ? h('div', { 'data-md-note': '' }, 注) : null),
        h('input', {
          'data-md-num': '',
          key: String(值),
          type: 'number',
          step: 小数 ? '0.5' : '1',
          defaultValue: String(值),
          onBlur: (e) => {
            const n = Number(e.target.value)
            if (Number.isFinite(n)) 提交(n)
          },
        }),
        h('span', { 'data-md-note': '' }, 单位))
    }

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

      if (!d) return h('div', { 'data-md-wrap': '' }, h('div', { 'data-md-note': '' }, '正在读思维状态…'))

      const s = d.状态 || {}
      const c = d.配置 || {}
      const 好 = s.favor || {}
      const 键 = Object.keys(好).sort((a, b) => (好[b].talks || 0) - (好[a].talks || 0))[0]
      const 好感 = 键 ? 好[键] : null
      const 关系 = d.关系 || {}
      const 感情值 = Number(关系.感情) || 0
      const 活性 = d.活性
      const 耐力 = d.耐力
      const 欲 = s.desires || {}
      const 欲排 = Object.entries(欲).sort((a, b) => b[1] - a[1])

      return h('div', { 'data-md-wrap': '' },
        h('div', { 'data-md-hero': '' },
          h('div', {},
            h('div', { 'data-md-big': '' }, Math.round((Number(s.mood) || 0) * 100) + '%'),
            h('div', { 'data-md-sub': '' }, '心情'),
            h('div', { 'data-md-bar': '' }, h('i', { style: { width: 条(s.mood) + '%' } }))),
          h('div', {},
            h('div', { 'data-md-big': '' }, Math.round(感情值 * 100) + '%'),
            h('div', { 'data-md-sub': '' }, `感情（聊过 ${好感 ? 好感.talks || 0 : 0} 次）`),
            h('div', { 'data-md-bar': '' }, h('i', { style: { width: 条(感情值) + '%' } }))),
          h('div', {},
            h('div', { 'data-md-big': '' }, 活性 === null || 活性 === undefined ? '—' : 活性 + '%'),
            h('div', { 'data-md-sub': '' }, '活性'),
            h('div', { 'data-md-bar': '' }, h('i', { style: { width: (Number(活性) || 0) + '%' } }))),
          h('div', {},
            h('div', { 'data-md-big': '' }, 耐力 === null || 耐力 === undefined ? '—' : 耐力 + '%'),
            h('div', { 'data-md-sub': '' }, '耐力'),
            h('div', { 'data-md-bar': '' }, h('i', { style: { width: (Number(耐力) || 0) + '%' } })))),

        h('div', { 'data-md-sec': '' },
          h('div', { 'data-md-h': '' }, '此刻'),
          (() => {
            const 激 = s.hormones || {}
            const 位 = (n, lo, hi) => Math.min(1, Math.max(0, (Number(n) - lo) / (hi - lo)))
            const 多 = 位(激.多巴胺, 10, 90)
            const 血 = 位(激.血清素, 101, 283)
            const 催 = 位(激.催产素, 1, 10)
            const 皮 = 位(激.皮质醇, 138, 690)
            const 肾 = 位(激.肾上腺素, 10, 50)
            const 价 = 0.4 * 多 + 0.3 * 血 + 0.2 * 催 - 0.5 * 皮 + 0.1 * 肾
            const 唤醒 = 多 + 肾
            let 心情词 = '平静'
            if (皮 > 0.75) 心情词 = '紧张'
            else if (价 > 0.65 && 唤醒 > 0.7) 心情词 = '兴奋'
            else if (价 > 0.6) 心情词 = '满足'
            else if (价 < 0.35) 心情词 = '低落'
            else if (催 > 0.7) 心情词 = '温暖'
            else if (价 > 0.5) 心情词 = '平静'
            return [
              h('div', { 'data-md-row': '', key: '心情' },
                h('div', { 'data-md-grow': '' }, h('div', { 'data-md-label': '' }, '心情')),
                h('span', { 'data-md-note': '', style: { fontSize: 15, fontWeight: 600 } }, 心情词)),
              h('div', { 'data-md-row': '', key: '状态' },
                h('div', { 'data-md-grow': '' }, h('div', { 'data-md-label': '' }, '状态')),
                h('span', { 'data-md-note': '', style: { fontSize: 15, fontWeight: 600 } }, d.睡眠状态 || '未知')),
              d.活动 ? h('div', { 'data-md-row': '', key: '活动' },
                h('div', { 'data-md-grow': '' }, h('div', { 'data-md-label': '' }, '正在做')),
                h('span', { 'data-md-note': '', style: { fontSize: 15, fontWeight: 600 } },
                  d.活动.名 === '睡觉' ? '睡着了' : d.活动.名 + (d.活动.到 ? `（剩 ${Math.max(0, Math.round((Date.parse(d.活动.到) - Date.now()) / 60000))} 分钟）` : ''))) : null,
            ]
          })()),

        h('div', { 'data-md-sec': '' },
          h('div', { 'data-md-h': '' }, 欲排[0] ? `欲望明细（最想要：${欲望中文[欲排[0][0]] || 欲排[0][0]}）` : '欲望明细'),
          欲排.map(([名, 值]) => h('div', { 'data-md-row': '', key: 名 },
            h('div', { 'data-md-grow': '' }, h('div', { 'data-md-label': '' }, 欲望中文[名] || 名)),
            h('span', { 'data-md-note': '' }, 欲望档(值))))),

        h('div', { 'data-md-msg': '' }, msg),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-mind')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-mind: 设置页样式')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'mind', order: 47, label: '硅基模拟-思维' },
          () => h(Panel),
        ))
      },
    }
  },
})

/**
 * dsh-core —— 浏览器半端（设置里的一页「三插件状态」）
 * ============================================================================
 * 自注册脚本（和 dsh-feiyu-mood / dsh-bili-scroll 同一约定）：
 *
 *     window.__ModuleLoader__.load({ id: '<包名>', factory: (require) => ({ inject, apply }) })
 *
 * 这一页做两件事：
 *   1. 把机体 / 思维 / 行为三插件的状态画成卡片（每 5 秒自动刷新）
 *   2. 给几个总开关：试运行、总开关、欲望阈值
 * 数据走宿主那边的 /dsh-core/data 和 /dsh-core/config（见 lib/host.js）。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-core',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const API = '/dsh-core'

    const CSS = `
[data-core-wrap]{display:flex;flex-direction:column;gap:14px;padding:4px 2px 24px;}
[data-core-grid]{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;}
[data-core-card]{border:1px solid rgba(127,127,127,.22);border-radius:10px;padding:12px 14px;background:rgba(127,127,127,.05);}
[data-core-h]{font-size:13px;font-weight:600;opacity:.85;margin-bottom:8px;}
[data-core-row]{display:flex;justify-content:space-between;align-items:center;font-size:12.5px;opacity:.85;padding:2px 0;}
[data-core-val]{font-weight:600;opacity:1;}
[data-core-bar]{height:6px;border-radius:3px;background:rgba(127,127,127,.22);overflow:hidden;margin:2px 0 6px;}
[data-core-bar>i]{display:block;height:100%;border-radius:3px;background:rgba(90,170,120,.9);}
[data-core-bar.sleep>i]{background:rgba(110,130,220,.9);}
[data-core-muted]{font-size:11.5px;opacity:.55;margin-top:4px;}
[data-core-actions]{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding-top:10px;border-top:1px solid rgba(127,127,127,.18);}
[data-core-btn]{padding:6px 12px;border-radius:7px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;font-size:13px;cursor:pointer;}
[data-core-btn]:hover{background:rgba(127,127,127,.12);}
[data-core-btn][data-on]{border-color:rgba(90,170,120,.8);color:rgb(90,170,120);}
[data-core-btn][data-off]{border-color:rgba(200,110,110,.8);color:rgb(200,120,120);}
[data-core-msg]{font-size:12px;opacity:.7;min-height:16px;}
`

    const 欲望中文 = { chat: '想聊天', bili: '想刷视频', sleep: '想睡觉', idle: '发呆', mc: '玩游戏' }
    const 条 = (v) => Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 100)

    const 卡 = (标题, 行们, 额外) =>
      h('div', { 'data-core-card': '' },
        h('div', { 'data-core-h': '' }, 标题),
        行们,
        额外 || null)

    const 行 = (左, 右) =>
      h('div', { 'data-core-row': '', key: 左 + String(右) },
        h('span', '', 左),
        h('span', { 'data-core-val': '' }, 右))

    const 条行 = (值, cls) =>
      h('div', { 'data-core-bar': '', className: cls || '' }, h('i', { style: { width: 条(值) + '%' } }))

    function Panel() {
      const [d, setD] = React.useState(null)
      const [msg, setMsg] = React.useState('')

      React.useEffect(() => {
        let 活 = true
        const 拉 = async () => {
          try {
            const r = await fetch(API + '/data', { cache: 'no-store' })
            const j = await r.json()
            if (活) setD(j)
          } catch (e) {}
        }
        拉()
        const 表 = setInterval(拉, 5000)
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
          const r2 = await fetch(API + '/data', { cache: 'no-store' })
          setD(await r2.json())
        } catch (e) {
          setMsg('提交失败')
        }
      }

      const 切 = async (id) => {
        try {
          const 当前 = d.开关 && d.开关[id] !== false
          const r = await fetch(API + '/switch', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ 插件: id, 启用: !当前 }),
          })
          const j = await r.json()
          setMsg(j.ok ? '切好了' : j.说 || '失败')
          const r2 = await fetch(API + '/data', { cache: 'no-store' })
          setD(await r2.json())
        } catch (e) {
          setMsg('切换失败')
        }
      }

      if (!d) return h('div', { 'data-core-wrap': '' }, h('div', { 'data-core-muted': '' }, '正在读三插件状态…'))

      const 机体 = d.机体 || {}
      const 思维 = d.思维 || {}
      const 行为 = d.行为 || {}
      const 欲 = 思维.欲望 || {}
      const 欲排 = Object.entries(欲).sort((a, b) => b[1] - a[1])
      const 阈值 = (d.配置 && d.配置.冲动阈值) || 0.55

      return h('div', { 'data-core-wrap': '' },
        h('div', { 'data-core-grid': '' },
          卡('机体', 机体.ok
            ? [
                行('精力', (Number(机体.精力) || 0).toFixed(2)),
                条行(机体.精力),
                行('体力', (Number(机体.体力) || 0).toFixed(2)),
                条行(机体.体力),
                行('状态', 机体.醒着 ? '醒着' : '睡着'),
                行('天气', 机体.天气 ? `${机体.天气.text} ${机体.天气.temp}℃ 湿度 ${机体.天气.humidity}%` : '未知'),
                h('div', { 'data-core-muted': '', key: 'm' }, 机体.更新秒前 != null ? 机体.更新秒前 + ' 秒前更新' : ''),
              ]
            : [h('div', { 'data-core-muted': '', key: 'm' }, '还没跑起来（重启 DSH 后第一跳会建）')]),

          卡('思维', 思维.ok
            ? [
                行('心情', (Number(思维.心情) || 0).toFixed(2)),
                条行(思维.心情),
                思维.好感 ? 行('好感', (Number(思维.好感.值) || 0).toFixed(2)) : 行('好感', '—'),
                思维.好感 ? 条行(思维.好感.值) : null,
                行('聊过', 思维.好感 ? 思维.好感.聊过 + ' 次' : '—'),
                h('div', { 'data-core-muted': '', key: 'm' }, '欲望：' + 欲排.map(([k, v]) => (欲望中文[k] || k) + ' ' + Number(v).toFixed(2)).join(' / ')),
              ].filter(Boolean)
            : [h('div', { 'data-core-muted': '', key: 'm' }, '还没跑起来')]),

          卡('行为', 行为.ok
            ? [
                行('今日 聊天/刷站', (行为.今日聊天 || 0) + ' / ' + (行为.今日刷站 || 0)),
                行('上次开口', 行为.上次开口 ? String(行为.上次开口).slice(11, 16) : '没有'),
                行('未回音', (行为.未回音 || 0) + ' 次'),
                h('div', { 'data-core-muted': '', key: 'm' }, '待消费反馈 ' + (d.待消费反馈 || 0) + ' 条'),
              ]
            : [h('div', { 'data-core-muted': '', key: 'm' }, '还没跑起来（目标会话可能一直是忙的）')]),
        ),

        h('div', { 'data-core-actions': '' },
          ['body', 'mind', 'behavior', 'memory'].map((id) =>
            h('button', {
              'data-core-btn': '',
              key: 'sw-' + id,
              'data-on': d.开关 && d.开关[id] !== false ? '' : undefined,
              'data-off': d.开关 && d.开关[id] === false ? '' : undefined,
              onClick: () => 切(id),
            }, ({ body: '机体', mind: '思维', behavior: '行为', memory: '记忆' })[id] + '：' + (d.开关 && d.开关[id] !== false ? '开' : '关'))),
          h('button', {
            'data-core-btn': '',
            'data-on': 行为.试运行 ? '' : undefined,
            'data-off': 行为.试运行 ? undefined : '',
            onClick: () => 提交({ 试运行: !行为.试运行 }),
          }, '试运行：' + (行为.试运行 ? '开' : '关')),
          h('button', {
            'data-core-btn': '',
            'data-on': 行为.总开关 ? '' : undefined,
            'data-off': 行为.总开关 ? undefined : '',
            onClick: () => 提交({ 总开关: !行为.总开关 }),
          }, '总开关：' + (行为.总开关 ? '开' : '关')),
          h('button', {
            'data-core-btn': '',
            onClick: () => 提交({ 主动聊天: { 冲动阈值: Math.max(0, Math.round((阈值 - 0.05) * 100) / 100) } }),
          }, '阈值 ' + 阈值 + ' −0.05'),
          h('button', {
            'data-core-btn': '',
            onClick: () => 提交({ 主动聊天: { 冲动阈值: Math.min(1, Math.round((阈值 + 0.05) * 100) / 100) } }),
          }, '阈值 ' + 阈值 + ' +0.05'),
          h('span', { 'data-core-msg': '' }, msg),
        ),

        h('div', { 'data-core-muted': '' },
          '每 5 秒自动刷新。行为配置改完最多 60 秒内被行为插件读到；三插件状态本在 %DSH_HOME% 下（body/ mind/ behavior-state.json）。'),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-core')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-core: 设置页样式')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'core', order: 45, label: '硅基模拟-统筹' },
          () => h(Panel),
        ))
      },
    }
  },
})

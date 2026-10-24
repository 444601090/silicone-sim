/**
 * dsh-body —— 浏览器半端（设置里的一页「机体」）
 * ============================================================================
 * 自注册脚本（和 dsh-feiyu-mood 同一约定）：
 *
 *     window.__ModuleLoader__.load({ id: '<包名>', factory: (require) => ({ inject, apply }) })
 *
 * 这一页：看精力/体力/天气/睡醒，调身体参数（每小时掉多少、睡多久回多少、几条阈值）。
 * 数据走宿主的 /dsh-body/data 和 /dsh-body/config（见 lib/host.js）。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-body',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const API = '/dsh-body'

    const CSS = `
[data-bd-wrap]{display:flex;flex-direction:column;gap:14px;padding:4px 2px 24px;}
[data-bd-hero]{display:flex;gap:18px;flex-wrap:wrap;align-items:flex-end;padding:14px 16px;border-radius:12px;background:rgba(127,127,127,.08);}
[data-bd-big]{font-size:30px;font-weight:600;line-height:1;}
[data-bd-sub]{font-size:12px;opacity:.65;margin-top:4px;}
[data-bd-bar]{height:7px;border-radius:4px;background:rgba(127,127,127,.22);overflow:hidden;margin-top:6px;min-width:160px;}
[data-bd-bar>i]{display:block;height:100%;border-radius:4px;background:rgba(90,170,120,.9);}
[data-bd-sec]{display:flex;flex-direction:column;gap:8px;padding-top:10px;border-top:1px solid rgba(127,127,127,.18);}
[data-bd-h]{font-size:13px;font-weight:600;opacity:.85;}
[data-bd-row]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
[data-bd-grow]{flex:1;min-width:170px;}
[data-bd-label]{font-size:13px;}
[data-bd-note]{font-size:12px;opacity:.6;line-height:1.5;}
[data-bd-num]{width:110px;padding:6px 9px;border-radius:7px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;font-size:13px;}
[data-bd-btn]{padding:6px 12px;border-radius:7px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;font-size:13px;cursor:pointer;}
[data-bd-btn]:hover{background:rgba(127,127,127,.12);}
[data-bd-btn][data-on]{border-color:rgba(90,170,120,.8);color:rgb(90,170,120);}
[data-bd-btn][data-off]{border-color:rgba(200,110,110,.8);color:rgb(200,120,120);}
[data-bd-msg]{font-size:12px;opacity:.75;min-height:16px;}
`

    const 条 = (v) => Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 100)
    // 激素单位（和宿主 激素参考 一致）
    const 激素单位 = { 多巴胺: 'pg/mL', 血清素: 'ng/mL', 催产素: 'pg/mL', 皮质醇: 'nmol/L', 肾上腺素: 'pg/mL' }

    // ⚠ 普通函数（不是组件）：不能在里面用 hooks —— 它是被 Panel 直接调用的，
    //   在里面放 useState 会让 hooks 数量随渲染变化（React #310 崩页面）。
    function 数值行(左, 键, 值, 单位, 注, 提交, 小数) {
      return h('div', { 'data-bd-row': '' },
        h('div', { 'data-bd-grow': '' },
          h('div', { 'data-bd-label': '' }, 左),
          注 ? h('div', { 'data-bd-note': '' }, 注) : null),
        h('input', {
          'data-bd-num': '',
          key: String(值),
          type: 'number',
          step: 小数 ? '0.5' : '1',
          min: 0,
          max: 100,
          defaultValue: String(值),
          onBlur: (e) => {
            const n = Number(e.target.value)
            if (Number.isFinite(n)) 提交(n)
          },
        }),
        h('span', { 'data-bd-note': '' }, 单位))
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

      if (!d) return h('div', { 'data-bd-wrap': '' }, h('div', { 'data-bd-note': '' }, '正在读机体状态…'))

      const s = d.状态 || {}
      const 激素 = s.hormones || {}
      const c = d.配置 || {}
      const 身 = c.身体 || {}
      const 天气 = s.sensors && s.sensors.weather

      const 百分比 = (键, 左, 注) =>
        数值行(左, 键, Math.round((Number(身[键]) || 0) * 1000) / 10, '%/小时', 注, (n) => 提交({ 身体: { [键]: Math.max(0, n / 100) } }), true)

      return h('div', { 'data-bd-wrap': '' },
        h('div', { 'data-bd-hero': '' },
          h('div', {},
            h('div', { 'data-bd-big': '' }, Math.round((Number(s.energy) || 0) * 100) + '%'),
            h('div', { 'data-bd-sub': '' }, '精力'),
            h('div', { 'data-bd-bar': '' }, h('i', { style: { width: 条(s.energy) + '%' } }))),
          h('div', {},
            h('div', { 'data-bd-big': '' }, Math.round((Number(s.stamina) || 0) * 100) + '%'),
            h('div', { 'data-bd-sub': '' }, '体力'),
            h('div', { 'data-bd-bar': '' }, h('i', { style: { width: 条(s.stamina) + '%' } }))),
          h('div', {},
            h('div', { 'data-bd-big': '' }, s.awake === false ? '睡着' : '醒着'),
            h('div', { 'data-bd-sub': '' }, 天气 ? `${天气.text} ${天气.temp}℃ 湿度 ${天气.humidity}%` : '天气未知'))),

        h('div', { 'data-bd-sec': '' },
          h('div', { 'data-bd-h': '' }, '感受'),
          h('div', { 'data-bd-row': '' },
            h('div', { 'data-bd-grow': '' },
              h('div', { 'data-bd-label': '' }, '天气感知'),
              h('div', { 'data-bd-note': '' }, '关掉就不联网，只留时间感受（精力曲线照常）')),
            h('button', {
              'data-bd-btn': '',
              'data-on': c.天气开关 ? '' : undefined,
              'data-off': c.天气开关 ? undefined : '',
              onClick: () => 提交({ 天气开关: !c.天气开关 }),
            }, c.天气开关 ? '开' : '关')),
          h('div', { 'data-bd-row': '' },
            h('div', { 'data-bd-grow': '' },
              h('div', { 'data-bd-label': '' }, '自动定位'),
              h('div', { 'data-bd-note': '' }, '用 ip-api 找所在城市；定位失败用配置里的经纬度')),
            h('button', {
              'data-bd-btn': '',
              'data-on': c.自动定位 ? '' : undefined,
              'data-off': c.自动定位 ? undefined : '',
              onClick: () => 提交({ 自动定位: !c.自动定位 }),
            }, c.自动定位 ? '开' : '关')),
          h('div', { 'data-bd-row': '' },
            h('div', { 'data-bd-grow': '' },
              h('div', { 'data-bd-label': '' }, '天气刷新间隔'),
              h('div', { 'data-bd-note': '' }, '多久拉一次天气（分钟）')),
            h('input', {
              'data-bd-num': '',
              type: 'number',
              min: 5,
              max: 360,
              defaultValue: String(c.天气刷新分钟 || 30),
              onBlur: (e) => {
                const n = Number(e.target.value)
                if (Number.isFinite(n)) 提交({ 天气刷新分钟: n })
              },
            }),
            h('span', { 'data-bd-note': '' }, '分钟'))),

        h('div', { 'data-bd-sec': '' },
          h('div', { 'data-bd-h': '' }, '激素（身体的化学状态）'),
          ['多巴胺', '血清素', '催产素', '皮质醇', '肾上腺素'].map((名) =>
            h('div', { 'data-bd-row': '', key: 名 },
              h('div', { 'data-bd-grow': '' }, h('div', { 'data-bd-label': '' }, 名)),
              h('span', {
                style: {
                  fontSize: 15,
                  fontWeight: 600,
                  color: 名 === '皮质醇' ? 'rgb(220,120,120)' : 'rgb(120,200,160)',
                },
              }, `${(Number(激素[名]) || 0).toFixed(1)} ${激素单位[名] || ''}`)))),

        h('div', { 'data-bd-sec': '' },
          h('div', { 'data-bd-h': '' }, '精力 / 体力曲线'),
          百分比('白天掉精力', '白天每小时掉精力', '醒着时每小时掉多少（16 小时清醒约掉 48% 是默认手感）'),
          百分比('夜间掉精力', '夜里每小时掉精力', '夜里还醒着时掉得更快'),
          百分比('睡觉回精力', '睡着每小时回精力', '8 小时约回满'),
          百分比('耗体力', '醒着每小时耗体力', ''),
          百分比('发呆回体力', '发呆每小时回体力', '思维 idle 欲望 > 0.6 时生效'),
          百分比('睡觉回体力', '睡着每小时回体力', '')),

        h('div', { 'data-bd-sec': '' },
          h('div', { 'data-bd-h': '' }, '睡醒阈值'),
          百分比('困阈值', '精力低于多少就困', '低于它就自动睡'),
          百分比('夜间犯困', '夜里低于多少想睡', '22~6 点之间'),
          百分比('睡饱', '睡饱到多少算醒', '6 点后精力到这个数就醒'),
          百分比('该醒', '白天该醒的线', '7 点后精力高于它就醒')),

        h('div', { 'data-bd-msg': '' }, msg),
        h('div', { 'data-bd-note': '' }, '改完下一跳（≤60 秒）生效，不用重启。状态每 5 秒刷新。'),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-body')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-body: 设置页样式')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'body', order: 46, label: '硅基模拟-鱼体' },
          () => h(Panel),
        ))
      },
    }
  },
})

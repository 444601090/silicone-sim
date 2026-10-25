/**
 * dsh-simlife —— 浏览器半端（设置里的一页「模拟人生」）
 * ============================================================================
 * 三合一：机体 / 思维 / 记忆 三个原版面板 + 作用域切换。
 * ⚠ 一个 client.js 只能有一个 __ModuleLoader__.load（多个会 web boot 失败、把 DSH 带崩）。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-simlife',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    // ================= 机体（原 dsh-body UI） =================

    const API_B = '/dsh-body'

    const CSS_B = `
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

    const 条_B = (v) => Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 100)
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

    function 面板_B() {
      const [d, setD] = React.useState(null)
      const [msg, setMsg] = React.useState('')

      const 拉 = async () => {
        try {
          const r = await fetch(API_B + '/data', { cache: 'no-store' })
          setD(await r.json())
        } catch (e) {}
      }
      React.useEffect(() => {
        let 活 = true
        const 跑 = async () => {
          try {
            const r = await fetch(API_B + '/data', { cache: 'no-store' })
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
          const r = await fetch(API_B + '/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(patch),
          })
          const j = await r.json()
          setMsg(j.ok ? '' : j.说 || '')
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
            h('div', { 'data-bd-big': '' }, (Number(s.活性) || 0) + '%'),
            h('div', { 'data-bd-sub': '' }, '活性'),
            h('div', { 'data-bd-bar': '' }, h('i', { style: { width: (Number(s.活性) || 0) + '%' } }))),
          h('div', {},
            h('div', { 'data-bd-big': '' }, Math.round((Number(s.stamina) || 0) * 100) + '%'),
            h('div', { 'data-bd-sub': '' }, '耐力'),
            h('div', { 'data-bd-bar': '' }, h('i', { style: { width: 条_B(s.stamina) + '%' } }))),
          h('div', {},
            h('div', { 'data-bd-big': '', style: { fontSize: 30, lineHeight: 1.05 } },
              天气 ? `${天气.temp}℃` : '—'),
            h('div', { 'data-bd-sub': '' }, 天气 ? `${天气.text} · 湿度 ${天气.humidity}%` : '天气未知'),
            )),

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
          h('div', { 'data-bd-h': '' }, '血糖与睡眠压力'),
          h('div', { 'data-bd-row': '' },
            h('div', { 'data-bd-grow': '' }, h('div', { 'data-bd-label': '' }, '血糖')),
            h('span', { style: { fontSize: 15, fontWeight: 600, color: 'rgb(120,200,160)' } },
              `${(Number(s.glucose) || 0).toFixed(2)} mmol/L`)),
          h('div', { 'data-bd-row': '' },
            h('div', { 'data-bd-grow': '' }, h('div', { 'data-bd-label': '' }, '腺苷')),
            h('span', { style: { fontSize: 15, fontWeight: 600, color: 'rgb(120,200,160)' } },
              `${(Number(s.adenosine) || 0).toFixed(0)} nmol/L`)),
          h('div', { 'data-bd-row': '' },
            h('div', { 'data-bd-grow': '' }, h('div', { 'data-bd-label': '' }, '褪黑素')),
            h('span', { style: { fontSize: 15, fontWeight: 600, color: 'rgb(120,200,160)' } },
              `${(Number(s.melatonin) || 0).toFixed(0)} pg/mL`))),

        h('div', { 'data-bd-sec': '' },
          h('div', { 'data-bd-h': '' }, '作息'),
          h('div', { 'data-bd-row': '' },
            h('span', { 'data-bd-note': '' }, '类型'),
            h('select', {
              key: 'sleep-type',
              defaultValue: (c.作息 && c.作息.类型) || '白昼',
              onChange: (e) => 提交({ 作息: { ...(c.作息 || {}), 类型: e.target.value } }),
            },
              h('option', { value: '白昼' }, '白昼（8:00–24:00 清醒）'),
              h('option', { value: '黑夜' }, '黑夜（16:00–次日 8:00 清醒）'),
              h('option', { value: '弹性' }, '弹性（起点后连续 12 小时清醒）'))),
          h('div', { 'data-bd-row': '' },
            h('span', { 'data-bd-note': '' }, '弹性起点'),
            h('input', {
              type: 'number',
              min: 0,
              max: 23,
              defaultValue: (c.作息 && c.作息.弹性起点) || 8,
              style: { maxWidth: 80 },
              onBlur: (e) => 提交({ 作息: { ...(c.作息 || {}), 弹性起点: Number(e.target.value) || 8 } }),
            }),
            h('span', { 'data-bd-note': '' }, '点')),
          h('div', { 'data-bd-note': '' }, '选好作息，掉多少精力、什么时候容易困都按它自动算，不用手调')),

        h('div', { 'data-bd-msg': '' }, msg),
      )
    }


    // ================= 思维（原 dsh-mind UI） =================

    const API_M = '/dsh-mind'

    const CSS_M = `
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
    const 条_M = (v) => Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 100)
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

    function 面板_M() {
      const [d, setD] = React.useState(null)
      const [msg, setMsg] = React.useState('')

      const 拉 = async () => {
        try {
          const r = await fetch(API_M + '/data', { cache: 'no-store' })
          setD(await r.json())
        } catch (e) {}
      }
      React.useEffect(() => {
        let 活 = true
        const 跑 = async () => {
          try {
            const r = await fetch(API_M + '/data', { cache: 'no-store' })
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
          const r = await fetch(API_M + '/config', {
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
            h('div', { 'data-md-bar': '' }, h('i', { style: { width: 条_M(s.mood) + '%' } }))),
          h('div', {},
            h('div', { 'data-md-big': '' }, Math.round(感情值 * 100) + '%'),
            h('div', { 'data-md-sub': '' }, `感情（聊过 ${好感 ? 好感.talks || 0 : 0} 次）`),
            h('div', { 'data-md-bar': '' }, h('i', { style: { width: 条_M(感情值) + '%' } }))),
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


    // ================= 记忆（原 dsh-memory UI） =================

    const API_Y = '/dsh-memory'

    const CSS_Y = `
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

    // 鲜活度用文字说，不用进度条图形
    const 鲜活档 = (v) => {
      const n = Number(v) || 0
      if (n >= 0.9) return '很鲜活'
      if (n >= 0.6) return '还鲜活'
      if (n >= 0.3) return '有点淡'
      if (n > 0.05) return '快淡了'
      return '快没了'
    }

    function 面板_Y() {
      const [d, setD] = React.useState(null)
      const [查询, set查询] = React.useState('')
      const [结果, set结果] = React.useState(null)
      const [新记忆, set新记忆] = React.useState('')
      const [msg, setMsg] = React.useState('')

      const 拉 = async () => {
        try {
          const r = await fetch(API_Y + '/data', { cache: 'no-store' })
          setD(await r.json())
        } catch (e) {}
      }
      React.useEffect(() => {
        拉()
      }, [])

      const 搜索 = async () => {
        try {
          const r = await fetch(API_Y + '/query', {
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
          const r = await fetch(API_Y + '/add', {
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

      const 隐藏 = Boolean(d.状态 && d.状态.隐藏)
      if (隐藏) {
        return h('div', { 'data-mm-wrap': '' },
          h('div', { 'data-mm-hero': '' },
            h('div', {}, h('div', { 'data-mm-big': '' }, String(d.状态.条数 || 0)), h('div', { 'data-mm-sub': '' }, '条记忆（私密）'))),
          h('div', { 'data-mm-sec': '' },
            h('div', { 'data-mm-h': '' }, '需要允许才能看'),
            h('div', { 'data-mm-sub': '' }, '记忆默认不公开。想看得先跟我说一声——我允许了，这里才会显示。')))
      }

      const 状态 = d.状态 || {}
      const 条目们 = Array.isArray(状态.entries) ? 状态.entries : []
      const 鲜活 = 条目们.filter((e) => (e.strength || 0) > 0.3).length
      const 展示 = 结果 === null ? 条目们.slice(-20).reverse() : 结果

      const 条目 = (e, i) =>
        h('div', { 'data-mm-item': '', key: e.id || i },
          h('div', { 'data-mm-text': '' }, e.text),
          h('div', { 'data-mm-meta': '' },
            h('span', { 'data-mm-kind': '' }, 类型名[e.kind] || e.kind),
            h('span', '', 鲜活档(e.strength)),
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



    // ================= 作用域（下拉） =================
    function 作用域面板() {
      const [d, setD] = React.useState(null)
      const [msg, setMsg] = React.useState('')
      const 拉 = React.useCallback(async () => {
        try {
          setD(await (await fetch('/dsh-simlife/data')).json())
        } catch (e) {}
      }, [])
      React.useEffect(() => {
        拉()
        const t = setInterval(拉, 20000)
        return () => clearInterval(t)
      }, [拉])
      const 切 = async (名) => {
        try {
          const r = await fetch('/dsh-simlife/切换', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ 作用域: 名 }),
          })
          const j = await r.json()
          setMsg(j.ok ? '已切到「' + 名 + '」，重启 DSH 后生效' : j.说 || '失败')
          拉()
        } catch (e) {
          setMsg('切换失败')
        }
      }
      if (!d) return h('div', { 'data-sl-note': '' }, '正在读作用域…')
      return h('div', { 'data-sl-card': '' },
        h('div', { 'data-sl-sec': '' }, '当前作用域：' + (d.作用域 || '全局')),
        h('div', { 'data-sl-row': '' },
          h('select', {
            'data-sl-select': '',
            value: d.作用域 || '全局',
            onChange: (e) => 切(e.target.value),
          },
            ...(d.作用域们 || []).map((名) => h('option', { key: 名, value: 名 }, 名)),
          ),
        ),
        msg ? h('div', { 'data-sl-note': '' }, msg) : null,
        h('div', { 'data-sl-note': '' }, '切换后重启 DSH 生效；下拉里的都是已注册的工作区'),
      )
    }

    // ================= 主面板：四个分页 =================
    function 主面板() {
      const [标签, set标签] = React.useState('机体')
      const 页们 = [
        ['机体', 面板_B],
        ['思维', 面板_M],
        ['记忆', 面板_Y],
        ['作用域', 作用域面板],
      ]
      const 当前 = (页们.find(([名]) => 名 === 标签) || 页们[0])[1]
      return h('div', { 'data-sl-wrap': '' },
        h('div', { 'data-sl-tabs': '' },
          ...页们.map(([名]) =>
            h('button', { key: 名, 'data-sl-btn': '', 'data-on': 标签 === 名 ? '' : undefined, onClick: () => set标签(名) }, 名)),
        ),
        h(当前),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // 三个原版 UI 的样式都挂上（各自的前缀不冲突）
        const 样式 = [CSS_B, CSS_M, CSS_Y].filter(Boolean).join('\n')
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-simlife')
        style.textContent = 样式
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-simlife: 设置页样式')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'simlife', order: 45, label: '模拟人生' },
          () => h(主面板),
        ))
      },
    }
  },
})

// 操作说明的截图(无头 Chrome / CDP):向导 5 步 + 数据源面板 + 外部 kz + 独立大屏 + 接线图绑定。
// 2026-09-09 重拍:绑定面板 09-08(KeyPicker 层级)、09-09(ext 点选表单、声明输出置顶)都改过。
// 2026-09-23 重拍:第 3、4 步选设备 / 测点改成右侧「数据源」面板(KeyPicker 已删),新增 03b / 10 两张;
// 后端换成 CT110(站点 xrs-mirror-test 在上面);大屏登录改为显式填账号(预填的在 CT110 上不对)。
// 凭据从 dev/.env.local 读,只进浏览器,不打印;拍完两边都注销。只读:不点保存、不发布。
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

for (const line of readFileSync('D:/Coding/Demo - Copy/dev/.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const { TB_USER, TB_PASSWORD } = process.env
const OUT = 'D:/Coding/Demo - Copy/dev/docs/img/操作说明'
mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:5173'
const PORT = 9350

const chrome = spawn(
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--window-size=1760,1000',
    '--hide-scrollbars',
    '--no-first-run',
    '--disable-gpu',
    `--user-data-dir=${resolve(process.env.TEMP || '.', 'gridops-shoot-2')}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
)

const sleep = ms => new Promise(r => setTimeout(r, ms))
let ws,
  seq = 0
const pending = new Map()
async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find(t => t.type === 'page')
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl)
        await new Promise((res, rej) => {
          ws.onopen = res
          ws.onerror = rej
        })
        ws.onmessage = e => {
          const m = JSON.parse(e.data)
          if (m.id && pending.has(m.id)) {
            const { res, rej } = pending.get(m.id)
            pending.delete(m.id)
            if (m.error) rej(new Error(m.error.message))
            else res(m.result)
          }
        }
        return
      }
    } catch {
      /* not ready */
    }
    await sleep(250)
  }
  throw new Error('chrome devtools 连不上')
}
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq
    pending.set(id, { res, rej })
    ws.send(JSON.stringify({ id, method, params }))
  })
const evalJs = async (expression, gesture = true) => {
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: gesture,
  })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval 失败')
  return r.result?.value
}
const shot = async name => {
  const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82 })
  writeFileSync(resolve(OUT, name), Buffer.from(r.data, 'base64'))
  console.log('  ✓', name)
}
const waitFor = async (expr, timeout = 20000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (await evalJs(expr)) return true
    await sleep(300)
  }
  throw new Error('等超时: ' + expr.slice(0, 70))
}
const clickText = (tag, text) =>
  evalJs(`(() => { const el = [...document.querySelectorAll('${tag}')].find(b => b.textContent.replace(/\\s+/g, '').includes(${JSON.stringify(text)}));
      if (!el) throw new Error('找不到 ${tag} ' + ${JSON.stringify(text)}); el.click(); return true })()`)
const setInput = (selectorExpr, value) =>
  evalJs(`(() => { const el = ${selectorExpr}; if (!el) throw new Error('没有这个输入框');
      el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
/** 数据源面板(2026-09-23):搜设备名,点那台设备(搜索时点左边设备 = 只看它的测点) */
const drawerDevice = async name => {
  await waitFor(`!!document.querySelector('[data-role="source-drawer"]')`)
  await setInput(`document.querySelector('[data-role="source-search"]')`, name)
  await sleep(800)
  await evalJs(`(() => { const b = [...document.querySelectorAll('[data-role="source-device"]')].find(e => e.textContent.includes(${JSON.stringify(name)}));
      if (!b) throw new Error('面板里没有设备 ' + ${JSON.stringify(name)}); b.click(); return true })()`)
  await sleep(2500)
}
/** 面板里点 key 为 k 的那一行(没有就点第一行) */
const drawerPoint = async k =>
  evalJs(`(() => { const rows = [...document.querySelectorAll('[data-role="source-point"]')];
      const r = rows.find(e => e.dataset.value.endsWith('||' + ${JSON.stringify(k)})) || rows[0];
      if (!r) throw new Error('面板里没有测点'); r.click(); return r.dataset.value })()`)

/** 10:接线图编辑器的「绑定」页签(独立开发入口,mock 设备,不连平台);`ONLY=sld` 时只拍这一张 */
async function shootSld() {
  // ── 10:接线图编辑器的「绑定」页签(独立开发入口,mock 设备,不连平台)──
  await send('Page.navigate', { url: `${BASE}/sld-editor.html` })
  await waitFor(`!!document.querySelector('.x6-graph-svg g[data-shape="sld-node"]')`)
  await sleep(1500)
  // 「绑定」页签按页签文字精确找(别的按钮里也有「绑定」两个字)
  await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === '绑定');
      if (!b) throw new Error('没有绑定页签'); b.click(); return true })()`)
  await sleep(600)
  // 选中中间那一路的开关(n4):走编辑器自己的选择接口(dev 构建能从组件上拿到 ctx)——
  // 无头 Chrome 在前面几页之后合成的鼠标点击点不中画布,这里不依赖它
  await evalJs(`(() => {
      const seen = new Set()
      const find = i => {
        if (!i || seen.has(i)) return null
        seen.add(i)
        if (i.setupState?.ctx?.select) return i.setupState.ctx
        const kids = []
        const walk = v => { if (!v) return; if (v.component) kids.push(v.component); if (Array.isArray(v.children)) v.children.forEach(walk); if (v.dynamicChildren) v.dynamicChildren.forEach(walk) }
        walk(i.subTree)
        for (const k of kids) { const r = find(k); if (r) return r }
        return null
      }
      const ctx = find(document.querySelector('#app').__vue_app__._instance)
      if (!ctx) throw new Error('找不到接线图编辑器')
      ctx.select({ nodes: ['n4'] })
      return true })()`)
  await waitFor(`!!document.querySelector('[data-sec="state"]')`, 5000)
  await sleep(600)
  await evalJs(
    `(() => { const b = document.querySelector('[data-sec="state"] [data-role="qp-toggle"]'); if (!b) throw new Error('没有换测点'); b.click(); return true })()`
  )
  await sleep(1200)
  await shot('10-接线图绑定.jpg')
}

try {
  await connect()
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1760, height: 1000, deviceScaleFactor: 1, mobile: false })
  // ONLY=sld:只拍接线图那一张(不连平台,不用登录);跳出 main 块,照样走 finally 关掉 Chrome
  main: {
    if (process.env.ONLY === 'sld') {
      await shootSld()
      break main
    }

    // ── 向导 ──
    await send('Page.navigate', { url: `${BASE}/provisioner.html` })
    await waitFor(`document.body.innerText.includes('连接并发现设备')`)
    await sleep(900)
    await shot('01-连接.jpg')

    await setInput(`document.querySelectorAll('input[type=text]')[0]`, TB_USER)
    await setInput(`document.querySelector('input[type=password]')`, TB_PASSWORD)
    await setInput(`document.querySelectorAll('input[type=text]')[1]`, 'xrs-mirror-test')
    await clickText('button', '连接并发现设备')
    await waitFor(`document.body.innerText.includes('已发现')`, 40000)
    // 231 台设备的测点探测要跑一会,等按钮文案不再变
    let last = ''
    for (let i = 0; i < 60; i++) {
      await sleep(5000)
      const t = await evalJs(
        `(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('探测测点')); return b ? b.textContent.trim() : 'done' })()`
      )
      if (t === 'done' || t === last) break
      last = t
    }
    await sleep(1500)
    // 截图前清掉密码框(已经连上,不再用它):圆点个数也不该进文档
    await setInput(`document.querySelector('input[type=password]')`, '')
    await sleep(300)
    await shot('01b-已连接.jpg')

    await clickText('button', '设备与测点')
    await sleep(1500)
    await shot('02-设备与测点.jpg')

    await clickText('button', '运算配置')
    await sleep(1200)
    // 两个「方式」默认折叠,展开了才看得到模板清单,截图才有内容
    await evalJs(`[...document.querySelectorAll('.way-head.clickable')].forEach(h => h.click()); true`)
    await sleep(1200)
    await shot('03-运算配置.jpg')

    // ── 03b:数据源面板(自定义四则运算的第 2 项,停在第 1 项的设备上)──
    await clickText('.tpl-row', '自定义四则运算')
    await sleep(1200)
    await evalJs(`document.querySelectorAll('[data-role="source-field"]')[0].click(); true`)
    await sleep(900)
    await drawerDevice('SSP1_GP1_IED1')
    console.log('  第 1 项:', await drawerPoint('P'))
    await sleep(1200)
    await evalJs(`document.querySelectorAll('[data-role="source-field"]')[1].click(); true`)
    await sleep(1500)
    await shot('03b-数据源面板.jpg')
    await evalJs(`document.querySelector('[data-role="source-close"]').click(); true`)
    await sleep(800)
    await clickText('.modal button', '取消')
    await sleep(800)

    await clickText('button', '组态编辑')
    await sleep(5000)
    await shot('04-组态缩略图.jpg')

    await clickText('button', '全屏编辑')
    await sleep(3500)
    await shot('05-全屏编辑.jpg')

    // ── 05b:第 4 步绑定的数据源面板(往空的「左 1」放一张数字卡再绑;只改内存里的草稿,不保存)──
    const putWidget = async (slot, name) => {
      await evalJs(`(() => { const s = document.querySelector('.sb .sr-slot[data-slot=${JSON.stringify(slot)}]');
        if (!s) throw new Error('没有槽位 ' + ${JSON.stringify(slot)}); s.click(); return true })()`)
      await sleep(1500)
      // 按组件名精确匹配(别的组件的说明里也可能带「曲线」)
      await evalJs(`(() => { const it = [...document.querySelectorAll('.wp-item')].find(e => e.querySelector('.wp-name')?.textContent.trim() === ${JSON.stringify(name)});
        if (!it) throw new Error('组件选择框里没有 ' + ${JSON.stringify(name)} + ':' + [...document.querySelectorAll('.wp-name')].map(e => e.textContent.trim()).join('/')); it.click(); return true })()`)
      await sleep(1200)
      // 曲线这类可以绑多条的槽位一开始没有绑定行,先点「+ 添加一条」
      await evalJs(
        `(() => { if (!document.querySelector('select[data-role="mode"]')) document.querySelector('.bp-add')?.click(); return true })()`
      )
      await waitFor(`!!document.querySelector('select[data-role="mode"]')`, 10000)
      await sleep(800)
    }
    const setMode = mode =>
      evalJs(`(() => { const s = document.querySelector('select[data-role="mode"]');
        if (!s) throw new Error('没有 mode 下拉'); s.value = ${JSON.stringify(mode)}; s.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
    const openField = () =>
      evalJs(
        `(() => { const b = document.querySelector('[data-role="entity"]'); if (!b) throw new Error('没有数据源格子'); b.click(); return true })()`
      )
    await putWidget('l1', '数字卡')
    await setMode('ts')
    await sleep(1000)
    await openField()
    await sleep(1200)
    await drawerDevice('SSP1_GP1_IED1')
    await drawerPoint('P')
    await sleep(1500)
    // 绑好了再打开一次:面板停在这台设备上、当前测点高亮
    await openField()
    await sleep(2500)
    console.log(
      '  面板前几行:',
      (
        await evalJs(
          `[...document.querySelectorAll('[data-role="source-point"]')].slice(0, 5).map(r => r.innerText.replace(/\\s+/g, ' '))`
        )
      ).join(' | ')
    )
    await shot('05b-绑定测点.jpg')
    await evalJs(`document.querySelector('[data-role="source-close"]').click(); true`)
    await sleep(800)

    // ── 05c:外部(kz)归档历史(往「中下 1」放一条曲线)──
    await putWidget('c1', '曲线')
    await setMode('ext')
    await sleep(1200)
    await openField()
    await sleep(1200)
    await drawerDevice('SSP1_GP1_IED1')
    await drawerPoint('P')
    await sleep(2000)
    console.log(
      '  ext 行:',
      await evalJs(
        `document.querySelector('.br[data-mode="ext"]')?.innerText.replace(/\\s+/g, ' ').slice(0, 150) ?? '(没有 ext 行)'`
      )
    )
    await shot('05c-外部kz.jpg')

    // ── 发布上线 ──
    await evalJs(
      `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true`
    )
    await sleep(1000)
    await clickText('button', '发布上线')
    await sleep(1500)
    await shot('06-发布上线.jpg')

    // 向导这边的会话用完注销(只在内存里,dev 构建可以从组件上拿到 api)
    await evalJs(
      `(async () => { try { await document.querySelector('#app').__vue_app__._instance.setupState.api('/api/auth/logout', {}) } catch {} return true })()`
    )

    // ── 独立大屏 ──
    await send('Page.navigate', { url: `${BASE}/site.html?site=xrs-mirror-test` })
    await waitFor(`document.body.innerText.includes('登录')`)
    await sleep(900)
    await shot('07-大屏登录.jpg')
    await setInput(`document.querySelector('[data-role="user"]')`, TB_USER)
    await setInput(`document.querySelector('[data-role="pass"]')`, TB_PASSWORD)
    await clickText('button', '登录')
    // 登录后是页面列表;站点只有一张页面(且没有卡片库)时直接进页面
    await waitFor(`!!document.querySelector('.sa-pages, .sa-page-title')`, 25000)
    await sleep(1500)
    if (await evalJs(`!!document.querySelector('.sa-pages')`)) {
      await shot('08-大屏页面列表.jpg')
      await evalJs(
        `(() => { const b = document.querySelector('.sa-page'); if (!b) throw new Error('页面列表是空的'); b.click(); return true })()`
      )
    } else console.log('  (只有一张页面,没有列表可拍,08 保留旧图)')
    await sleep(8000)
    await shot('09-大屏页面.jpg')
    // 大屏会话注销:点右上角「退出」
    await evalJs(
      `(() => { const b = [...document.querySelectorAll('button, a')].find(e => e.textContent.trim() === '退出'); if (b) b.click(); return true })()`
    )
    // 退出后大屏自己会跳回登录页;等它跳完再走,不然会和下面的跳转撞在一起(接线图页被中途刷新)
    await waitFor(
      `document.body.innerText.includes('登录') && !document.querySelector('.sa-pages, .sa-page-title')`,
      10000
    )
    await sleep(1500)

    await shootSld()
    console.log('全部完成')
  }
} catch (e) {
  console.error('失败:', e.message)
  process.exitCode = 1
} finally {
  // 中途失败时向导会话还在:能取到就注销(只在向导页上有效)
  try {
    await evalJs(
      `(async () => { try { await document.querySelector('#app').__vue_app__._instance.setupState.api('/api/auth/logout', {}) } catch {} return true })()`
    )
  } catch {
    /* 不在向导页 */
  }
  try {
    ws?.close()
  } catch {
    /* ignore */
  }
  chrome.kill()
}

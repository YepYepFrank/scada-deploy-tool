// 操作说明的截图(无头 Chrome / CDP):向导 5 步 + 绑定选择器 + 外部 kz + 独立大屏。
// 2026-09-09 重拍:绑定面板 09-08(KeyPicker 层级)、09-09(ext 点选表单、声明输出置顶)都改过,
// 原来的 10 张图与正文已经对不上;另新增 05b / 05c 两张,正文里那两段本来就没有配图。
// 凭据从 dev/.env.local 读,只进浏览器,不打印。
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
/** 选中示意图上的槽位:会顺带弹出组件选择框,关掉它,槽位仍选中(@close 只关框不清选中) */
const selectSlot = async slot => {
  await evalJs(`(() => { const s = document.querySelector('.sb .sr-slot[data-slot=${JSON.stringify(slot)}]');
      if (!s) throw new Error('没有槽位 ' + ${JSON.stringify(slot)}); s.click(); return true })()`)
  await sleep(1500)
  await evalJs(`(() => { const b = document.querySelector('.wp-close'); if (b) b.click(); return true })()`)
  await sleep(1200)
}
/** 在当前绑定行里把实体换成指定名字 */
const pickEntity = async name => {
  await evalJs(
    `(() => { const b = document.querySelector('[data-role="entity"]'); if (!b) throw new Error('没有实体按钮'); b.click(); return true })()`
  )
  await sleep(800)
  await evalJs(`(() => { const q = document.querySelector('.br-tree input'); q.value = ${JSON.stringify(name)};
      q.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await sleep(1200)
  await evalJs(`(() => { const r = [...document.querySelectorAll('.br-tree [data-id]')].find(e => e.textContent.includes(${JSON.stringify(name)}));
      if (!r) throw new Error('树里没有 ' + ${JSON.stringify(name)}); r.click(); return true })()`)
  await sleep(3500)
}

try {
  await connect()
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1760, height: 1000, deviceScaleFactor: 1, mobile: false })

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

  await clickText('button', '组态编辑')
  await sleep(5000)
  await shot('04-组态缩略图.jpg')

  await clickText('button', '全屏编辑')
  await sleep(3500)
  await shot('05-全屏编辑.jpg')

  // ── 新增:绑定选择器(声明输出置顶 + 待发布)──
  await selectSlot('s1')
  await pickEntity('SSP1_GP1_IED1')
  // 先把测点选上,别让手册里出现「绑定未填完整」的报错态;选完再把下拉重新打开来截图
  await evalJs(
    `(() => { const b = document.querySelector('.kp-btn'); if (!b) throw new Error('没有测点下拉'); b.click(); return true })()`
  )
  await sleep(1500)
  await evalJs(`(() => { const it = [...document.querySelectorAll('.kp-item')].find(i => i.textContent.includes('calc_pqSum'));
      if (!it) throw new Error('置顶组里没有 calc_pqSum'); it.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return true })()`)
  await sleep(1500)
  await evalJs(`(() => { document.querySelector('.kp-btn').click(); return true })()`)
  await sleep(1500)
  console.log(
    '  绑定选择器分组:',
    (await evalJs(`[...document.querySelectorAll('.kp-group')].map(g => g.textContent.trim())`)).join(' | ')
  )
  console.log(
    '  顶栏:',
    await evalJs(`(() => { const t = document.body.innerText.split(String.fromCharCode(10)).map(s => s.trim());
      return t.filter(x => x.includes('校验通过') || x.includes('不可发布') || x.includes('个提示')).slice(0, 1)[0] ?? '' })()`)
  )
  await shot('05b-绑定测点.jpg')
  await evalJs(`document.body.click(); true`) // 收起下拉
  await sleep(600)

  // ── 新增:外部(kz)归档历史 ──
  await selectSlot('g1')
  await evalJs(`(() => { const s = document.querySelector('select[data-role="mode"]');
      if (!s) throw new Error('没有 mode 下拉'); s.value = 'ext'; s.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  await sleep(1200)
  await pickEntity('SSP1_GP1_IED1')
  await evalJs(`(() => { const b = document.querySelector('.kp-btn'); if (b) b.click(); return true })()`)
  await sleep(1200)
  await evalJs(
    `(() => { const g = [...document.querySelectorAll('.kp-group')].find(x => x.textContent.includes('遥测')); if (g) g.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return true })()`
  )
  await sleep(600)
  await evalJs(`(() => { const it = [...document.querySelectorAll('.kp-item')].find(i => i.textContent.trim().startsWith('P '));
      if (it) it.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return true })()`)
  await sleep(1500)
  console.log(
    '  顶栏:',
    await evalJs(`(() => { const t = document.body.innerText.split(String.fromCharCode(10)).map(s => s.trim());
      return t.filter(x => x.includes('校验通过') || x.includes('不可发布') || x.includes('个提示')).slice(0, 1)[0] ?? '' })()`)
  )
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

  // ── 独立大屏 ──
  await send('Page.navigate', { url: `${BASE}/site.html?site=xrs-mirror-test` })
  await waitFor(`document.body.innerText.includes('登录')`)
  await sleep(900)
  await shot('07-大屏登录.jpg')
  await clickText('button', '登录')
  await waitFor(`document.body.innerText.includes('运营总览')`, 25000)
  await sleep(1000)
  await shot('08-大屏页面列表.jpg')
  await evalJs(`(() => { const el = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === '仙人山服务区 · 运营总览');
      if (!el) throw new Error('页面列表里没有运营总览'); el.click(); return true })()`)
  await sleep(8000)
  await shot('09-大屏页面.jpg')
  console.log('全部完成')
} catch (e) {
  console.error('失败:', e.message)
  process.exitCode = 1
} finally {
  try {
    ws?.close()
  } catch {
    /* ignore */
  }
  chrome.kill()
}

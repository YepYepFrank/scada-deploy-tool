# 方案讨论 · 绑定上下文 BindingContext(单卡 / 整页动态换设备)· 2026-09-21

> 给谁看:YY(定)、庄艳芹(确认接口)、高潮(知会)。
> 状态:**已确认并实现**(2026-09-21)。庄当天回了《PageConfig 动态上下文与设备类型方案答复》,五条结论全部采纳,渲染器 0.9.0 + 部署工具已落地;
> **接入以 `给同事的-渲染器0.9.0交付-2026-09-21.md` 为准**,本文保留为方案与决策记录。与下文草案的出入(以实现为准):
> ① prop 名是 `bindingContext`(不是 `context`);② 上下文键只收四个标准键 + `custom.<名字>`,`selectedAlarm` 预留;
> ③ `selectedMeasurePoint`(动态测点)提前到这一期;④ `whenMissing` 四态 `empty / hide / error / fallback`,`fallback` 只有显式选了才在运行时生效;
> ⑤ 绝对时间区间 `{ from, to }` 并进这一期(`DataSource.getHistory` 放宽,宿主 tbClient 要跟着改);⑥ 整卡点击事件 `click` 对所有组件生效;
> ⑦ 不按设备类型拆卡片组;⑧ 地图按 YY 意见暂不做。
> 涉及版本:渲染器 0.8.0 → **0.9.0**(契约 `schemaVersion` 仍为 1,全部是可选新增);`@grid/tb-client` 的 `DataSource` 接口**不变**。

---

## 0. 一句话

现在绑定里的 `entity` 只能写死一个 UUID,所以设备测试页只能靠 `buildDeviceTestWidgets` 这类专用函数,拿设备树选中的 `node.id` 去改数字卡、曲线的配置;换成表格或仪表盘就得改代码。

要做的是:**绑定里允许写「这个实体来自页面上下文的某个键」,宿主只管给上下文(当前选中的设备、时间范围),渲染器负责解析、订阅、换设备时重订。** 配置里换什么组件都不用再动宿主代码。

范围只有三件事:

1. 契约:`entity` 和 `window` 多一种「取自上下文」的写法(§2);
2. 渲染器:`<ScadaPage>` / `<ScadaWidget>` 收 `context`,按组件粒度重订(§3);
3. 部署工具:绑定面板能配「跟随页面上下文」,预览能模拟换设备(§5)。

另外顺带两件小事:更多组件抛 `widget-event`(§4,联动靠它),以及订阅合并的参考实现说明(§6,在 tbClient 侧)。

---

## 1. 先对齐:建议文档里的 JSON 示例与现行契约有三处出入

照建议文档第四节的示例写,`validatePageConfig` 会校验不过。现行契约(`@grid/scada-renderer/schema`,0.8.0)是:

| 建议文档里写的 | 契约 v1 实际 | 说明 |
|---|---|---|
| `"binding": { … }` | `"bindings": { "<槽位名>": { … } }` | 一个组件可以有多个绑定槽位(数字卡是 `value`,曲线是 `series`,表格是 `rows`);槽位名看各组件的 `bindingSlots` |
| 曲线 `"binding": { "keys": ["P"] }` | `"bindings": { "series": [ { … } ] }` | 声明了 `multiple` 的槽位**必须是数组**,一条绑定一条序列,单条也写成一项的数组 |
| `"range": "24h"`、`"aggregate": "AVG"` | `"window": "24h"`、`"agg": "AVG"` | 字段名不同 |

按现行契约,示例里的两张卡应写成:

```json
{
  "id": "w_power_01", "type": "number-card", "slot": "s1",
  "props": { "title": "实时功率", "unit": "kW", "decimals": 1 },
  "bindings": {
    "value": { "mode": "ts", "entity": { "type": "DEVICE", "id": "设备UUID" }, "key": "P" }
  }
},
{
  "id": "w_power_trend_01", "type": "line", "slot": "g1",
  "props": { "title": "功率趋势", "unit": "kW" },
  "bindings": {
    "series": [
      { "mode": "ts-history", "entity": { "type": "DEVICE", "id": "设备UUID" }, "keys": ["P"], "window": "24h", "agg": "AVG" }
    ]
  }
}
```

建议文档第二、三节对链路的描述(工具发布到 ScadaPage 资产的 `SERVER_SCOPE.pageConfig`;单卡按 `pageId + widgetId` 用 `pickWidget` 取;卡片库是 `additionalInfo.kind = cards` 的 ScadaPage)与现状一致,不用改。

---

## 2. 契约改动(page-config,全部可选新增)

### 2.1 实体:多一种「取自上下文」的写法

```ts
/** 现有:固定实体(不变) */
interface EntityRef { type: 'DEVICE' | 'ASSET'; id: string; name?: string }

/** 新增:取自页面上下文 */
interface ContextEntityRef {
  source: 'context'
  /** 上下文键,如 'selectedDevice' / 'selectedSite';^[a-z][A-Za-z0-9]*$ */
  key: string
  /** 期望的实体类型;填了就校验,上下文给的类型不符 → 该卡显示「配置错误」而不是去订阅 */
  type?: 'DEVICE' | 'ASSET'
  /** 样例 / 兜底实体:编辑器靠它挑测点、出预览;运行时是否用它见 whenMissing */
  fallback?: EntityRef
  /** 运行时上下文里没有这个键时:'empty'(缺省)= 显示「未选择设备」;'fallback' = 用 fallback 去订阅 */
  whenMissing?: 'empty' | 'fallback'
}

type EntitySource = EntityRef | ContextEntityRef   // ts / ts-history / attr / alarm 四种绑定的 entity 都改成它
```

配置示例(数字卡跟随选中的设备):

```json
"bindings": {
  "value": {
    "mode": "ts",
    "entity": { "source": "context", "key": "selectedDevice", "type": "DEVICE",
                "fallback": { "type": "DEVICE", "id": "样例设备UUID", "name": "1# PCS" } },
    "key": "P"
  }
}
```

要点:

- **只有显式写了 `source: "context"` 的绑定才会被替换**。固定绑定(站点汇总资产、并网点表)永远不动——这就是建议文档第五节说的「明确标记哪些实体可动态替换」。
- 同一张卡可以混用:例如概览卡 4 项里,2 项跟随设备、2 项固定在站点资产上。
- **`DataSource` 接口不变**。渲染器先把上下文解析成具体的 `{ type, id }`,再调 `subscribeTs / getHistory …`。庄的 tbClient 一行不用改。
- 上下文换的是**实体**,测点 key 不变。所以适合「同类型设备之间切换」(10 台 PCS 选一台)。不同类型设备测点不同:一期的做法是每种类型各配一组卡,宿主按设备类型决定显示哪组;「动态测点」放二期(§7)。

### 2.2 时间窗口:同样允许取自上下文

```ts
/** ts-history / ext 的 window */
window: string | { source: 'context'; key: string; fallback?: string }   // 上下文里的值是窗口字面量:'15m' / '24h' / '7d'
```

宿主改 `context.timeRange = '7d'`,所有引用它的曲线一起重拉。

**一个限制**:`DataSource.getHistory` 现在只收「最近 N」这种窗口字面量,没有「起止时间」。历史趋势页如果要选「09-01 到 09-07」这样的绝对区间,需要给 `getHistory` 加一个可选的 `{ from, to }` 形式——那要动 `DataSource`,庄的 tbClient 得跟着实现。要不要做见 §8 问题 4。

### 2.3 上下文本身的形状

```ts
type BindingContext = Record<string, EntityRef | string | null | undefined>
// 例:{ selectedDevice: { type: 'DEVICE', id: '…', name: '2# PCS' }, selectedSite: { type: 'ASSET', id: '…' }, timeRange: '24h' }
```

键名不设白名单,但约定几个通用名,工具的下拉里默认给这几个:`selectedSite`、`selectedDevice`、`timeRange`。「业务角色实体」(并网点表、主变)**不进渲染器**:由宿主(或工具发布时)解析成实体后,用自己起的键放进上下文,例如 `rolePcc`。渲染器保持不查 TB、不懂业务模型。

### 2.4 兼容性

- 旧配置零改动通过(新增的都是可选形状)。
- **0.8.0 及更早的渲染器不认识 `source: "context"`,遇到会判该页配置无效。** 所以顺序必须是:宿主先升 0.9.0 → 工程人员才在工具里配上下文绑定。工具侧在发布含上下文绑定的页面时给一句提示。
- 发布时「按名称解析成 id」(ADR-002)的规则对 `fallback` 同样生效;`source: "context"` 本身没有名称要解析,跳过。

---

## 3. 渲染器改动(0.9.0)

### 3.1 对外接口

```vue
<!-- 整页 -->
<ScadaPage :config="page" :context="ctx" />
<!-- 单卡 -->
<ScadaWidget :config="card" :context="ctx" />
```

```ts
// 或者在宿主根部注入一次,下面所有 ScadaPage / ScadaWidget 共用;props 传了以 props 为准
import { provideBindingContext } from '@grid/scada-renderer'
const ctx = reactive<BindingContext>({ selectedDevice: null, timeRange: '24h' })
provideBindingContext(ctx)
```

设备测试页改造后大致是这样,`buildDeviceTestWidgets` 可以删掉:

```vue
<script setup>
const ctx = reactive({ selectedDevice: null })
function onTreeSelect(node) {
  ctx.selectedDevice = { type: 'DEVICE', id: node.id, name: node.name }
}
// cards:从卡片库页 pickWidget 出来的几张卡,绑定里写的是 source: 'context'
</script>
<template>
  <DeviceTree @select="onTreeSelect" />
  <div v-for="c in cards" :key="c.id" class="cell"><ScadaWidget :config="c" :context="ctx" /></div>
</template>
```

想把曲线换成表格:工程人员在工具里改卡片库、重新发布,宿主代码不动。

### 3.2 行为

| 情形 | 行为 |
|---|---|
| 上下文某个键变了 | **只重订引用了这个键的组件**,其他组件的订阅不动(现在的运行时是配置一变全部退订重建,这次改成按组件粒度)。同一 tick 内连改几个键只重订一次 |
| 键不存在 / 为 null,`whenMissing: 'empty'`(缺省) | 卡片显示中性的「未选择设备」,不订阅、不算报错、不抛 `bindError` |
| 键不存在,`whenMissing: 'fallback'` | 用 `fallback` 订阅(适合「默认先看 1# PCS」的页面) |
| 上下文给的实体类型与 `type` 不符 | 卡片显示「配置错误:需要 DEVICE,给的是 ASSET」,不订阅 |
| 上下文实体该用户无权访问(CUSTOMER_USER 看别人的设备) | 走现有 `onError` 通道,卡片显示「数据不可用」,与固定绑定一致 |
| `design` 态(编辑器缩略图) | 不变:用 `sampleData`,不订阅、不看上下文 |
| 卡片标题 / 图例里的设备名 | 用上下文实体的 `name`;没给就用 `fallback.name`,再没有就不显示 |

`defineExpose` 多给一个 `contextKeys`(这张页 / 这张卡引用了哪些上下文键),宿主可据此判断要不要显示设备选择器。

### 3.3 测试(Vitest + MockDataSource)

- 换设备:退订数 == 旧订阅数,新订阅的实体 id 正确;没引用该键的组件 `subscribe` 调用次数不变。
- `whenMissing` 两种取值;类型不符;键从有到 null 再到有。
- 多项槽位(概览卡、曲线 series)里固定与上下文混用。
- `window` 取自上下文:改值后只重拉历史,不重复订阅实时。
- 旧配置(0.8.0 的全部样例页)原样通过校验与渲染快照。
- 卸载时订阅数 == 退订数(沿用现有保证)。

---

## 4. 联动:更多组件抛 `widget-event`(一期只做「抛」,不做「声明式动作」)

`<ScadaPage>` / `<ScadaWidget>` 已有 `@widget-event`(载荷 `{ widgetId, type, name, detail }`),目前只有接线图在用(`node-click`)。0.9.0 补上:

| 组件 | 事件名 | detail |
|---|---|---|
| table | `row-click` | `{ entity?, row }` |
| status-light | `click` | `{ entity? }` |
| alarm-list | `alarm-click` | `{ alarm }`(含 `originator`) |
| number-card / gauge | `click` | `{ entity? }` |
| sld(已有) | `node-click` | `{ nodeId, name?, entity?: { type, name, id? } }` |

宿主收到事件自己改上下文,联动就通了,跳转 / 弹窗也由宿主决定:

```ts
function onWidgetEvent(ev) {
  // 接线图里只存实体名,id 是从该组件的绑定里反查的,查不到就不带——所以要判 id
  if (ev.name === 'node-click' && ev.detail?.entity?.id) ctx.selectedDevice = ev.detail.entity
}
```

「在配置里声明点击后做什么」(`on.click → setContext / navigate / dialog`)放二期:它要定动作词表、跳转目标怎么表达(宿主路由不归渲染器管),值得单独讨论,一期先让事件通路走顺。

---

## 5. 部署工具改动

- **绑定面板**:实体选择处加一个切换「固定实体 / 跟随页面上下文」。选后者:选上下文键(下拉给 `selectedDevice` / `selectedSite`,也可手填)→ 选一台**样例设备**(写进 `fallback`)→ 测点列表按样例设备给 → 选「没选设备时」显示空态还是用样例设备。
- **时间窗口**:曲线的窗口处同样加「跟随上下文(timeRange)」。
- **预览**:预览区上方加「上下文模拟」条——从实体树里挑一台设备、改时间范围,看卡片跟着换。
- **校验**:样例设备上没有所选测点 → 警告;配了上下文绑定但没给 `fallback` → 提示(编辑器无法预览)。
- **卡片库 / 复制引用**:不变。引用仍是 `{ pageId, widgetId }`;在引用旁标出这张卡需要的上下文键,例如「需要:selectedDevice」,方便庄那边知道要喂什么。
- **`tbsite pages --widgets --json`**:每张卡多一列 `contextKeys`。
- 文档:`操作说明-工程人员.md`、`给同事的开发说明.md` §3、渲染器 README / CHANGELOG 同步。

---

## 6. 订阅合并与引用计数(在 tbClient 侧,我方给参考实现)

建议文档第五节末尾提的「相同实体和测点的订阅合并及引用计数」,位置判断是对的,但**只能做在 DataSource 实现里**:一页放 N 张 `<ScadaWidget>` 就是 N 份独立的绑定运行时,渲染器这一层看不到彼此。宿主用的 tbClient 归庄维护,所以这条由她改;我们部署工具自用的 `LegacyDataSource`(`packages/tb-client/src/legacy-adapter.ts`)已经做了一版,可以直接参照:

- **逻辑订阅与 WS 命令解耦**:一次 `subscribeTs / subscribeAttr` 调用是一个逻辑订阅;发给 TB 的一条订阅命令(一个 `cmdId`)下面可以挂多个逻辑订阅。
- **合并规则**:同一 tick 内的订阅按「种类 + 实体类型 + 实体 id + scope」分组,keys 取去重并集,一组一条命令。
- **分片**:整批按 24000 字节切开发送(TB 入站单条 WS 消息上限 32768 字节,见 `给同事的-WS订阅单条消息上限-2026-09-18.md`);单条命令自己要超限时同实体另起一条。
- **回推分发**:合并命令的推送按 key 分发,推送里没有自己 key 的订阅者不打扰。
- **退订**:命令下的成员全部退订后才向 TB 发 unsubscribe;同一 tick 里先退后订(渲染器切配置正是这个模式);没有任何订阅时关掉 WS。
- **重连**:重放全部存活的逻辑订阅,重新合并、分片。

已知的不足,庄实现时可以一并补上:它**只在同一批内合并**,不会往已发出的命令里追加 key(TB 没有「改订阅」命令)。要做到跨时间的去重——曲线已经订了 `P`,后来数字卡又订 `P`——需要在逻辑层按「实体 + key」做引用计数,并把缓存的最新值作为后来者的首包回调。上下文切换设备时是「一批退订 + 一批订阅」,现有的同批合并已经覆盖得到。

---

## 7. 建议文档其余各项的回应与排期

| 建议 | 判断 | 安排 |
|---|---|---|
| BindingContext、动态实体、时间范围 | 可行,改动小,是其他联动能力的前提 | **第 1 批(本文)** |
| 组件点击 → 上下文更新 | 事件通路已有,补齐各组件的事件 | 第 1 批(§4);声明式动作放第 3 批 |
| 订阅合并 / 引用计数 | 在 tbClient 侧 | 庄实现,§6 为参考 |
| 统一状态:加载中 / 无数据 / 无权限 / 不存在 / 离线 / 超时 / 配置错误 | 可行。现在只有「数据不可用」和页面级离线徽标,各组件空态各写各的 | 第 2 批:收口到 `CardFrame` 的统一状态模型;本批新增的「未选择设备」「配置错误」先按这个模型做 |
| 柱状图(横 / 纵)、饼图、阈值线、多轴 | 可行,ECharts 已在包里,多轴已有 `dual-axis` | 第 2 批 |
| 表格:分页、排序、筛选、操作列 | 可行,组件内部的事;操作列 = 抛 `widget-event` | 第 2 批 |
| 表格:实体列表、动态列;地图点位 | 可行,但要**动 `DataSource` 契约**:现在没有「这个站下面所有 PCS」这种实体集合查询,需新增可选方法(如 `queryEntities`),庄的 tbClient 要实现 | 第 3 批,先一起定接口 |
| 动态测点、业务角色设备 | 动态测点依赖「设备类型 → 测点映射」,放在实体集合之后;业务角色由宿主 / 工具解析后放进上下文(§2.3),渲染器不查 | 第 3 批 |
| 筛选栏 | 做成一个「写上下文」的普通组件,不动模板模型 | 第 3 批 |
| 通用地图(全国 / 省,底图、点位、告警、下钻) | 可行,但要单独立项:省级 geojson 体积、中国地图的合规要求(审图号、边界画法)、内网离线拿不到在线底图 | 第 4 批,需 YY 先定底图来源 |
| 模板:槽位最小尺寸、宽高比、滚动策略 | 好加 | 第 2 批顺带 |
| 模板:嵌套布局、标签页 | 等于引入「容器组件」,现在「一槽位一组件」的模型、编辑器槽位板、换模板保留逻辑都要跟着动,代价最大 | 第 4 批,单独讨论 |
| 样式统一(字号、间距、rem/px) | 渲染器内部已统一走 `--sr-*` 令牌与 `--sr-scale`;单卡嵌入时 `--sr-scale` 固定为 1、尺寸随容器。宿主 rem 页面里若有具体不协调之处,请给截图,按令牌调 | 随到随改 |
| 配置化边界(展示页优先;权限 / 维护流程不组态;目标 40%~50%) | 同意,与架构 v2 §6 一致 | — |

与建议文档第九节的顺序相比,主要差别是:**BindingContext 提到最前**(小、且联动 / 筛选 / 地图下钻都依赖它),**地图挪到最后**(最大,且有前置决定)。

---

## 8. 请庄确认的 6 个问题

1. **上下文键名**:通用键用 `selectedSite` / `selectedDevice` / `timeRange`,其余自定义键由宿主自己起——可以吗?你那边现有页面还有哪些「当前 xxx」需要进上下文(当前客户?当前告警?)。
2. **没选设备时**:缺省显示「未选择设备」空态,需要默认设备的页面在绑定上配 `whenMissing: 'fallback'`——这个缺省方向对吗?还是你更希望缺省就用样例设备?
3. **传上下文的方式**:`:context` prop 与 `provideBindingContext()` 两种都给,props 优先。够用吗?
4. **绝对时间区间**:历史趋势 / 历史告警页需要「起止日期」吗?需要的话 `DataSource.getHistory` 要加 `{ from, to }` 形式(可选新增),你的 tbClient 要跟着支持——是并进这一批,还是先只做「最近 N」?
5. **不同类型设备**:一期「每种设备类型各配一组卡,宿主按类型切换显示哪组」能接受吗?设备测试页大概有几种设备类型?
6. **升级顺序**:含上下文绑定的页面只有 0.9.0 认识。你先升 0.9.0、我们再开始发布这类页面——时间上有没有问题?

---

## 9. 验收清单(第 1 批)

- [ ] 旧页面 / 旧卡片库在 0.9.0 下渲染与 0.8.0 一致(快照不变)。
- [ ] 设备测试页:不用 `buildDeviceTestWidgets`,设备树点选 → 数字卡、曲线、表格、仪表盘同时切到该设备;把曲线换成表格只改配置。
- [ ] 连点 5 台设备后,WS 上存活的订阅只有最后一台的(用 `defineExpose` 的 stats 或 tbClient 日志核对)。
- [ ] 固定绑定的汇总卡在切设备过程中订阅不断、数值不闪。
- [ ] 未选设备时显示空态;CUSTOMER_USER 选到无权设备时显示「数据不可用」,不白屏、不卡死。
- [ ] `timeRange` 从 24h 改 7d:所有跟随的曲线重拉,固定窗口的曲线不动。
- [ ] 工具:能配上下文绑定、能在预览里模拟换设备;发布出来的 JSON 通过 `validatePageConfig`。

确认 §8 后开工,第 1 批预计一周内出包(渲染器 0.9.0 + 部署工具同步)。

# 渲染器新增:组件事件 `widget-event` 与一次接线图组件 `sld`(给庄艳芹)· 2026-09-18

**这次不换包,你现在什么都不用改。** 这份是预告:下一个渲染器包(0.4.0,接线图做完时一起给)会多两样东西,都是纯新增,现有接入代码照常工作。

## 1. `widget-event`:组件里发生的事,宿主能收到

`<ScadaPage>` 和 `<ScadaWidget>` 多了一个事件:

```vue
<ScadaPage :config="page" @widget-event="onWidgetEvent" />
<ScadaWidget :config="card" @widget-event="onWidgetEvent" />
```

```ts
interface WidgetEventPayload {
  widgetId: string // 哪个组件(页面里的组件 id)
  type: string // 组件类型,如 'sld'
  name: string // 事件名,如 'node-click'
  detail?: unknown // 事件内容,形状由该组件定
}
```

- 不监听就什么都不会发生;放大层(右上角 ⤢ 打开的那份)里触发的事件也从同一个出口抛出来。
- 目前只有接线图组件会发事件(见下)。现有 10 个组件不发。

## 2. 一次接线图组件 `sld`

工程人员在部署工具里画好接线图、绑好测点,发布后它就是页面里的一个普通组件(`type: 'sld'`),你那边 `<ScadaPage>` 渲染页面时自动带出来,`<ScadaWidget>` 单卡嵌入也一样——**不需要为它写任何接入代码**。它会显示:开关分合、带电 / 失电着色、测点实时数值、数据过期变灰、告警闪烁。纯 SVG,不给你的包体加任何新依赖。

它会发一个事件,你可能用得上:

```ts
// name === 'node-click' 时的 detail
interface SldNodeClickDetail {
  nodeId: string // 图上的节点 id
  name?: string // 节点显示名,如「1# 进线柜」
  entity?: { type: 'DEVICE' | 'ASSET'; id: string; name: string } // 节点绑的 TB 实体(没绑就没有)
}
```

典型用法:用户点了图上的某台设备 → 你弹这台设备的详情 / 跳到它的页面。现有的一次图上那些小图标弹窗,以后就走这个事件。

`entity.id` 是页面发布时解析出的 TB 实体 id;极少数情况下(页面没发布过、设备在平台上被删了)可能没有,这时请退回按 `entity.name` 查。(以 0.4.0 的 CHANGELOG 为准。)

## 3. 需要你留意的一条:大页面的 WebSocket 订阅

见另一份说明 `给同事的-WS订阅单条消息上限-2026-09-18.md`:一张接线图有 300–400 个测点,如果你的 TbClient 是把一批订阅合成**一条** WS 消息发给 TB,超过 32 KB 会被 TB 直接断开。请对照那份说明确认一下你的发送方式。

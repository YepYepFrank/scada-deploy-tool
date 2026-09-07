/**
 * `@grid/tb-client/testing`:DataSource 一致性测试套件(同事在自己仓库里验收 TbClient 用;需要 vitest)。
 *   import { describeDataSourceConformance, FakeTb, FakeSocket } from '@grid/tb-client/testing'
 *   describeDataSourceConformance('TbClient', () => { const tb = new FakeTb(); return { ds: new TbClient({ fetch: tb.fetch, WebSocket: FakeSocket, ... }), tb } })
 * FakeTb 模拟 TB CE 4.3.1 的 REST + WS 子集与实测怪癖(退订必须带 entityId、不存在的 key 推 null、无权实体回 errorCode 1、kz 收益趋势)。
 */
export { FakeTb, FakeSocket } from './fake-tb'
export { describeDataSourceConformance, type ConformanceHarness } from './conformance'

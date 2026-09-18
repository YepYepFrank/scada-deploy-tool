<script setup lang="ts">
/**
 * 一次接线图图元总览(T5.2,目检用):按分组列出全部内置图元,开关类并排画 open / closed / unknown 三态。
 * 顶部开关:旋转、镜像、显示端口(红点)、显示栅格、颜色(验证「片段只用 currentColor」的约定——换色后整个图元必须跟着变)。
 * 端口红点用 model/geometry 的 symbolPoint 算,与运行时 / 编辑器同一套规则:红点应当正好压在引线末端。
 */
import { computed, ref } from 'vue'
import { SldSymbolBox, builtinSldSymbolGroups, builtinSldSymbols, symbolBoxSize, symbolPoint } from '../src/sld'
import type { SldRotation, SldSwitchState, SldSymbolDefinition } from '../src/sld'

const SCALE = 2
const ROTATIONS: SldRotation[] = [0, 90, 180, 270]
const STATES: SldSwitchState[] = ['open', 'closed', 'unknown']
const COLORS = [
  { id: 'cyan', title: '青', value: '#22d3ee' },
  { id: 'green', title: '绿', value: '#34d399' },
  { id: 'red', title: '红', value: '#f87171' },
  { id: 'gray', title: '灰', value: '#94a3b8' },
]

const rot = ref<SldRotation>(0)
const flip = ref(false)
const showPorts = ref(true)
const showGrid = ref(false)
const color = ref(COLORS[0]!.value)

const total = builtinSldSymbols.length

interface Shot {
  state?: SldSwitchState
  w: number
  h: number
  ports: Array<{ id: string; x: number; y: number }>
  gridX: number[]
  gridY: number[]
}

const steps = (n: number): number[] => Array.from({ length: n / 10 + 1 }, (_, i) => i * 10)

function shots(def: SldSymbolDefinition): Shot[] {
  const { w, h } = symbolBoxSize(def, rot.value)
  const ports = def.ports.map(p => ({ id: p.id, ...symbolPoint(def, rot.value, flip.value, p.x, p.y) }))
  const one = { w, h, ports, gridX: steps(w), gridY: steps(h) }
  return def.stateBody ? STATES.map(state => ({ state, ...one })) : [one]
}

const groups = computed(() =>
  builtinSldSymbolGroups.map(g => ({
    ...g,
    cells: g.symbols.map(def => ({ def, shots: shots(def) })),
  }))
)
</script>

<template>
  <div class="gallery">
    <header class="bar">
      <h1>一次接线图图元总览</h1>
      <span class="count">共 {{ total }} 个</span>
      <div class="ctl">
        <span>旋转</span>
        <button v-for="r in ROTATIONS" :key="r" :class="{ on: rot === r }" @click="rot = r">{{ r }}</button>
      </div>
      <label class="ctl"><input v-model="flip" type="checkbox" />镜像</label>
      <label class="ctl"><input v-model="showPorts" type="checkbox" />显示端口(红点)</label>
      <label class="ctl"><input v-model="showGrid" type="checkbox" />显示栅格</label>
      <div class="ctl">
        <span>颜色</span>
        <button
          v-for="c in COLORS"
          :key="c.id"
          :class="{ on: color === c.value }"
          :style="{ color: c.value }"
          @click="color = c.value"
        >
          {{ c.title }}
        </button>
      </div>
    </header>

    <section v-for="g in groups" :key="g.id" class="group">
      <h2>{{ g.title }}({{ g.cells.length }})</h2>
      <div class="grid">
        <article v-for="cell in g.cells" :key="cell.def.id" class="cell" :data-symbol="cell.def.id">
          <div class="shots">
            <figure v-for="s in cell.shots" :key="s.state ?? 'x'" class="shot">
              <div class="stage" :style="{ width: s.w * SCALE + 'px', height: s.h * SCALE + 'px', color }">
                <svg v-if="showGrid" class="overlay" :viewBox="`0 0 ${s.w} ${s.h}`">
                  <line v-for="x in s.gridX" :key="'x' + x" class="grid-line" :x1="x" y1="0" :x2="x" :y2="s.h" />
                  <line v-for="y in s.gridY" :key="'y' + y" class="grid-line" x1="0" :y1="y" :x2="s.w" :y2="y" />
                </svg>
                <SldSymbolBox :symbol="cell.def.id" :state="s.state" :rot="rot" :flip="flip" />
                <svg v-if="showPorts" class="overlay" :viewBox="`0 0 ${s.w} ${s.h}`">
                  <circle v-for="p in s.ports" :key="p.id" class="port" :cx="p.x" :cy="p.y" r="2">
                    <title>{{ p.id }}</title>
                  </circle>
                </svg>
              </div>
              <figcaption v-if="s.state">{{ s.state }}</figcaption>
            </figure>
          </div>
          <div class="meta">
            <code>{{ cell.def.id }}</code>
            <span class="name">{{ cell.def.name }}</span>
            <span class="dim">
              {{ cell.def.w }}×{{ cell.def.h }} · {{ cell.def.ports.length }} 端口 · {{ cell.def.conduct }}
              <template v-if="cell.def.defaultSource"> · 电源</template>
            </span>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.gallery {
  min-height: 100vh;
  padding: 0 24px 48px;
  background: #061c40;
  color: #ecf9ff;
  font-size: 13px;
}
.bar {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 20px;
  padding: 12px 0;
  background: #061c40;
  border-bottom: 1px solid #1d3b6e;
}
.bar h1 {
  margin: 0;
  font-size: 18px;
}
.count {
  color: #8fb3e0;
}
.ctl {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
}
.ctl button {
  min-width: 36px;
  padding: 3px 8px;
  border: 1px solid #2c5596;
  border-radius: 4px;
  background: transparent;
  color: #ecf9ff;
  cursor: pointer;
}
.ctl button.on {
  background: #12366f;
  border-color: #5aa2ff;
}
.group h2 {
  margin: 24px 0 12px;
  font-size: 15px;
  color: #8fb3e0;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}
.cell {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 12px 10px;
  border: 1px solid #1d3b6e;
  border-radius: 6px;
  background: #04142f;
}
.cell:has(.shot + .shot) {
  grid-column: span 2;
}
.shots {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: space-around;
  gap: 16px;
}
.shot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin: 0;
}
.shot figcaption {
  color: #8fb3e0;
  font-size: 12px;
}
.stage {
  position: relative;
}
.overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}
.grid-line {
  stroke: #2c5596;
  stroke-width: 0.5;
}
.port {
  fill: #ff2d2d;
  pointer-events: auto;
}
.meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 8px;
  border-top: 1px dashed #1d3b6e;
}
.meta code {
  color: #7dd3fc;
}
.meta .dim {
  color: #8fb3e0;
  font-size: 12px;
}
</style>

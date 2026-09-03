<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { login, getDevices, getHistory } from './api/tb'
import { store, seedHistory, connect } from './composables/useTelemetry'
import StatTile from './components/StatTile.vue'
import LineChart from './components/LineChart.vue'

const C = {
  blue: '#3987e5',
  orange: '#d95926',
  aqua: '#199e70',
  yellow: '#c98500',
  magenta: '#d55181',
  violet: '#9085e9',
}

const DEV = {
  sens1: 'BS_1_SENS',
  sens2: 'BS_2_SENS',
  bat1: 'BS_1_MO1',
  bat2: 'BS_2_MO1',
  ems: 'BS_1_EMS',
  ied: 'PDR1_LP1_IED1',
}

const HISTORY_KEYS = {
  [DEV.sens1]: ['SYS_NORMAL', 'SMOKE_DET_ALM', 'COM'],
  [DEV.bat1]: ['AMBIENT_T', 'BAT_T', 'SOC'],
  [DEV.bat2]: ['BAT_T'],
  [DEV.ems]: ['P', 'totalChargeEnergy', 'totalDischargeEnergy', 'netStoredEnergy'],
  [DEV.ied]: ['Ua', 'Ub', 'Uc', 'P', 'Q'],
}
const ROLLUP_KEYS = {
  [DEV.ems]: ['charge5m', 'discharge5m'],
  [DEV.ied]: ['loadEnergy5m'],
}
const ROLLUP_WINDOW_MIN = 180

const state = ref('boot')
const errMsg = ref('')

const d = (name) => store.byName[name] || { latest: {}, series: {} }
const latest = (name, key) => d(name).latest[key]
const series = (name, key) => d(name).series[key] || []

const clock = ref('')
let timer = null
function tick() {
  clock.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

onMounted(async () => {
  tick()
  timer = setInterval(tick, 1000)
  try {
    await login()
    const devices = await getDevices()
    await Promise.all(
      devices.map(async (dev) => {
        const keys = HISTORY_KEYS[dev.name]
        if (keys) seedHistory(dev.name, await getHistory(dev.id.id, keys, 15))
        const rollups = ROLLUP_KEYS[dev.name]
        if (rollups)
          seedHistory(dev.name, await getHistory(dev.id.id, rollups, ROLLUP_WINDOW_MIN))
      }),
    )
    connect(devices)
    state.value = 'ready'
  } catch (e) {
    state.value = 'error'
    errMsg.value = String(e)
  }
})
onUnmounted(() => clearInterval(timer))

const fmt = (v, n = 1) => (typeof v === 'number' ? v.toFixed(n) : '—')

const statusText = computed(
  () => ({ live: 'LIVE', connecting: 'SYNC', offline: 'OFFLINE' })[store.status],
)

// 基站健康状态汇总(任一开关量异常即异常)
const stationOk = (sens) => {
  const s = d(sens).latest
  if (s.SYS_NORMAL === undefined) return null
  return s.SYS_NORMAL === 1 && s.SMOKE_DET_ALM === 0 && s.COM === 1
}
const stationText = (sens) => {
  const ok = stationOk(sens)
  return ok === null ? '—' : ok ? '正常' : '异常'
}

// EMS 充/放方向徽章
const emsState = computed(() => {
  const p = latest(DEV.ems, 'P')
  if (typeof p !== 'number') return { text: '—', cls: '' }
  return p >= 0
    ? { text: `充电 ${fmt(p / 1000, 1)} kW`, cls: 'sell' }
    : { text: `放电 ${fmt(-p / 1000, 1)} kW`, cls: 'buy' }
})
</script>

<template>
  <div class="fx-aurora"></div>
  <div class="fx-noise"></div>
  <div class="fx-scan"></div>
  <div class="fx-sweep"></div>

  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">GRID<em>·</em>OPS</span>
        <span class="brand-sub">基站储能态势台 / ThingsBoard Edge</span>
      </div>
      <div class="topbar-right">
        <span v-if="store.frames" class="rx">RX {{ String(store.frames).padStart(5, '0') }}</span>
        <span class="live-pill" :class="store.status">
          <span class="live-dot"></span>{{ statusText }}
        </span>
        <span>{{ clock }}</span>
      </div>
    </header>

    <div v-if="state === 'boot'" class="boot">
      <div class="boot-term">
        <div class="ln"><span class="p">&gt;</span>auth · public customer <span class="ok">OK</span></div>
        <div class="ln"><span class="p">&gt;</span>devices · linking stations…</div>
        <div class="ln"><span class="p">&gt;</span>history · seeding 15 min buffers…</div>
        <div class="ln"><span class="p">&gt;</span>telemetry · opening websocket <span class="cursor"></span></div>
      </div>
    </div>
    <div v-else-if="state === 'error'" class="boot">
      <span class="err">连接失败:{{ errMsg }}</span>
    </div>

    <template v-else>
      <!-- headline metrics -->
      <section class="stat-rail">
        <StatTile label="电池组温度" en="BAT" :value="latest(DEV.bat1, 'BAT_T')"
          unit="°C" :color="C.orange" :delay="0"
          :sub="`环境 ${fmt(latest(DEV.bat1, 'AMBIENT_T'))} °C`" />
        <StatTile label="电池电量" en="SOC" :value="latest(DEV.bat1, 'SOC')"
          unit="%" :color="C.aqua" :delay="60"
          :sub="`净储能 ${fmt(latest(DEV.ems, 'netStoredEnergy'), 1)} kWh`" />
        <StatTile label="EMS 功率" en="EMS" :value="latest(DEV.ems, 'P')"
          unit="W" :color="C.yellow" :decimals="0" :delay="120"
          :sub="emsState.text" />
        <StatTile label="A相电压" en="VOLT" :value="latest(DEV.ied, 'Ua')"
          unit="V" :color="C.blue" :delay="180"
          :sub="`B ${fmt(latest(DEV.ied, 'Ub'))} · C ${fmt(latest(DEV.ied, 'Uc'))}`" />
        <StatTile label="配电有功" en="LOAD" :value="latest(DEV.ied, 'P')"
          unit="W" :color="C.violet" :decimals="0" :delay="240"
          :sub="`无功 ${fmt(latest(DEV.ied, 'Q'), 0)} var`" />
        <StatTile label="基站状态" en="STATION" :value="stationText(DEV.sens1)"
          unit="" :color="stationOk(DEV.sens1) === false ? '#e34948' : C.aqua" :delay="300"
          :sub="`基站2 ${stationText(DEV.sens2)} · 断路器 ${latest(DEV.ied, 'CB') === 0 ? '分闸' : '合闸'}`" />
      </section>

      <!-- charts -->
      <section class="grid">
        <div class="card" style="animation-delay: 120ms">
          <div class="card-head">
            <span class="card-title">电池温度<span class="en">BATTERY PACKS</span></span>
            <div class="card-side">
              <div class="side-kv"><div class="k">SOC</div><div class="v">{{ fmt(latest(DEV.bat1, 'SOC')) }} %</div></div>
              <div class="side-kv"><div class="k">环境</div><div class="v">{{ fmt(latest(DEV.bat1, 'AMBIENT_T')) }} °C</div></div>
            </div>
          </div>
          <div class="card-body">
            <LineChart unit="°C" :series="[
              { name: '基站1 电池', color: C.orange, data: series(DEV.bat1, 'BAT_T'), area: true },
              { name: '基站2 电池', color: C.magenta, data: series(DEV.bat2, 'BAT_T') },
              { name: '基站1 环境', color: C.blue, data: series(DEV.bat1, 'AMBIENT_T') },
            ]" />
          </div>
        </div>

        <div class="card" style="animation-delay: 180ms">
          <div class="card-head">
            <span class="card-title">三相电压<span class="en">400V BUS</span></span>
            <div class="card-side">
              <div class="side-kv"><div class="k">断路器</div><div class="v">{{ latest(DEV.ied, 'CB') === 0 ? '分闸' : '合闸' }}</div></div>
            </div>
          </div>
          <div class="card-body">
            <LineChart unit="V" :series="[
              { name: 'Ua', color: C.yellow, data: series(DEV.ied, 'Ua') },
              { name: 'Ub', color: C.aqua, data: series(DEV.ied, 'Ub') },
              { name: 'Uc', color: C.magenta, data: series(DEV.ied, 'Uc') },
            ]" />
          </div>
        </div>

        <div class="card" style="animation-delay: 240ms">
          <div class="card-head">
            <span class="card-title">EMS 充放电功率<span class="en">ENERGY STORAGE</span></span>
            <span class="badge" :class="emsState.cls">{{ emsState.text }}</span>
            <div class="card-side">
              <div class="side-kv"><div class="k">累计充</div><div class="v">{{ fmt(latest(DEV.ems, 'totalChargeEnergy'), 1) }} kWh</div></div>
              <div class="side-kv"><div class="k">累计放</div><div class="v">{{ fmt(latest(DEV.ems, 'totalDischargeEnergy'), 1) }} kWh</div></div>
            </div>
          </div>
          <div class="card-body">
            <LineChart unit="W" :series="[
              { name: '充(+) / 放(−)', color: C.yellow, data: series(DEV.ems, 'P'), area: true },
            ]" />
          </div>
        </div>

        <div class="card" style="animation-delay: 300ms">
          <div class="card-head">
            <span class="card-title">储能收支 · 5 分钟<span class="en">CHARGE LEDGER</span></span>
            <div class="card-side">
              <div class="side-kv"><div class="k">净储能</div><div class="v">{{ fmt(latest(DEV.ems, 'netStoredEnergy'), 1) }} kWh</div></div>
            </div>
          </div>
          <div class="card-body">
            <LineChart unit="kWh" :series="[
              { name: '充电量', color: C.aqua, data: series(DEV.ems, 'charge5m'), bar: true },
              { name: '放电量', color: C.orange, data: series(DEV.ems, 'discharge5m'), bar: true },
            ]" />
          </div>
        </div>

        <div class="card" style="animation-delay: 360ms">
          <div class="card-head">
            <span class="card-title">配电有功功率<span class="en">DISTRIBUTION</span></span>
            <div class="card-side">
              <div class="side-kv"><div class="k">无功</div><div class="v">{{ fmt(latest(DEV.ied, 'Q'), 0) }} var</div></div>
            </div>
          </div>
          <div class="card-body">
            <LineChart unit="W" :series="[
              { name: '有功 P', color: C.violet, data: series(DEV.ied, 'P'), area: true },
            ]" />
          </div>
        </div>

        <div class="card" style="animation-delay: 420ms">
          <div class="card-head">
            <span class="card-title">配电用电量 · 5 分钟<span class="en">LOAD ENERGY</span></span>
            <div class="card-side">
              <div class="side-kv"><div class="k">功率积分</div><div class="v">P × Δt 梯形法</div></div>
            </div>
          </div>
          <div class="card-body">
            <LineChart unit="kWh" :series="[
              { name: '用电量', color: C.blue, data: series(DEV.ied, 'loadEnergy5m'), bar: true },
            ]" />
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

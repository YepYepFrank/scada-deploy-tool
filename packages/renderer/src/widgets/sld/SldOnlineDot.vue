<script setup lang="ts">
/**
 * 在线灯(2026-09-20):在线 = 绿点呼吸,离线 = 红点常亮,没数据 = 灰点。节点角上的灯与「状态标签」共用。
 * 和数值标签一样直接从注入的上下文读自己那一个 `pt.*` 键——别的测点跳数不会让它重画。
 * **不判数据过期**:TB 的 `active` 只在上下线那一刻更新,时间戳旧不代表数据旧(见 resolveOnlineState)。
 */
import { computed, inject } from 'vue'
import { resolveOnlineState, sldPointSlot } from '../../sld'
import { SLD_CONTEXT_KEY } from './context'
import { asPointValue } from './format'

const props = withDefaults(defineProps<{ pt: string; x: number; y: number; r?: number }>(), { r: 4 })
const ctx = inject(SLD_CONTEXT_KEY, null)
const state = computed(() => resolveOnlineState(asPointValue(ctx?.values()[sldPointSlot(props.pt)])))
const TEXT = { online: '在线', offline: '离线', unknown: '在线状态未知' } as const
</script>

<template>
  <g class="sr-sld-online" :class="`sr-sld-online-${state}`" :data-online="state">
    <title>{{ TEXT[state] }}</title>
    <!-- 呼吸的是外面这圈光晕,实心点不动:远看「一亮一暗」,近看点的位置不跳 -->
    <circle class="sr-sld-online-halo" :cx="x" :cy="y" :r="r * 2.1" />
    <circle class="sr-sld-online-core" :cx="x" :cy="y" :r="r" />
  </g>
</template>

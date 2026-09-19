<script setup lang="ts">
/** 「对齐」下拉菜单:6 种对齐(≥ 2 个)+ 2 种等距(≥ 3 个);点一项 = 一次 apply,菜单保持打开便于连续操作。 */
import { computed, inject } from 'vue'
import { lookupSldSymbol } from '@grid/scada-renderer'
import { SLD_EDITOR_CTX } from '../../ext'
import ToolPopover from '../_shared/ToolPopover.vue'
import { ALIGN_OPS, alignCount, applyAlign, type AlignOp } from './ops'
import { alignMenu } from './state'

const ctx = inject(SLD_EDITOR_CTX)
if (!ctx) throw new Error('AlignMenu 必须放在 <SldEditor> 里')
const state = alignMenu(ctx)

const count = computed(() => alignCount(ctx.selection.value))

function run(op: AlignOp, title: string): void {
  const sel = ctx!.selection.value
  ctx!.apply(d => (applyAlign(d.doc, sel, op, lookupSldSymbol) ? undefined : false), title)
}
</script>

<template>
  <ToolPopover v-if="state.open" anchor="align" label="对齐 / 分布" @close="state.open = false">
    <div class="sld-tp-grid">
      <button
        v-for="o in ALIGN_OPS"
        :key="o.op"
        type="button"
        class="sld-tp-btn"
        :data-align="o.op"
        :disabled="ctx.readonly.value || count < o.min"
        @click="run(o.op, o.title)"
      >
        {{ o.title }}
      </button>
    </div>
    <p class="sld-tp-hint">
      已选 {{ count }} 个(图元 / 母线 / 分组框);对齐要 ≥ 2 个,等距要 ≥ 3 个。结果吸附栅格,依附标签跟着走。
    </p>
  </ToolPopover>
</template>

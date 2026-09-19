<script setup lang="ts">
/**
 * 「问题」面板:结构问题 + 图 ↔ 绑定一致性,按 error / warning 分组;点一条选中出问题的元素并滚到视口中央。
 * 「清理多余绑定」一次 apply 删掉所有没人引用的 pt.*。
 */
import { computed, inject } from 'vue'
import { SLD_EDITOR_CTX } from '../../ext'
import { pathToSelection, removeUnusedBindings, type PanelIssue } from './check'
import { issuesOf } from './state'

const ctx = inject(SLD_EDITOR_CTX)
if (!ctx) throw new Error('IssuesPanel 必须放在 <SldEditor> 里')
const handle = issuesOf(ctx)

const report = computed(() => handle.report.value)
const groups = computed(() =>
  (
    [
      { level: 'error', title: '错误', hint: '挡发布' },
      { level: 'warning', title: '提示', hint: '不挡发布' },
    ] as const
  )
    .map(g => ({ ...g, items: report.value.issues.filter(i => i.level === g.level) }))
    .filter(g => g.items.length)
)

const target = (i: PanelIssue): ReturnType<typeof pathToSelection> => pathToSelection(i.path, ctx.content.value.doc)

function locate(i: PanelIssue): void {
  const sel = target(i)
  if (sel) ctx!.select(sel, { center: true })
}

function cleanup(): void {
  const n = report.value.unusedSlots.length
  ctx!.apply(d => (removeUnusedBindings(d) ? undefined : false), `清理多余绑定(${n} 个)`)
}
</script>

<template>
  <div class="sld-iss">
    <div class="sld-iss-bar">
      <span data-field="summary">
        <b class="sld-iss-e">{{ report.errors }}</b> 个错误 · <b class="sld-iss-w">{{ report.warnings }}</b> 个提示
      </span>
      <button
        type="button"
        class="sld-iss-btn"
        data-act="cleanup"
        :disabled="ctx.readonly.value || !report.unusedSlots.length"
        :title="report.unusedSlots.join('、')"
        @click="cleanup"
      >
        清理多余绑定{{ report.unusedSlots.length ? `(${report.unusedSlots.length})` : '' }}
      </button>
    </div>
    <p v-if="!report.issues.length" class="sld-iss-empty">没有发现问题。</p>
    <section v-for="g in groups" :key="g.level" :data-group="g.level">
      <h4 :class="g.level === 'error' ? 'sld-iss-e' : 'sld-iss-w'">
        {{ g.title }}({{ g.items.length }})<small>{{ g.hint }}</small>
      </h4>
      <ul>
        <li
          v-for="(i, k) in g.items"
          :key="`${i.code}@${i.path}#${k}`"
          :class="{ 'sld-iss-link': !!target(i) }"
          :data-path="i.path"
          :data-code="i.code"
          :title="target(i) ? '点击定位' : i.path"
          @click="locate(i)"
        >
          <span class="sld-iss-msg">{{ i.message }}</span>
          <code>{{ i.path }}</code>
        </li>
      </ul>
    </section>
  </div>
</template>

<style>
.sld-iss {
  padding: 8px 10px;
  font-size: 12px;
}
.sld-iss-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.sld-iss-btn {
  padding: 3px 8px;
  color: inherit;
  font: inherit;
  font-size: 12px;
  background: transparent;
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  border-radius: 4px;
  cursor: pointer;
}
.sld-iss-btn:hover:not(:disabled) {
  border-color: var(--ed-accent, #19b7ff);
}
.sld-iss-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
.sld-iss-e {
  color: #f87171;
}
.sld-iss-w {
  color: #f59e0b;
}
.sld-iss h4 {
  margin: 10px 0 4px;
  font-size: 12px;
  font-weight: 600;
}
.sld-iss h4 small {
  margin-left: 6px;
  font-weight: 400;
  color: #dbeaff;
  opacity: 0.5;
}
.sld-iss ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.sld-iss li {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 5px 6px;
  border-radius: 4px;
  border-bottom: 1px solid var(--ed-line, rgba(83, 196, 255, 0.12));
}
.sld-iss-link {
  cursor: pointer;
}
.sld-iss-link:hover {
  background: rgba(25, 183, 255, 0.08);
}
.sld-iss li code {
  font-size: 11px;
  opacity: 0.5;
}
.sld-iss-empty {
  margin: 12px 2px;
  opacity: 0.6;
}
</style>

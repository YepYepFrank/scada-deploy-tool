<script setup lang="ts">
/** 卡片外框:标题 + 副标 + 右侧键值(当前值等)。图表 / 列表类组件共用,样式对齐现有大屏 .card。 */
withDefaults(
  defineProps<{
    title?: string
    subtitle?: string
    sideLabel?: string
    sideValue?: string
    sideColor?: string
    alarming?: boolean
    error?: string
  }>(),
  { title: '', subtitle: '', sideLabel: '', sideValue: '', sideColor: '', alarming: false, error: '' }
)
</script>

<template>
  <div class="sr-card sr-frame" :class="{ 'sr-alarming': alarming, 'sr-error': !!error }">
    <div class="sr-card-head">
      <span class="sr-card-title"
        >{{ title }}<span v-if="subtitle" class="sr-card-en">{{ subtitle }}</span></span
      >
      <div v-if="error" class="sr-card-side">
        <div class="sr-side-k">数据不可用</div>
        <div class="sr-side-v sr-side-err" :title="error">!</div>
      </div>
      <div v-else-if="sideLabel || sideValue" class="sr-card-side">
        <div class="sr-side-k">{{ sideLabel }}</div>
        <div class="sr-side-v" :style="sideColor ? { color: sideColor } : undefined">{{ sideValue }}</div>
      </div>
    </div>
    <div class="sr-card-body">
      <slot />
    </div>
  </div>
</template>

<style>
/* 面板质感(0.5.0):上下渐变底 + 顶部一道发丝高光 + 外投影,对齐部署工具向导里的 .panel。
   底色仍是不透明的,页面装饰层不会从卡片里透出来。想回到素面:把 --sr-panel-* 改掉即可。 */
.sr-card {
  position: relative;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  border: 1px solid var(--sr-panel-edge, var(--sr-line-0));
  border-radius: var(--sr-radius);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.035), transparent 40%),
    linear-gradient(180deg, var(--sr-panel-top, var(--sr-bg-1)), var(--sr-panel-bot, var(--sr-bg-1)));
  box-shadow: var(--sr-panel-shadow, none);
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
/* 顶边发丝高光:两端淡出,像生产端面板那条亮线 */
.sr-card::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 1px;
  pointer-events: none;
  background: linear-gradient(90deg, transparent 6%, var(--sr-panel-hairline, transparent), transparent 94%);
}
.sr-frame.sr-alarming {
  border-color: var(--sr-bad);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--sr-bad) 40%, transparent) inset;
}
/* 卡头:左侧一道渐变洗底(复刻生产端 dashboard-title 的标题条,不用图片)+ 下边线 */
.sr-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px 6px;
  border-bottom: 1px solid var(--sr-line-0);
  background: linear-gradient(90deg, var(--sr-title-wash, transparent), transparent 58%);
}
.sr-card-title {
  font-family: var(--sr-font-title);
  font-size: 15px;
  letter-spacing: 0.06em;
  color: var(--sr-ink-0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 0 12px rgba(90, 198, 255, 0.18);
}
/* 标题前的小竖条:所有卡片共用的一点识别度。
   数字卡 / 状态灯的 .sr-card-title 自己是 space-between 的 flex 容器(左标题右英文副标),
   竖条挂在容器上会被当成第三个 flex 项把两端撑开,所以那两处改挂在第一个 span 上。 */
.sr-card-head .sr-card-title::before,
.sr-number-card .sr-card-title > span:first-child::before,
.sr-sl-title > span:first-child::before {
  content: '';
  display: inline-block;
  vertical-align: -1px;
  width: 3px;
  height: 0.92em;
  margin-right: 8px;
  border-radius: 1px;
  background: linear-gradient(180deg, #9fe6ff, var(--sr-accent));
  box-shadow: 0 0 8px color-mix(in srgb, var(--sr-accent) 55%, transparent);
}
.sr-card-en {
  margin-left: 8px;
  font-family: var(--sr-font-num);
  font-size: max(11px, calc(var(--sr-min-text, 10px) * 0.85 / var(--sr-scale, 1)));
  letter-spacing: 0.12em;
  color: var(--sr-ink-2);
}
.sr-card-side {
  text-align: right;
  flex: none;
}
.sr-side-k {
  font-size: max(10px, calc(var(--sr-min-text, 10px) * 0.85 / var(--sr-scale, 1)));
  letter-spacing: 0.12em;
  color: var(--sr-ink-2);
}
.sr-side-v {
  font-family: var(--sr-font-num);
  font-size: 15px;
  color: var(--sr-ink-0);
  line-height: 1.2;
}
.sr-side-err {
  color: var(--sr-bad);
}
.sr-card-body {
  flex: 1;
  min-height: 0;
  position: relative;
  padding: 6px 8px 8px;
}
.sr-chart-box {
  width: 100%;
  height: 100%;
  min-height: 90px;
}
.sr-empty-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--sr-ink-2);
  font-size: max(12px, calc(var(--sr-min-text, 10px) / var(--sr-scale, 1)));
  letter-spacing: 0.08em;
  pointer-events: none;
}
</style>

<script setup lang="ts">
/** 对话框经 `layers` 扩展点挂进编辑器,再由 EditorPortal 挪出带 transform 的图层 */
import EditorPortal from '../_shared/EditorPortal.vue'
import DuplicateBayDialog from './DuplicateBayDialog.vue'
</script>

<template>
  <EditorPortal><DuplicateBayDialog /></EditorPortal>
</template>

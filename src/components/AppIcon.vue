<script setup>
import { computed } from 'vue'

/**
 * 内置矢量图标集。
 *
 * 为什么自己画而不装 lucide-vue-next / unplugin-icons：
 *   1. 这个项目只要 20 来个图标，加一条运行时依赖换 20 个 path 不划算；
 *   2. 图标是纯静态数据，可以整包跟着组件一起被 tree-shake，没有任何运行时开销。
 *
 * 为什么用「描述符 + <component :is>」而不是把 path 字符串塞进 v-html：
 * 后者要走 innerHTML，哪怕数据是本地常量，也不该在渲染路径上开这个口子
 * （同一个项目里 ChatPanel 为了防 XSS 宁可放弃 markdown 渲染，标准要一致）。
 */
const props = defineProps({
  name: { type: String, required: true },
  /** 边长，px */
  size: { type: [Number, String], default: 20 },
  strokeWidth: { type: [Number, String], default: 1.75 },
})

const p = (d) => ({ t: 'path', p: { d } })
const c = (cx, cy, r) => ({ t: 'circle', p: { cx, cy, r } })
const rect = (x, y, width, height, rx) => ({
  t: 'rect',
  p: rx ? { x, y, width, height, rx } : { x, y, width, height },
})

/** 全部按 24×24 视窗、描边式绘制，颜色一律走 currentColor 以便跟随主题 */
const SHAPES = {
  /* ===== 角色 ===== */
  sparkles: [
    p('M12 3.5l1.7 4.6 4.6 1.7-4.6 1.7L12 16.1l-1.7-4.6L5.7 9.8l4.6-1.7z'),
    p('M18.5 3.5v3M17 5h3'),
    p('M6 16.5V19M4.75 17.75h2.5'),
  ],
  bot: [
    rect(4, 8.5, 16, 11.5, 3),
    p('M12 8.5V5.5'),
    c(9, 13.5, 1.1),
    c(15, 13.5, 1.1),
    p('M9.5 17h5'),
    c(12, 3.5, 1),
  ],
  headset: [
    p('M4 14.5v-2.5a8 8 0 0 1 16 0v2.5'),
    p(
      'M3.5 14.5A1.5 1.5 0 0 1 5 13h.5A1.5 1.5 0 0 1 7 14.5v3A1.5 1.5 0 0 1 5.5 19H5a1.5 1.5 0 0 1-1.5-1.5z',
    ),
    p(
      'M20.5 14.5A1.5 1.5 0 0 0 19 13h-.5A1.5 1.5 0 0 0 17 14.5v3A1.5 1.5 0 0 0 18.5 19h.5a1.5 1.5 0 0 0 1.5-1.5z',
    ),
    p('M16.5 19.5v.5a2 2 0 0 1-2 2H12'),
  ],
  bookOpen: [
    p('M12 7v13'),
    p(
      'M3 17.5A1.5 1.5 0 0 1 4.5 16H9a3 3 0 0 1 3 3 3 3 0 0 1 3-3h4.5A1.5 1.5 0 0 1 21 17.5V5.5A1.5 1.5 0 0 1 19.5 4H15a3 3 0 0 0-3 3 3 3 0 0 0-3-3H4.5A1.5 1.5 0 0 1 3 5.5z',
    ),
  ],

  /* ===== 导航与操作 ===== */
  plus: [p('M12 5v14M5 12h14')],
  refresh: [p('M20.5 12a8.5 8.5 0 1 1-2.6-6.1'), p('M20.5 4v5h-5')],
  panelLeft: [rect(3, 4, 18, 16, 2), p('M9.5 4v16')],
  menu: [p('M4 6h16M4 12h16M4 18h16')],
  x: [p('M18 6L6 18M6 6l12 12')],
  send: [p('M12 19.5V5M5.5 11.5L12 5l6.5 6.5')],
  stop: [rect(7, 7, 10, 10, 2)],
  chevronDown: [p('M6 9.5l6 6 6-6')],
  externalLink: [
    p('M18 13.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5.5'),
    p('M14.5 3H21v6.5'),
    p('M10.5 13.5L21 3'),
  ],
  user: [p('M20 21v-1.5a4.5 4.5 0 0 0-4.5-4.5h-7A4.5 4.5 0 0 0 4 19.5V21'), c(12, 7, 4)],

  /* ===== 知识库 ===== */
  book: [
    p('M4 19.5A2.5 2.5 0 0 1 6.5 17H20'),
    p('M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z'),
  ],
  uploadCloud: [
    p('M16 17l-4-4-4 4'),
    p('M12 13v8'),
    p('M20.4 18.4A5 5 0 0 0 18 9h-1.3A8 8 0 1 0 4 17'),
  ],
  fileText: [
    p('M14 3v5h5'),
    p('M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z'),
    p('M9 13h6M9 17h4'),
  ],

  /* ===== 状态 ===== */
  loader: [p('M12 3a9 9 0 1 0 9 9')],
  checkCircle: [c(12, 12, 9), p('M8.5 12.4l2.4 2.4 4.6-5')],
  alertTriangle: [
    p('M10.3 4.3 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z'),
    p('M12 9.5v4M12 17h.01'),
  ],
  xCircle: [c(12, 12, 9), p('M15 9l-6 6M9 9l6 6')],
  info: [c(12, 12, 9), p('M12 11v5.5M12 7.75h.01')],

  /* ===== 主题 ===== */
  sun: [
    c(12, 12, 4),
    p(
      'M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
    ),
  ],
  moon: [p('M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z')],
  monitor: [rect(2, 4, 20, 13, 2), p('M8 21h8M12 17v4')],
}

const shapes = computed(() => SHAPES[props.name] || [])
</script>

<template>
  <!--
    aria-hidden + focusable=false：图标一律是装饰性的，
    语义由外层的文字或按钮的 aria-label 承担，避免读屏重复念一遍。
  -->
  <svg
    class="icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <component :is="shape.t" v-for="(shape, i) in shapes" :key="i" v-bind="shape.p" />
  </svg>
</template>

<style scoped>
.icon {
  display: block;
  flex-shrink: 0;
}

/* 旋转由使用者按需加类，方便在 reduced-motion 下被全局规则关掉 */
:global(.icon-spin) {
  animation: icon-spin 900ms linear infinite;
}

@keyframes icon-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

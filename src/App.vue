<script setup>
import { RouterView } from 'vue-router'
import AppHeader from './components/AppHeader.vue'
</script>

<template>
  <AppHeader />
  <RouterView />
</template>

<!--
  全局重置与基础变量统一放在 src/assets/main.css（在 main.ts 里引入），
  这里不再重复一份 body/* 的覆盖规则 —— 两份同时存在时，
  组件样式注入更晚、会静默盖掉 main.css，改起来很容易踩坑。
-->

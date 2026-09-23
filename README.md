# my-ai-chat-app

智能客服工作台前端（Vue 3 + Vite）：**左栏对话，右栏上传文档到知识库**，两者同屏。

对接的后端是 [`my-agent-api`](../my-agent-api)（FastAPI + LangGraph + Chroma 混合检索），需要它跑在 `127.0.0.1:8000`。前端不含任何 mock 数据，所有内容都来自真实接口。

完整说明见 [PROJECT_DOCS.md](PROJECT_DOCS.md)。

## 快速启动

```sh
npm install
npm run dev          # 前端 http://localhost:5173
```

```sh
cd ../my-agent-api && venv\Scripts\activate && python main.py   # 后端 127.0.0.1:8000
```


## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Recommended Browser Setup

- Chromium-based browsers (Chrome, Edge, Brave, etc.):
  - [Vue.js devtools](https://chromewebstore.google.com/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd)
  - [Turn on Custom Object Formatter in Chrome DevTools](http://bit.ly/object-formatters)
- Firefox:
  - [Vue.js devtools](https://addons.mozilla.org/en-US/firefox/addon/vue-js-devtools/)
  - [Turn on Custom Object Formatter in Firefox DevTools](https://fxdx.dev/firefox-devtools-custom-object-formatters/)

## Type Support for `.vue` Imports in TS

TypeScript cannot handle type information for `.vue` imports by default, so we replace the `tsc` CLI with `vue-tsc` for type checking. In editors, we need [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) to make the TypeScript language service aware of `.vue` types.

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## Project Setup

```sh
npm install
```

### Compile and Hot-Reload for Development

```sh
npm run dev
```

### Type-Check, Compile and Minify for Production

```sh
npm run build
```

### Run Unit Tests with [Vitest](https://vitest.dev/)

```sh
npm run test:unit
```

### Lint with [ESLint](https://eslint.org/)

```sh
npm run lint
```

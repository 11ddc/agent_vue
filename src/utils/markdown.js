/**
 * 极简 Markdown 渲染器。
 *
 * 为什么要自己写：
 *   重构前 ChatPanel 为了防 XSS，直接放弃渲染，用 `white-space: pre-wrap` 输出纯文本，
 *   结果是 RAG 答案里的 `**加粗**`、`- 列表`、表格全部原样露在气泡里。
 *   这不只是审美问题，是功能缺陷——客服答案基本都带列表。
 *   装 markdown-it 能解决，但为了几十行逻辑加一条运行时依赖不划算，这个项目也没有别的 markdown 场景。
 *
 * 安全模型（**先转义，再变换**，不是"渲染完再过滤"）：
 *   1. 所有用户/后端文本先经过 escapeHtml，`<` `>` `&` `"` `'` 全部变成实体；
 *   2. 之后所有插入的标签都由本文件自己拼出来，且只有白名单里的那几个；
 *   3. 链接额外过一遍 safeUrl，挡掉 javascript: / data: 这类伪协议
 *     （包括 `java\tscript:` 这种用控制字符绕过的写法）。
 *   所以输出的 HTML 里不存在任何来自输入的标签或属性，
 *   调用方可以放心用 v-html —— 这跟"把后端原始 HTML 直接 innerHTML"是两回事。
 *
 * 刻意不支持的语法（用不到，且会让实现复杂一个量级）：
 *   嵌套列表、表格、图片、HTML 内联块、跨行的行内代码。
 *   要支持它们就该换成 markdown-it，而不是继续往这里堆正则。
 */

const ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch])
}

/**
 * 链接白名单。返回 null 表示这个链接不可信，调用方应保留原文而不是生成 <a>。
 * 注意先剥掉控制字符和空格再判断协议：`java\nscript:alert(1)` 在浏览器里仍然是可执行的。
 */
export function safeUrl(raw) {
  const url = String(raw ?? '').trim()
  /*
   * 逐个字符过滤掉所有不可打印的码位（控制字符 + 空格 + DEL）。
   *
   * 为什么要过滤而不是只判断协议：浏览器解析 URL 时会忽略这些字符，
   * `java\tscript:alert(1)` 照样会被当作 javascript 执行。
   * 这里用 charCodeAt 而不是正则里写 \u0000-\u0020 的范围，
   * 因为后者会触发 eslint 的 no-control-regex（而这里恰恰是有意为之的）。
   */
  const flattened = Array.from(url)
    .filter((ch) => {
      const code = ch.charCodeAt(0)
      return code > 0x20 && code !== 0x7f
    })
    .join('')
  if (/^(https?:|mailto:)/i.test(flattened)) return flattened
  if (flattened.startsWith('/') || flattened.startsWith('#')) return flattened
  return null
}

/*
 * 行内占位符用 Unicode 私用区的两个码位夹住序号。
 *
 * 为什么不用 NUL 之类的控制字符：正则会触发 eslint 的 no-control-regex。
 * 私用区码位没有键盘能打出来；即使某个用户的文本里真的带了它，
 * 最坏情况也只是多渲染一次**我们自己生成的**标签（重复内容，不是注入），
 * 不会变成安全问题。
 */
const OPEN = '\uE000'
const CLOSE = '\uE001'
const PLACEHOLDER = new RegExp(`${OPEN}(\\d+)${CLOSE}`, 'g')

function inline(text) {
  const stash = []
  const keep = (html) => `${OPEN}${stash.push(html) - 1}${CLOSE}`

  let s = escapeHtml(text).replace(/\r?\n/g, '\n')

  // 1) 行内代码最先抽取：`**a**` 里的星号不该被当成强调
  s = s.replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${code}</code>`))

  // 2) 显式链接 [文字](地址)
  s = s.replace(/\[([^\]\n]*)\]\(([^)\s]+)\)/g, (whole, label, href) => {
    const url = safeUrl(href)
    if (!url) return whole
    return keep(linkHtml(url, label))
  })

  // 3) 裸地址自动成链。前面必须有空白或左括号，避免把 abc/http://x 这种切成半截
  s = s.replace(
    /(^|[\s(])(https?:\/\/[^\s<)\]]+)/g,
    (_, lead, url) => lead + keep(linkHtml(safeUrl(url) || url, url)),
  )

  // 4) 强调。加粗必须在斜体之前，否则 **a** 会先被斜体规则吃掉两个星号
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
  s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  s = s.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>')

  // 5) 单个换行当软换行：客服答案经常一行一句，不处理会挤成一段
  s = s.replace(/\n/g, '<br>')

  // 6) 还原占位符。还原出来的内容里可能还嵌着占位符（链接文字里有行内代码），
  //    所以循环到不动点为止；最多 20 轮，防止任何意外自引用把主线程挂死。
  for (let guard = 0; guard < 20; guard += 1) {
    const next = s.replace(PLACEHOLDER, (_, n) => stash[Number(n)] ?? '')
    if (next === s) break
    s = next
  }
  return s
}

function linkHtml(url, label) {
  return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
}

const FENCE = /^(?:```|~~~)(\S*)\s*$/
const HEADING = /^(#{1,6})\s+(.*)$/
const HR = /^\s*(?:[-*_])(?:\s*[-*_]){2,}\s*$/
const QUOTE = /^>\s?(.*)$/
const UL = /^\s*[-*+]\s+(.*)$/
const OL = /^\s*\d+[.)]\s+(.*)$/

/**
 * @param {string} source markdown 原文
 * @returns {string} 只含白名单标签的 HTML
 */
export function renderMarkdown(source) {
  const text = String(source ?? '').replace(/\r\n?/g, '\n')
  if (!text.trim()) return ''

  const lines = text.split('\n')
  const out = []
  let paragraph = []
  let i = 0

  const flushParagraph = () => {
    if (!paragraph.length) return
    out.push(`<p>${inline(paragraph.join('\n'))}</p>`)
    paragraph = []
  }

  while (i < lines.length) {
    const line = lines[i]

    // 空行：段落边界
    if (!line.trim()) {
      flushParagraph()
      i += 1
      continue
    }

    // 围栏代码块。流式输出时结尾的 ``` 可能还没到，这里按"读到文件尾就闭合"处理，
    // 否则用户会看到一段还在长高的 ``` 原文
    const fence = FENCE.exec(line)
    if (fence) {
      flushParagraph()
      const lang = fence[1] || ''
      const body = []
      i += 1
      while (i < lines.length && !FENCE.test(lines[i])) {
        body.push(lines[i])
        i += 1
      }
      i += 1 // 跳过收尾的 ```
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : ''
      out.push(`<pre><code${cls}>${escapeHtml(body.join('\n'))}</code></pre>`)
      continue
    }

    if (HR.test(line)) {
      flushParagraph()
      out.push('<hr>')
      i += 1
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      flushParagraph()
      const level = heading[1].length
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      i += 1
      continue
    }

    // 引用：整段取出后递归渲染，这样引用里的列表也能正常出来
    if (QUOTE.test(line)) {
      flushParagraph()
      const body = []
      while (i < lines.length && QUOTE.test(lines[i])) {
        body.push(QUOTE.exec(lines[i])[1])
        i += 1
      }
      out.push(`<blockquote>${renderMarkdown(body.join('\n'))}</blockquote>`)
      continue
    }

    // 列表：按"连续同类行"成块。缩进不解释成嵌套层级，直接拍平
    if (UL.test(line) || OL.test(line)) {
      flushParagraph()
      const ordered = OL.test(line)
      const pick = ordered ? OL : UL
      const items = []
      while (i < lines.length && pick.test(lines[i])) {
        items.push(`<li>${inline(pick.exec(lines[i])[1])}</li>`)
        i += 1
      }
      const tag = ordered ? 'ol' : 'ul'
      out.push(`<${tag}>${items.join('')}</${tag}>`)
      continue
    }

    paragraph.push(line)
    i += 1
  }

  flushParagraph()
  return out.join('')
}

const CARET_HTML = '<span class="md-caret" aria-hidden="true"></span>'

/**
 * 给"正在流式输出"的答案末尾加一个闪烁光标。
 *
 * 为什么不直接在容器上用 ::after：容器里全是块级子元素（p / ul / pre），
 * ::after 会自成一行，看起来像一条孤零零的短横线，而不是"正在输入"。
 * 插到最后一个段落**内部**才会紧跟最后一个字。
 *
 * 只在以 `</p>` 结尾时才精确插入；以列表或代码块结尾时退化成追加在末尾，
 * 这种情况下光标另起一行是可接受的（流式过程中出现的概率很低）。
 */
export function attachCaret(html) {
  if (!html) return CARET_HTML
  if (html.endsWith('</p>')) return `${html.slice(0, -4)}${CARET_HTML}</p>`
  return html + CARET_HTML
}

/**
 * 带缓存的版本。
 *
 * 为什么需要：流式输出时每来一个 delta 都会重渲染整个消息列表，
 * 逐条重跑正则的话，历史越长每帧的开销越大（50 条消息 × 每个 token）。
 * 按原文做键可以让没变过的历史消息直接命中，代价只是一个 Map。
 */
const cache = new Map()
const CACHE_LIMIT = 300

export function renderMarkdownCached(source) {
  const key = String(source ?? '')
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const html = renderMarkdown(key)
  if (cache.size >= CACHE_LIMIT) {
    // 简单的 FIFO 淘汰：Map 保持插入顺序，删最早的一个即可
    const oldest = cache.keys().next().value
    cache.delete(oldest)
  }
  cache.set(key, html)
  return html
}

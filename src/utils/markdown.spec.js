import { describe, expect, it } from 'vitest'
import {
  attachCaret,
  escapeHtml,
  renderMarkdown,
  renderMarkdownCached,
  safeUrl,
} from './markdown.js'

/**
 * 这个文件的重点有两块：
 *   1. 渲染结果对不对（重构前完全不渲染，答案里的 ** 和 - 会原样露出来）
 *   2. 渲染是不是**安全**的 —— 输出会交给 v-html，
 *      所以每一条 XSS 用例都必须证明"标签是转义后的文本，而不是真的标签"。
 */

describe('escapeHtml', () => {
  it('把五个 HTML 元字符全部转成实体', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;')
  })

  it('null / undefined 退化成空串而不是 "null"', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })
})

describe('safeUrl', () => {
  it('放行 http / https / mailto / 站内相对地址', () => {
    expect(safeUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(safeUrl('http://127.0.0.1:8000/docs')).toBe('http://127.0.0.1:8000/docs')
    expect(safeUrl('mailto:support@example.com')).toBe('mailto:support@example.com')
    expect(safeUrl('/kb/1')).toBe('/kb/1')
    expect(safeUrl('#faq')).toBe('#faq')
  })

  it('挡掉 javascript: / data: / vbscript: 伪协议', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull()
    expect(safeUrl('JaVaScRiPt:alert(1)')).toBeNull()
    expect(safeUrl('data:text/html;base64,PHNjcmlwdD4=')).toBeNull()
    expect(safeUrl('vbscript:msgbox(1)')).toBeNull()
  })

  it('挡掉用控制字符/空白绕过协议检测的写法', () => {
    // 浏览器会忽略这些字符，`java\tscript:` 仍然会被当成 javascript 执行
    expect(safeUrl('java\tscript:alert(1)')).toBeNull()
    expect(safeUrl('java\nscript:alert(1)')).toBeNull()
    expect(safeUrl('\u0001javascript:alert(1)')).toBeNull()
    expect(safeUrl('  javascript:alert(1)  ')).toBeNull()
  })
})

describe('renderMarkdown 的块级语法', () => {
  it('普通段落包进 <p>，单个换行当软换行', () => {
    expect(renderMarkdown('第一行\n第二行')).toBe('<p>第一行<br>第二行</p>')
  })

  it('空行切分段落', () => {
    expect(renderMarkdown('甲\n\n乙')).toBe('<p>甲</p><p>乙</p>')
  })

  it('一到六级标题', () => {
    expect(renderMarkdown('# 一级')).toBe('<h1>一级</h1>')
    expect(renderMarkdown('### 三级')).toBe('<h3>三级</h3>')
    expect(renderMarkdown('####### 七个井号不算标题')).toBe('<p>####### 七个井号不算标题</p>')
  })

  it('无序列表与有序列表分块渲染', () => {
    expect(renderMarkdown('- 甲\n- 乙')).toBe('<ul><li>甲</li><li>乙</li></ul>')
    expect(renderMarkdown('1. 甲\n2. 乙')).toBe('<ol><li>甲</li><li>乙</li></ol>')
  })

  it('分隔线不会被当成列表项', () => {
    expect(renderMarkdown('---')).toBe('<hr>')
    expect(renderMarkdown('- - -')).toBe('<hr>')
    expect(renderMarkdown('- 这一条是列表')).toBe('<ul><li>这一条是列表</li></ul>')
  })

  it('引用块内部会递归渲染，列表也能出来', () => {
    expect(renderMarkdown('> 提示')).toBe('<blockquote><p>提示</p></blockquote>')
    expect(renderMarkdown('> - 甲\n> - 乙')).toBe(
      '<blockquote><ul><li>甲</li><li>乙</li></ul></blockquote>',
    )
  })

  it('围栏代码块带语言标记，内部内容原样保留', () => {
    const out = renderMarkdown(['```js', 'const a = 1;', '```'].join('\n'))
    expect(out).toBe('<pre><code class="language-js">const a = 1;</code></pre>')
  })

  it('流式输出时还没收到收尾围栏，也要当成代码块闭合（否则用户会看到裸露的 ```）', () => {
    const out = renderMarkdown(['```', '只到一半的内容'].join('\n'))
    expect(out).toBe('<pre><code>只到一半的内容</code></pre>')
  })

  it('空白输入返回空串，不产生空 <p>', () => {
    expect(renderMarkdown('')).toBe('')
    expect(renderMarkdown('   \n  \n')).toBe('')
  })
})

describe('renderMarkdown 的行内语法', () => {
  it('加粗、斜体、删除线', () => {
    expect(renderMarkdown('**粗**')).toBe('<p><strong>粗</strong></p>')
    expect(renderMarkdown('__粗__')).toBe('<p><strong>粗</strong></p>')
    expect(renderMarkdown('*斜*')).toBe('<p><em>斜</em></p>')
    expect(renderMarkdown('~~删~~')).toBe('<p><del>删</del></p>')
  })

  it('加粗优先于斜体，**x** 不会被拆成两个 <em>', () => {
    expect(renderMarkdown('**x**')).toBe('<p><strong>x</strong></p>')
    expect(renderMarkdown('**x**')).not.toContain('<em>')
  })

  it('行内代码里的星号保持字面量，不被当成强调', () => {
    expect(renderMarkdown('`**不该加粗**`')).toBe('<p><code>**不该加粗**</code></p>')
  })

  it('链接带 target/rel，站外跳转不留 window.opener', () => {
    expect(renderMarkdown('[文档](https://example.com)')).toBe(
      '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">文档</a></p>',
    )
  })

  it('裸地址自动成链', () => {
    expect(renderMarkdown('见 https://example.com/a 说明')).toBe(
      '<p>见 <a href="https://example.com/a" target="_blank" rel="noopener noreferrer">https://example.com/a</a> 说明</p>',
    )
  })

  it('不可信的链接退化成纯文本，而不是生成 <a>', () => {
    const out = renderMarkdown('[点我](javascript:alert(1))')
    expect(out).not.toContain('<a')
    expect(out).toContain('javascript:alert(1)')
  })
})

describe('renderMarkdown 的 XSS 防护', () => {
  it('script 标签被转义成文本', () => {
    const html = renderMarkdown('<script>alert(1)</script>')
    expect(html).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
    expect(html).not.toContain('<script')
  })

  it('带事件处理器的 img 被转义成文本', () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  it('代码块里的 HTML 也被转义（后端文档里贴标签是常见情况）', () => {
    const html = renderMarkdown(['```html', '<script>alert(1)</script>', '```'].join('\n'))
    expect(html).toBe(
      '<pre><code class="language-html">&lt;script&gt;alert(1)&lt;/script&gt;</code></pre>',
    )
    expect(html).not.toContain('<script')
  })

  it('链接地址里的引号无法闭合 href 属性', () => {
    const html = renderMarkdown('[x](https://example.com/"onmouseover="alert(1))')
    // 引号必须以实体形式出现，浏览器解析属性时不会被它提前结束
    expect(html).not.toMatch(/href="[^"]*"\s*onmouseover/)
    expect(html).toContain('&quot;')
  })

  it('用实体伪装的 javascript: 协议同样被拒', () => {
    const html = renderMarkdown('[x](java&#115;cript:alert(1))')
    expect(html).not.toContain('<a')
  })

  it('整段输出里不存在任何来自输入的裸标签', () => {
    const nasty = [
      '<svg onload=alert(1)>',
      '<iframe src=javascript:alert(1)>',
      '<a href="x">y</a>',
    ].join('\n\n')
    const html = renderMarkdown(nasty)
    for (const tag of ['<svg', '<iframe', '<a ']) {
      expect(html).not.toContain(tag)
    }
  })
})

describe('attachCaret', () => {
  it('插到最后一个段落内部，而不是另起一行', () => {
    expect(attachCaret('<p>正在写</p>')).toBe(
      '<p>正在写<span class="md-caret" aria-hidden="true"></span></p>',
    )
  })

  it('空内容也要给出光标（刚发起请求、一个字都还没吐）', () => {
    expect(attachCaret('')).toBe('<span class="md-caret" aria-hidden="true"></span>')
  })

  it('以代码块/列表结尾时退化成追加在末尾，不能插错位置', () => {
    const pre = '<pre><code>x</code></pre>'
    expect(attachCaret(pre)).toBe(`${pre}<span class="md-caret" aria-hidden="true"></span>`)
  })
})

describe('renderMarkdownCached', () => {
  it('结果与不缓存的版本一致，包括重复调用', () => {
    const samples = [
      '**粗** 和 `代码`',
      ['- 甲', '- 乙'].join('\n'),
      ['```', 'x < y', '```'].join('\n'),
      '[a](javascript:alert(1))',
    ]
    for (const s of samples) {
      expect(renderMarkdownCached(s)).toBe(renderMarkdown(s))
      expect(renderMarkdownCached(s)).toBe(renderMarkdownCached(s))
    }
  })
})

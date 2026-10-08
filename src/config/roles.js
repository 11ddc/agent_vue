/**
 * 角色预设。
 *
 * ⚠️ 一个必须说清楚的限制，不要被界面误导：
 * **角色目前只是前端预设，不影响后端行为。**
 * 后端 `POST /api/chat` 的请求模型（my-agent-api/api/chat.py 里的 `ChatRequest`）
 * 只有 `question` 和 `session_id` 两个字段。pydantic 默认会**静默忽略**多余字段，
 * 所以把 role 一起发过去既不会 422、也不会有任何效果——那是自欺欺人。
 * 因此这里不发送任何额外字段。切换角色只改变：欢迎语、引导问题、头像图标、占位文案。
 * 想让"客服小优"真的切换成另一套人设，需要后端加 `system_prompt` / `persona` 参数。
 *
 * 切换角色会顺带 `chat.reset()`（换掉 session_id）：后端的历史是按 session_id
 * 存在 Redis 里的，不换 id 的话新角色的开场白会和旧角色的上下文混在一起。
 */

export const DEFAULT_ROLE_ID = 'general'

export const ROLES = [
  {
    id: 'general',
    name: '通用助手',
    icon: 'sparkles',
    tagline: '日常问答、写作、解释概念',
    welcome:
      '你好，我是你的 AI 助手 👋\n\n可以直接提问，也可以上传文档到知识库，让我基于资料回答。',
    placeholder: '问点什么…（Enter 发送，Shift+Enter 换行）',
    // 通用角色刻意不引用任何产品事实，避免出现后端知识库里根本没有的说法
    suggestions: [
      '用通俗的话解释一下什么是 RAG',
      '帮我把这段话改得更简洁：我们这边的话是说，大概下周左右可以给您安排上门。',
      '把「用户下单到收货」拆成 5 个步骤',
      '列一个给新同事讲解产品架构的提纲',
    ],
  },
  {
    id: 'service',
    name: '客服小优',
    icon: 'headset',
    tagline: '产品参数、故障排查、安装售后',
    welcome:
      '您好！我是智能客服小优 👋\n\n我可以帮您查产品参数、排查设备故障、了解安装与售后政策。也可以直接上传文档到知识库，我会基于新上传的资料回答。',
    placeholder: '描述您遇到的问题…（Enter 发送，Shift+Enter 换行）',
    /*
     * 这 4 条是**逐条核对过知识库原文**的，不是随手编的。
     * 出处：
     *   1 电池   常见问题FAQ.md   "岚盾 L1 Pro 电池容量为 8000mAh，支持 Type-C 应急供电。"
     *   2 天地钩 常见问题FAQ.md   "支持天地钩的型号为 L1 Pro 与 L2 Pro…（孔距 60mm）"
     *   3 上门   客服话术模板.txt "市区 24 小时内响应，郊区 48 小时内响应，L1 Pro 免上门费。"
     *   4 保修   常见问题FAQ.md + 客服话术模板.txt  L1 24 个月 / L1 Pro 36 个月
     *
     * 为什么不用"云枢S3 Pro 支持哪些连接协议？"这类问法（第一版就是这么写的，是错的）：
     * 该手册原文只说"支持 WiFi 与蓝牙"，没有"协议"这个词；而云枢S3 有 9 个型号变体，
     * 云枢S3 Pro 在 3366 个块里只占 8 块。这种问法同时踩中后端 eval 里
     * 最弱的两个桶——口语改写（同义不同词）和跨文档近似条目——命中率很低。
     */
    suggestions: [
      '岚盾 L1 Pro 电池容量多大？支持应急供电吗？',
      '天地钩支持哪些型号，安装孔距是多少？',
      '上门安装多久响应？要收上门费吗？',
      '岚盾 L1 和 L1 Pro 的保修期分别是多久？',
    ],
  },
  {
    id: 'docs',
    name: '文档问答',
    icon: 'bookOpen',
    tagline: '只依据你上传的资料回答',
    welcome:
      '把文档上传到知识库，然后直接提问。\n\n我会尽量只依据资料内容回答；资料里没有的，我会说明找不到依据。',
    placeholder: '就上传的资料提问…（Enter 发送，Shift+Enter 换行）',
    // 与客服角色用同一组已核对过出处的问句——它们本来就是"知识库里确实有明确事实句"的那些
    suggestions: [
      '岚盾 L1 Pro 电池容量多大？支持应急供电吗？',
      '天地钩支持哪些型号，安装孔距是多少？',
      '上门安装多久响应？要收上门费吗？',
      '岚盾 L1 和 L1 Pro 的保修期分别是多久？',
    ],
  },
]

/** 未知 id 一律回落到第一个角色，避免 localStorage 里存了脏值导致界面空白 */
export function getRole(id) {
  return ROLES.find((role) => role.id === id) || ROLES[0]
}

export const ROLE_IDS = ROLES.map((role) => role.id)

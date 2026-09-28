/**
 * AI 写真主题库（UGC 人像）
 * ==================================================================
 * 2026-09-28 v2：王要 X 帖子榜单里的爆款进类目 —— 在「职场形象 +
 * 证件照」基础上新增：怀旧合影（拥抱年轻的自己，X 爆款）、全身棚拍
 * （影棚全身杂志大片）、九宫格（3×3 九种姿态，身份严格一致）。
 * 豪车大片王说不要，已删。实现一律走 image 2.5。
 *
 * 每条 prompt 第一句都是身份锁定 —— X 爆款全死在这条上，不许动。
 *
 * 主题卡带样片：`sample` 是本地打包的 JPG（package-portrait/assets/portrait-samples/，
 * 由 _portrait/gen-samples.mjs 按 `SAMPLE_PROMPT` 生成并压缩到 192x288）。
 * 批量生成样片前必须先跟王确认数量和成本。
 */
import sampleBusiness from '../assets/portrait-samples/sample-business.jpg'
import sampleIdPhoto from '../assets/portrait-samples/sample-id-photo.jpg'
import sampleNostalgicHug from '../assets/portrait-samples/sample-nostalgic-hug.jpg'
import sampleStudioFull from '../assets/portrait-samples/sample-studio-full.jpg'
import sampleNineGrid from '../assets/portrait-samples/sample-nine-grid.jpg'

export type PortraitThemeOption = {
  /** 选项 key，如 'outfit' */
  key: string
  /** 选项行标题，如 '服装' */
  label: string
  /** 可选值 */
  choices: { value: string; label: string }[]
  /** 默认值（choices 里某项的 value） */
  default: string
}

export type PortraitTheme = {
  /** 写进资产库的 templateId：`ai-portrait-{id}` */
  id: string
  /** 主题卡上的名字 */
  name: string
  /** 主题卡上的补充说明 */
  desc: string
  /** 锁定的完整提示词：图一 = 用户自拍（身份必须原样保留） */
  prompt: string
  /** 主题卡样片（本地打包图）。生成前为 undefined，页面做文字兜底。 */
  sample?: string
  /**
   * 选中该主题时的上传提示（可选）。不填就用默认文案。
   * 比如怀旧合影必须讲清楚：上传现在的照片，不是小时候的。
   */
  uploadHint?: string
  /**
   * 主题可选项（如证件照的服装/领带）。不填 = 无选项。
   * 填了就必须配 buildPrompt，用选项值动态拼提示词。
   */
  options?: PortraitThemeOption[]
  /** 有 options 时用它拼最终提示词；无 options 的主题忽略它。 */
  buildPrompt?: (selections: Record<string, string>) => string
  /**
   * 四宫格选格（目前仅证件照）。填了表示：一次生成一张 2×2 四宫格，
   * 结果页让用户选一格，再按该格表情生成全分辨率单张。
   * 必须配 buildSinglePrompt。
   */
  gridPick?: { cells: PortraitGridCell[] }
  /**
   * 选格放大的单张提示词：selections = 生成四宫格时的选项，
   * cellIndex = 用户选的格子（0=左上、1=右上、2=左下、3=右下）。
   * 调用时传两张输入图：第一张 = 用户自拍（身份基准），
   * 第二张 = 四宫格原图（编号选格基准），提示词里按"第 N 张图"引用。
   */
  buildSinglePrompt?: (selections: Record<string, string>, cellIndex: number) => string
}

/** 取某主题某选项的默认值。 */
export function defaultThemeOptions(theme: PortraitTheme): Record<string, string> {
  const out: Record<string, string> = {}
  for (const opt of theme.options ?? []) out[opt.key] = opt.default
  return out
}

/**
 * 四宫格选格：一张图里 2×2 四种表情，用户选一格再放大。
 * cells 顺序固定 = 左上、右上、左下、右下，提示词里写死对应关系，
 * 选格和单张生成的表情映射才不会错位。
 */
export type PortraitGridCell = {
  /** 格子名，如 '淡笑'（显示在选格按钮上） */
  label: string
  /** 该格的表情描述，拼进单张生成的提示词 */
  expression: string
}

/**
 * prompt 骨架：
 *   1. 身份锁定句 —— 不许动，实测链路（试穿）证明模型听这句。
 *   2. 主题场景 —— 把人放进哪里。
 *   3. 质感约束 —— 写实打底，拒绝 AI 塑料感。
 *   4. 禁止项 —— 不改脸、不加字。
 */
function portraitPrompt(scene: string, detail: string, framing = '半身构图'): string {
  return [
    '保持第一张图中人物的面部特征（脸型、五官、表情神态）和发型完全不变，身份一致性优先。',
    scene,
    `写实人像摄影，${detail}，${framing}，自然光影，皮肤质感真实，不要有 AI 塑料感。`,
    '不要改变人物的脸，不要添加任何文字和水印。'
  ].join('\n')
}

export const PORTRAIT_THEMES: PortraitTheme[] = [
  {
    id: 'business',
    name: '职场形象',
    desc: '影棚商务照 · 简历头像',
    sample: sampleBusiness,
    prompt: portraitPrompt(
      '人物换上剪裁得体的深色西装（女性为职业套装），站在浅灰色影棚背景前，专业商务形象照。',
      '伦勃朗布光，眼神自信，领带 / 丝巾细节精致，可做简历和职业社交头像'
    )
  },
  {
    id: 'id-photo',
    name: '证件照',
    desc: '免冠正装 · 标准白底',
    sample: sampleIdPhoto,
    options: [
      {
        key: 'outfit',
        label: '服装',
        choices: [
          { value: 'suit', label: '西装' },
          { value: 'shirt', label: '衬衫' }
        ],
        default: 'suit'
      },
      {
        key: 'tie',
        label: '领带',
        choices: [
          { value: 'no', label: '无领带' },
          { value: 'yes', label: '有领带' }
        ],
        default: 'no'
      }
    ],
    gridPick: {
      cells: [
        { label: '淡笑', expression: '嘴角微微上扬的淡笑，眼神自然' },
        { label: '微笑', expression: '自然亲切的微笑，微微露齿' },
        { label: '沉稳', expression: '沉稳自信，表情平和' },
        { label: '柔和', expression: '眼神温柔，表情放松亲和' }
      ]
    },
    buildPrompt: (sel) => {
      const outfit = sel.outfit === 'shirt'
        ? '着白色衬衫（不系领带，领口整洁）'
        : sel.tie === 'yes'
          ? '着深色西装，系深色领带'
          : '着深色西装（不系领带）'
      return [
        '保持第一张图中人物的面部特征（脸型、五官、表情神态）和发型完全不变，四格之间身份严格一致。',
        '重要：必须纠正原照片中头部的轻微倾斜和偏转。每格人物头部必须完全摆正：脸部正对镜头、双眼水平平视正前方、下巴端平、双耳对称可见、双肩水平端正，标准的正面免冠证件照姿态，绝不能歪头、侧脸或斜视。',
        `生成一张四宫格拼图（2 列 × 2 行）：同一人物的标准证件照，${outfit}，纯白色背景，影棚均匀布光，面部清晰无阴影。`,
        '四格表情各不相同：左上格嘴角微微上扬的淡笑，右上格自然亲切的微笑（微微露齿），左下格沉稳自信、表情平和，右下格眼神温柔、表情放松亲和。',
        '每个格子的左上角用白色小字清晰标注编号：左上格标"1"，右上格标"2"，左下格标"3"，右下格标"4"，编号不要遮挡面部。',
        '每格都是标准证件照构图：人物正面端坐、双肩端正，头部占所在格约三分之二。',
        '写实摄影，皮肤细腻干净、保留真实肤质纹理、不过度磨皮，不要有 AI 塑料感。',
        '不要改变人物的脸，除了四个编号外不要添加任何其他文字和水印。'
      ].join('\n')
    },
    buildSinglePrompt: (sel, cellIndex) => {
      const outfit = sel.outfit === 'shirt'
        ? '着白色衬衫（不系领带，领口整洁）'
        : sel.tie === 'yes'
          ? '着深色西装，系深色领带'
          : '着深色西装（不系领带）'
      const cells = [
        '嘴角微微上扬的淡笑，眼神自然',
        '自然亲切的微笑，微微露齿',
        '沉稳自信，表情平和',
        '眼神温柔，表情放松亲和'
      ]
      const num = cellIndex + 1
      const expression = cells[cellIndex] ?? cells[0]
      return [
        '以第二张图为表情参考：这是一张四宫格证件照拼图，每个格子左上角标有白色编号。',
        `只取编号为"${num}"的格子（${expression}），完整还原这个格子里人物的表情和神态，忽略其他三个格子，忽略编号数字本身。`,
        '以第一张图的人物为身份基准：脸型、五官、发型完全不变。',
        '生成一张完整的标准证件照单图：人物头部完全摆正，脸部正对镜头、双眼水平平视正前方、下巴端平、双耳对称可见、双肩水平端正，绝不能歪头、侧脸或斜视。',
        `人物正面端坐、双肩端正，${outfit}。纯白色背景，影棚均匀布光，面部清晰无阴影，头部占画面约三分之二的标准证件照构图。`,
        '写实摄影，皮肤细腻干净、保留真实肤质纹理、不过度磨皮，不要有 AI 塑料感。',
        '不要改变人物的脸，不要在画面中出现任何数字、文字和水印，不要生成拼图，只要单张。'
      ].join('\n')
    },
    prompt: [
      '保持第一张图中人物的面部特征（脸型、五官、表情神态）和发型完全不变，四格之间身份严格一致。',
      '重要：必须纠正原照片中头部的轻微倾斜和偏转。每格人物头部必须完全摆正：脸部正对镜头、双眼水平平视正前方、下巴端平、双耳对称可见、双肩水平端正，标准的正面免冠证件照姿态，绝不能歪头、侧脸或斜视。',
      '生成一张四宫格拼图（2 列 × 2 行）：同一人物的标准证件照，着深色西装（不系领带），纯白色背景，影棚均匀布光，面部清晰无阴影。',
      '四格表情各不相同：左上格嘴角微微上扬的淡笑，右上格自然亲切的微笑（微微露齿），左下格沉稳自信、表情平和，右下格眼神温柔、表情放松亲和。',
      '每个格子的左上角用白色小字清晰标注编号：左上格标"1"，右上格标"2"，左下格标"3"，右下格标"4"，编号不要遮挡面部。',
      '每格都是标准证件照构图：人物正面端坐、双肩端正，头部占所在格约三分之二。',
      '写实摄影，皮肤细腻干净、保留真实肤质纹理、不过度磨皮，不要有 AI 塑料感。',
      '不要改变人物的脸，除了四个编号外不要添加任何其他文字和水印。'
    ].join('\n')
  },
  {
    id: 'nostalgic-hug',
    name: '怀旧合影',
    desc: '宝丽来 · 拥抱年轻的自己',
    sample: sampleNostalgicHug,
    uploadHint: '上传现在的照片，AI 会生成你拥抱年轻自己的合影',
    prompt: portraitPrompt(
      '生成一张复古宝丽来拍立得风格的合影：现在的你正拥抱着年轻时的自己（同一张脸、约二十岁的版本），两人并肩微笑，温馨动人。',
      '做旧胶片质感、拍立得白边相纸、轻微褪色和漏光，仿佛一张珍藏多年的老照片',
      '拍立得方形相纸构图'
    )
  },
  {
    id: 'studio-full',
    name: '全身棚拍',
    desc: '影棚全身 · 杂志大片',
    sample: sampleStudioFull,
    prompt: portraitPrompt(
      '影棚全身人像：浅灰无缝背景，人物全身入镜，时尚穿搭（米色风衣或简约连衣裙），专业摄影灯布光。',
      '杂志大片质感，姿态自然舒展',
      '全身构图'
    )
  },
  {
    id: 'nine-grid',
    name: '九宫格',
    desc: '九种姿态 · 一次成图',
    sample: sampleNineGrid,
    prompt: [
      '保持第一张图中人物的面部特征（脸型、五官、表情神态）和发型完全不变，九格之间身份严格一致。',
      '生成一张竖构图九宫格拼图（3 列 × 3 行）：同一个人演绎九种不同姿态和表情（微笑、沉思、大笑、侧脸、托腮、回眸……），每格服装和背景色略有变化。',
      '社交媒体九宫格大片，写实摄影，皮肤质感真实，不要有 AI 塑料感。',
      '不要改变人物的脸，不要添加任何文字和水印。'
    ].join('\n')
  }
]

export function portraitThemeById(id: string): PortraitTheme | undefined {
  return PORTRAIT_THEMES.find((theme) => theme.id === id)
}

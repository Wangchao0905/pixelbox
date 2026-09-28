import { media } from './media'

import gelato from '@/assets/product-gelato-reference.jpg'
import tennisBag from '@/assets/product-tennis-bag-reference.jpg'
import soda from '@/assets/product-soda-condensation-reference.jpg'
import vitaminLemon from '@/assets/product-vitamin-lemon-reference.jpg'
import herbalBasket from '@/assets/product-herbal-basket-reference.jpg'
import blueMist from '@/assets/product-blue-mist-reference.jpg'
import skincarePortrait from '@/assets/product-skincare-portrait-reference.jpg'
import perfumeCherry from '@/assets/product-perfume-cherry-reference.jpg'
// 「收据拼贴」的封面。2026-09-26 由模型出图后压缩到 640x960（正好 2:3，零裁切）。
// 2:3 与首页轮播卡 .hd-card 的比例一致 —— 选 2:3 而不是兄弟模板的 3:4，
// 就是为了让它在轮播里**不被裁**。
import productReceiptCollage from '@/assets/product-receipt-collage-reference.jpg'
// 「一键抠图」的封面：真实链路实测产物 —— 上传产品图 → background=transparent 抠图，
// 输出的透明 PNG 落在深空底上。封面即功能演示，不是装饰图。
import avatarCapsuleEye from '@/assets/avatar-capsule-eye.jpg'
// 「圆钝 IP 形象」的封面。由 _tools/make-ip-logo-cover.py 确定性渲染，**不是**远程图床图，
// 也**不是**模型出图 —— 它是照同一套方法论手工排的版式稿（三色 / 圆钝大形体 / 左下涌现），
// 能证明这套方法论排得出来，**不能**证明模型按提示词出图的效果。这两件事别混。
import avatarSoftIpMascot from '@/assets/avatar-soft-ip-mascot.jpg'
// 「纸域微景」的封面。由 _tools/make-poster-mock.py 确定性渲染，**不是**远程图床图：
// 本地打包图零 404 风险（图床删图是静默的），且这张图本身就是该模板的效果图。
import posterPaperField from '@/assets/poster-paper-field.jpg'
// 「食感成字」的封面。同样由 _tools/make-food-poster.py 确定性渲染
// （底图是从网页下载的真实食物照片，排版与「卷曲」变形由脚本算出来）。
import posterFoodType from '@/assets/poster-food-type.jpg'
// 「镜头语言」两件套的封面。由 _tools/make-camera-posters.py 确定性渲染，
// 底图是从网页下载的真实照片（Pexels），见 _tools/assets/ 与脚本头部注释。
//
// ⚠️ 2026-09-26：原来是**三件套**（浅景分离 / 俯拍平铺 / 手机直出）。
//    王指出「手机直出」他从没要求设计过 ⇒ 第 15 个方向 `phone-candid` 已整个删除，
//    封面 `poster-phone-candid.jpg` 也不再打包（省 112.3 KB）。
//    生成脚本 `_tools/make-camera-posters.py` 还在，但它产出的手机直出那张**已无人 import**。
import posterShallowDof from '@/assets/poster-shallow-dof.jpg'
import posterOverheadFlatlay from '@/assets/poster-overhead-flatlay.jpg'
// 「异变主体」的封面。由 _tools/make-anomaly-poster.py 确定性渲染：
// 底图是从 Pexels 下的真照片（一支铅笔），抠像后放到纯粉底上，
// 再对整幅画面做**一处**水平切段错位。本地打包图 ⇒ 零 404 风险。
import posterAnomalySubject from '@/assets/poster-anomaly-subject.jpg'

/**
 * 提示词模板 / 海报方向 / 产品替换模板
 * ------------------------------------------------------------------
 * 内容与 work/visual-studio/src/prompt-templates.ts 保持一致，
 * 仅把封面图改成小程序可用的形式：
 *  - 本地产品参考图 → 打包进小程序（已压缩到 640px，控制主包体积）
 *  - 远程封面图     → 经过 media() 映射，便于整体切到自有 CDN
 */

export type PromptTemplateField = { key: string; label: string; required?: boolean }

export type PosterDirection = {
  id: string
  name: string
  description: string
  skill: string
  ratio: string
  cover: string
  accent: string
  system: string
  negative: string
}

/**
 * 「锁定提示词」模板的共同形状
 * ------------------------------------------------------------------
 * 产品替换与头像共用同一个形状：提示词完全由模板决定，用户唯一能做的是
 * 上传一张图。**别各写一份** —— 两处的字段一旦漂移，页面里读
 * `template.prompt` 的地方会**静默**拿到 `undefined`：请求照发、图照出，
 * 只是提示词是空的，而且不报错。
 */
export type LockedPromptTemplate = {
  id: string
  name: string
  description: string
  skill: string
  ratio: string
  cover: string
  accent: string
  prompt: string
  negative: string
}

/**
 * 「产品替换」页的**逐模板文案覆盖**（全部可选）。
 * ------------------------------------------------------------------
 * 为什么需要它：`create-product` 的正文是写给「换掉画面里的产品主体」那类
 * 模板的，但模板表里出现了行为不同的条目 —— 「收据拼贴」的输入是一张
 * **照片**、输出是「照片 + 热敏收据」，页面上说「只替换画面中的产品主体」
 * 就是错的，而且错得**没有任何东西会报警**。
 *
 * ⚠️ 不填 = 用 `create-product` 里的默认文案。那套默认**就是**改造前的原文、
 *    逐字保留，所以另外 13 个产品模板看到的一个字都没变。
 * ⚠️ 字段是**扁平的可选字符串**，刻意不做成嵌套对象：
 *    `check-prompt-mirror.mjs` 的解析器是「从 `{ id: …` lazy 匹配到**第一个**
 *    `}`」，嵌套对象的 `}` 会把 body 截断在中间 —— 排在它后面的字段
 *    （例如 `negative`）会被**静默**读成 `undefined`，两边都 undefined 就
 *    「一致」了，判据静默失效。扁平字段没有内层 `}`，不会踩这个坑。
 * ⚠️ 字段名不能和 `FIELDS` 里已有的撞（name / description / skill / ratio /
 *    inputMode / prompt / system / negative）—— 解析器是扁平取值的，撞名会
 *    覆盖真字段，而且同样是**静默**的。
 */
export type ProductPageCopyOverride = {
  /** h1 第一行（默认「上传产品，」） */
  pageHeadline?: string
  /** h1 第二行，accent 色（默认「直接生成。」） */
  pageHeadlineAccent?: string
  /** h1 下方那段说明（默认「模板会自动保留场景、光线和构图，只替换画面中的产品主体。」） */
  pageCopy?: string
  /** 上传区 eyebrow（默认「YOUR PRODUCT」） */
  uploadEyebrow?: string
  /** 上传区标题（默认「上传你的产品」） */
  uploadTitle?: string
  /** 上传槽 label（默认「上传产品」） */
  uploadLabel?: string
  /** 上传槽下方提示（默认「建议使用正面、清晰、背景干净的产品图」） */
  uploadHint?: string
  /** 没传图就点生成时的报错（默认「请先上传产品图片」） */
  uploadError?: string
}

/** 产品替换：场景已锁定，把画面主体换成用户上传的产品 */
export type ProductReplacementTemplate = LockedPromptTemplate &
  ProductPageCopyOverride & {
    /**
     * 透明背景开关：只有「一键抠图」填 'transparent'。
     * create-product 页会把它透传给 editImages → 服务端 → 上游 background 参数。
     * 不填 = 走默认不透明链路，别手滑给别的模板加。
     */
    background?: 'transparent'
  }

/**
 * 头像模板
 * ------------------------------------------------------------------
 * 与「产品替换」共用 `LockedPromptTemplate` 的字段，但**多两处刻意的差异**：
 *
 * ① `inputMode` —— 这个模板要用户交什么。
 *    · `'photo'`：必须上传一张参考图，模板在它上面重绘（「胶囊眼睛头像」）。
 *      走 `editImages()`，参考图先上传换成 fileId。
 *    · `'text'` ：**不需要任何输入图**，模板直接文生图（「圆钝 IP 形象」）。
 *      走 `generateImages()`。
 *    两种模式调的是**两个不同的接口**，所以这个字段不是「文案开关」：
 *    写错了会让页面把一个空 `images` 数组发给 `editImages`，而它只在
 *    非 mock 分支里抛「请先上传产品图片」—— mock 模式下**照常出图、不报错**。
 *    必须显式声明，不给默认值：将来新增头像模板时，作者被迫想一次「这个要不要参考图」。
 *
 * ② `negative` 变成**可选** —— 这是照 `ip-as-logo` 方法论的硬要求，不是手滑。
 *    该方法论按模型能力分两条路：现代指令型模型（本项目用的就是这一类）
 *    把排除项写成主提示词里的「[约束]」一节，并**明确禁止**再单独给一份负面提示词；
 *    只有老的、显式暴露 `negative_prompt` 参数的运行时才走单独通道。
 *    本项目的 `negative` 会被**拼进同一个 prompt 字段**，所以对文生图模板来说
 *    两份排除项会重复 —— 于是 `'text'` 模板不给 `negative`，页面也不拼。
 *    ⚠️ 页面里那句拼接必须写成「有才拼」，别写成 `${prompt}\n\n${negative}` ——
 *       后者对 `undefined` 会拼出字面量 `undefined` 四个字母，**不报错**。
 */
export type AvatarTemplate = Omit<LockedPromptTemplate, 'negative'> & {
  inputMode: 'photo' | 'text'
  /** 只有 `inputMode: 'photo'` 用得上（见上） */
  negative?: string
}

type PromptTemplate = {
  id: string
  fields: PromptTemplateField[]
  system: string
  negative: string
}

const productNegative =
  '保持用户上传产品的外观、比例、材质、包装文字与品牌标识准确；不得新增产品、乱码、水印、无关人物或改变产品结构。'

/**
 * 「收据拼贴」单独的负向提示词 —— **不继承** `productNegative`。
 * ------------------------------------------------------------------
 * 为什么不继承（2026-09-26 王定）：
 *   `productNegative` 是写给「把画面里的产品主体换掉」那类模板的，它把输入
 *   预设成一件**带包装的商品**：「保持用户上传**产品**的外观、比例、材质、
 *   **包装文字与品牌标识**准确」「不得…改变**产品结构**」「无关人物」。
 *   而「收据拼贴」的输入是一张**照片** —— prompt 第一句就是「使用提供的
 *   图像作为图像 A」，要的是照片被**全出血印出来**、文案从照片的主题/色彩/
 *   氛围生成。继承那套措辞会：
 *     ① 暗示模型去**编造包装文字与品牌标识**（照片里根本没有）；
 *     ② 「无关人物」与「照片里本来就有个人」直接冲突。
 *   这里只兜住这条模板**真的会**踩的失败模式：图像 A 被换掉、背景不是纯白、
 *   照片被加白边/宝丽来边、两张纸不等宽、回形针只夹住照片、照片反客为主。
 *
 * ⚠️ 它和 `productNegative` 都是裸标识符，两个文件的 `const` 必须**逐字一致**
 *    —— `check-prompt-mirror.mjs` 的 `constsOf()` 会把裸标识符还原出来比对。
 */
const receiptCollageNegative =
  '保持图像 A 的主体、场景、色彩与氛围准确，不得替换、臆造或新增其中内容；不得出现水印、乱码或额外品牌标识；背景必须为纯白 #FFFFFF，不得有纹理、渐变或灰调；照片须全出血、无白边与内框；两张纸张宽度一致，仅由单个回形针跨压重叠处，且照片尺寸保持从属。'

export const productReplacementTemplates: ProductReplacementTemplate[] = [
  /**
   * 「收据拼贴」—— 2026-09-26 王给的模板，替换掉原「石材工作室」。
   *
   * ⚠️ prompt 是**王给的原文，逐字照搬**，落地时没有做任何改写，
   *    连原文里的中文弯引号都原样保留。别为了「统一风格」把它改成
   *    直引号或直角引号 —— 弯引号是非 ASCII，塞进反引号字面量里
   *    本来就没有转义问题，改它只会让文案和原文悄悄漂开。
   *
   * ⚠️ 它是本数组里**唯一**用多行反引号字面量的条目（12 行、11 个换行），
   *    因为原文本身就是 12 段规格。字面量内部换行与文件一致用 CRLF，
   *    与 avatarTemplates 里的 capsule-eye-avatar 同例。
   *
   * ⚠️ 它排在数组**第一项** = 首页轮播「产品组第一张」（王指定）。
   *    位置是产品要求，不是随手放的，挪之前先问。
   *
   * 被替换掉的 stone-studio 已逐字备份到
   * _diag/retired-2026-09-26/stone-studio-entry.txt，可原样贴回。
   * 产品精选场景总数仍是 14 个。
   *
   * ⚠️ 它的 `negative` 与页面文案都**不继承产品链默认**（王 2026-09-26 定）：
   *    输入是照片而不是商品，见 `receiptCollageNegative` 与
   *    `ProductPageCopyOverride` 两处的注释。
   */
  { id: 'receipt-collage', name: '收据拼贴', description: '纯白背景、热敏收据与回形针夹照片', skill: 'EDITORIAL / COLLAGE', ratio: '2:3', cover: productReceiptCollage, accent: '#907860', prompt: `使用提供的图像作为图像 A，在完全纯白背景（#FFFFFF）上创作一幅当代社论构图。首先分析图像 A，并从其主题、场景、氛围、颜色和情感基调中生成所有文案，确保每个短语都与图像紧密相关，感觉专属而具体。
创作两件独立的物理纸质作品：一张暖白色热敏纸社论收据，以及一张图像 A 的全出血印刷照片。收据和照片必须具有完全相同的宽度。照片的整体尺寸必须明显更小：其高度仅约为收据高度的 65–70%，因此照片在视觉上感觉大约是热敏收据的三分之二大小，而不是成为主导物体。保持收据紧凑，宽度与高度比例约为 1:1.8–2.0，避免形成过长的超市收据形状。
将收据略微置于左侧，并将照片向右侧偏移，使这两张等宽纸张大幅重叠，同时在视觉上仍显得几乎并排。轻微旋转照片，大约 3–6 度，仿佛它是被手随意滑入位置。照片必须保持全出血，无白边、宝丽来式边距、内部边框或空白边缘。
使用一个大型逼真的银色回形针物理固定热敏收据和照片两者。回形针必须直接位于两张纸张重叠的区域上方，因此两张纸张都清晰可见地从同一回形针下方穿过。它绝不能显得仅附着在照片上。将回形针尺寸设为普通办公回形针的约 40% 大，并置于共享重叠区域的右上侧，略微歪斜且随意放置。
允许照片重叠并部分覆盖收据上的某些排版文字。有些字母可能消失在照片下方；这是有意为之，应强化物理分层构图效果。
使用明亮的高调定向照明，带有清晰、锐利边缘的硬阴影，置于两张纸张和金属回形针下方。保持整体曝光明亮、图形化和干净。
在热敏收据上设置排版。在顶部，放置一个小上下文标签，格式为“@ 单词”或“@ 短语”，从图像 A 生成，使用 EB Garamond Regular，字间距 0，左对齐。其下方，创作一个社论标题，由正好三个单词组成，使用 EB Garamond Regular 或 Medium，尺寸克制且左对齐。
标题下方，放置一个大型手写短语，使用 Google 字体“Whisper”作为手写字体。该短语必须极短，总计最多 10 个字符，包括空格和标点。从图像 A 的氛围或概念生成该短语。保持左对齐，并约为常规手写日志标题的 40% 大。保留 Whisper 标志性的松散、流动特征，同时添加细微的真实手写瑕疵，如轻微基线漂移、不规则间距、重复字母的小差异、压力变化、笔画厚度变化，以及淡淡的墨水密度变化，使其感觉像是物理手写而非完美数字排版。
直接在其下方，添加一个简短的两行支持性笔记，使用 Inter Regular 或 Medium，随后是“Vol. 01。”。在收据下部，添加一段紧凑的 45–60 字社论段落，使用美式打字机风格字体，字间距 0，左对齐并带有自然的参差右边缘。保持段落简洁，以免收据变得过长。
以靠近底部的水平条形码结束收据，并在下方添加一个非常小的图像特定档案代码。
衬线和支持性排版使用一种柔和的深中性色，而 Whisper 手写仅使用一种独立的克制强调色。
最终结果应立即被视为一套物理作品：一张紧凑的热敏收据和一张高度为其约三分之二的较短照片，两者宽度完全相同，横向偏移且随意重叠，用一个超大银色回形针清晰可见地绑定两张纸张。照片在整体尺寸上应保持从属地位，大约为收据高度的三分之二，而收据保留主要的垂直结构。构图应感觉触感十足、略带瑕疵、高调、锐利阴影且专业艺术指导。`, negative: receiptCollageNegative,
    pageHeadline: '上传照片，', pageHeadlineAccent: '拼成收据。',
    pageCopy: '模板会读取照片的主题、色彩与氛围，据此写收据上的全部文案，并把照片全出血印出、用回形针夹在收据上。',
    uploadEyebrow: 'YOUR PHOTO', uploadTitle: '上传你的照片', uploadLabel: '上传照片',
    uploadHint: '建议使用主题明确、光线充足、构图干净的照片', uploadError: '请先上传照片' },

  { id: 'gelato-overhead', name: '草莓冰淇淋俯拍', description: '金属备餐托盘、粉色甜品与新鲜草莓', skill: 'FOOD / OVERHEAD', ratio: '2:3', cover: gelato, accent: '#f29aa3', prompt: "Angled overhead shot of the user's uploaded product replacing the retro light-pink ice cream tub as the hero package on a stainless steel kitchen prep tray on concrete. Keep the editorial arrangement: a stainless steel bowl filled with scoops of pink strawberry gelato, a metal ice cream scoop, and fresh whole strawberries on the side. Crisp directional lighting, artisanal ice cream parlor aesthetic, rich creamy textures. Preserve the uploaded product's exact silhouette, materials, label placement and readable packaging; integrate it with realistic scale, contact shadows and reflections.", negative: productNegative },
  { id: 'tennis-bag', name: '网球包补给', description: '绿色球场、米白运动包与斜射球网影', skill: 'SPORT / LIFESTYLE', ratio: '2:3', cover: tennisBag, accent: '#b7ef65', prompt: '俯拍网球场地面，经典绿色球场与白色标线。一只亚裔女性的手正将用户上传的产品替换原画面中的红色盖子功能补剂饮品，并自然放进米白色帆布运动旅行包中，包口半开，露出一角干净白毛巾。保留人物手部动作、产品真实比例与包装细节，保持明亮清晰的网球场阳光、斜射球网影子，以及健康自律的现代都市运动生活方式。', negative: productNegative },
  { id: 'soda-macro', name: '冷凝气泡饮', description: '紫色背景、手持罐装饮料与高密度水珠', skill: 'BEVERAGE / MACRO', ratio: '2:3', cover: soda, accent: '#b9a5ed', prompt: "Close-up of a well-manicured young East Asian woman's hand holding the user's uploaded beverage product, replacing the original green soda can. Preserve a chilled surface covered in crisp water condensation, a solid light lavender background, clean commercial studio lighting, macro details of water droplets, vibrant pop colors and a refreshing beverage advertisement mood. Keep the uploaded product's exact silhouette, label, colors and readable packaging while matching realistic hand contact and scale.", negative: productNegative },
  { id: 'vitamin-lemon', name: '活力维生素', description: '粉蓝双色背景、柠檬切片与健康补给', skill: 'WELLNESS / COLOR POP', ratio: '2:3', cover: vitaminLemon, accent: '#83d8f2', prompt: "Commercial wellness product photography. Replace the central dark-blue vitamin bottle with the user's uploaded product while preserving the exact product silhouette, label hierarchy, packaging materials and readable text. Use a split pink and sky-blue background, freshly cut juicy yellow lemons, two scattered capsules and a bright translucent daylight studio effect. Saturated playful colors, crisp edges, realistic contact shadow and a vibrant healthy-energy mood.", negative: productNegative },
  { id: 'herbal-basket', name: '草本沐浴护理', description: '米黄收纳篮、无花果与法式自然松弛感', skill: 'BATH / LIFESTYLE', ratio: '2:3', cover: herbalBasket, accent: '#e6c982', prompt: '俯拍水泥质感地面，米黄色塑料收纳篮。将用户上传的沐浴露、身体乳或双瓶套装替换篮内原有的两瓶极简草本护理产品，保持产品真实比例、包装材质、标签层级与可读文字。篮旁点缀切开的新鲜无花果、毛线织物与木质刷子。使用强烈的夏日硬光，打出清晰利落的几何投影，呈现小红书法式自然松弛感与高级生活美学。', negative: productNegative },
  { id: 'blue-mist', name: '雾霾蓝保湿喷雾', description: '浅蓝渐变、白色纸雕花瓣与医美护肤感', skill: 'SKINCARE / CLINICAL', ratio: '2:3', cover: blueMist, accent: '#a9d9ff', prompt: '纯净浅蓝渐变背景，横向微仰拍。将用户上传的护肤喷雾、精华或瓶装产品替换原图中斜卧的雾霾蓝保湿喷雾瓶，保持产品真实轮廓、材质、泵头结构、标签层级与可读文字。四周点缀几片纯白色曲面纸雕花瓣，呈现流动飘逸感。使用纯净柔和的高光与微阴影，极度透气纯净的视觉，高级医美护肤调性。', negative: productNegative },
  { id: 'skincare-portrait', name: '笑颜持握修护膏', description: '暖米色人像、红色肩带与银色膏盒', skill: 'BEAUTY / PORTRAIT', ratio: '2:3', cover: skincarePortrait, accent: '#f0c5a5', prompt: "Commercial beauty skincare portrait. Replace the compact rounded silver tin balm container held toward the camera with the user's uploaded skincare product. Preserve the young East Asian woman's natural glowing skin, subtle freckles, joyful toothy smile, thin red strap top, hand pose, warm clean beige background, bright soft studio lighting and ultra-realistic skin texture. Keep the uploaded product's exact silhouette, material, label hierarchy and readable packaging, with realistic scale and hand contact.", negative: productNegative },
  { id: 'perfume-cherry', name: '樱桃冰晶香氛', description: '粉色背景、透明冰块与酒红香水瓶', skill: 'FRAGRANCE / STILL LIFE', ratio: '2:3', cover: perfumeCherry, accent: '#ef9cae', prompt: "Luxury perfume commercial still life. Replace the deep burgundy frosted rectangular perfume bottle with the user's uploaded fragrance product while preserving its exact silhouette, cap structure, material, label hierarchy and readable packaging. Keep the delicate balance on a fresh cherry atop a large crystal-clear ice cube with frozen pink cherry blossoms inside. Add glossy twin cherries with green stems beside the cube, solid soft blush-pink background, studio diffused side lighting, pristine glass reflections and a juicy fruity fragrance concept.", negative: productNegative },
  { id: 'court-morning', name: '晨光球场', description: '运动产品置于清晨网球场，轻盈自然', skill: 'SPORT / LIFESTYLE', ratio: '4:5', cover: media('https://images.unsplash.com/photo-1554068865-24cecd4e34b8?auto=format&fit=crop&w=900&q=84'), accent: '#b7ef65', prompt: '将用户上传的产品自然融入清晨网球场生活方式广告，绿色球网、斜向阳光、真实接触阴影，画面清爽有运动感。', negative: productNegative },
  { id: 'coastal-sun', name: '海岸日光', description: '蓝天、沙滩与明亮度假氛围', skill: 'TRAVEL / SUMMER', ratio: '9:16', cover: media('https://images.unsplash.com/photo-1515238152791-8216bfdf89a7?auto=format&fit=crop&w=900&q=84'), accent: '#88d8ef', prompt: '将用户上传的产品融入明亮海岸度假场景，蓝色天空、浅色沙滩、自然日光和轻微风感，保持产品清晰并适合移动端广告。', negative: productNegative },
  { id: 'soft-bath', name: '柔雾浴室', description: '温润水汽与米白瓷砖背景', skill: 'BEAUTY / CARE', ratio: '4:5', cover: media('https://images.unsplash.com/photo-1556228578-8c89e6adf883?auto=format&fit=crop&w=900&q=84'), accent: '#f3c2ad', prompt: '将用户上传的产品置于温润米白浴室，柔和晨雾、湿润瓷砖与干净高光，营造护肤品牌的安静高级感。', negative: productNegative },
  { id: 'night-counter', name: '夜间柜台', description: '深色空间与一束戏剧性光线', skill: 'NIGHT / CINEMA', ratio: '3:2', cover: media('https://images.unsplash.com/photo-1513506003901-1e6a229e2d15?auto=format&fit=crop&w=900&q=84'), accent: '#a493e8', prompt: '将用户上传的产品放置在深色夜间柜台，以单束聚光、柔和反射和克制的蓝紫色环境光塑造电影感产品广告。', negative: productNegative },
  { id: 'paper-archive', name: '纸上档案', description: '编辑纸张、标签与平面构成', skill: 'EDITORIAL / ARCHIVE', ratio: '2:3', cover: media('https://images.unsplash.com/photo-1455390582262-044cdead277a?auto=format&fit=crop&w=900&q=84'), accent: '#edcf96', prompt: '将用户上传的产品置于温暖纸张与编辑档案构图中，加入克制标签、测量线、纸张层次和柔和印刷纹理，保持产品为唯一焦点。', negative: productNegative }
]

/**
 * 头像模板
 * ------------------------------------------------------------------
 * 提示词（含负面）全部锁定，用户只能提供**模板要求的那一样东西**：
 * `'photo'` 模板要一张参考图，`'text'` 模板要一句主体描述。
 *
 * ⚠️ `capsule-eye-avatar.prompt` 是**王给的底层提示词原文**，逐字照搬，不要
 *    为了「简洁」去删段。它自己带 [背景和排除要素] 和 [冲突处理]，
 *    是一份自洽的规格；删掉其中任何一节都可能让出图跑偏。
 *    其中 [执行和后续修改] 那一段是**对话协议**（「只附加了一张图像就按基本
 *    转换请求处理」「只问用法就只用文字回答」），走 API 调用时不会生效 ——
 *    留着是为了和王的原文保持同源，不是为了它在 API 里起作用。
 *
 * ⚠️ ratio 只能是 '1:1'：提示词 [构图] 一节明确要求「在 1:1 的正方形画布上
 *    放置一个角色」。改成别的比例会同时违背提示词和模板的语义。
 *
 * ⚠️ `soft-ip-mascot.prompt` 来自外部 skill `ip-as-logo`（MIT，作者 s1dashu），
 *    装在本机 `~/.workbuddy-ai/skills/ip-as-logo/`。落地时有**三处刻意的改写**，
 *    都不是翻译误差，改回去之前先读 `~/.workbuddy-ai/skills/ip-as-logo/SKILL.md`：
 *      ① 原骨架用 `<subject>` / `<background>` / `<lower-left or lower-right>` 占位，
 *         而模板必须是**自洽的锁定规格**（和 capsule-eye 一样，不能留占位符）。
 *         于是背景写成「自行选定」，涌现角落**锁死左下**，主体由页面额外注入一行
 *         「主体：…」—— 原 skill 的「先提三个方向、一次出六张」是**对话式**流程，
 *         小程序里没有这一步，所以主体只能问用户要（见 `create-avatar` 页）。
 *      ② 原 skill 要求现代指令型模型把排除项写进主提示词的 `Constraints:` 一节，
 *         且**不得**再单独给负面提示词 ⇒ 本模板不给 `negative`（见类型上的说明）。
 *      ③ 原 skill 有一句「绝不能让生成提示词里出现 logo / brand mark / app icon /
 *         icon asset」。本模板正文**逐字守这条**（通篇只说「IP 角色」）。
 *         改这段提示词时请顺手 grep 一遍这几个词 —— 它们是**故意不出现**的。
 */
const avatarNegative =
  '不得出现文字、数字、标志、水印、话语泡、圆形框架或徽章边框；不得出现嘴巴、鼻子、虹膜、白眼球、睫毛、眉毛、眼睑；不得是实景、3D 渲染、油画质感或写实脸部结构。'

export const avatarTemplates: AvatarTemplate[] = [
  {
    id: 'capsule-eye-avatar',
    name: '胶囊眼睛头像',
    description: '把人物重绘成黑色胶囊眼的极简 2D 机器人图标',
    skill: 'AVATAR / CAPSULE EYE',
    ratio: '1:1',
    inputMode: 'photo',
    cover: avatarCapsuleEye,
    accent: '#c9d6e2',
    prompt: `[目标]
将用户提供的图像中的人物或角色重新解释为一个具有黑色胶囊眼的极简 2D 机器人图标。
从原图中提取识别目标所需的关键外貌特征，而脸部结构、眼睛、表情、构图和着色则遵循以下规格。在本指南中，Grok bot icon 指代该视觉规格。
[从原图提取的信息]
确认转换对象的肤色或脸部表面的基本颜色、发色和发型轮廓。头发的长度、分头、卷曲程度、代表性的刘海和束发形式均以原图为准。
选择识别所需的特征性耳朵、帽子、眼镜、胡须、装饰、机械部件中的关键元素。保持基本颜色，将需要保留形态的核心特征压缩在三个以内。优先考虑大的轮廓，而非微小的细节。
不要将肤色和发色统一为特定颜色。如果原图中没有头发或头发被遮挡，则保持该状态。不要添加原图中没有的刘海、饰品、机械部件。
不要复制原图的表情和写实的脸部结构。复杂的服装和装备只保留识别所需的部分。
即使有单独的风格参考图像，角色的外貌信息也只能从转换对象中提取。不要搬用风格参考图像中的肤色、发色、发型、装饰。
[脸部]
在圆大的机器人脸上结合简化后的头发和识别特征。通过圆润的比例和倾斜的构图而非表情装饰来表现可爱感。
脸部应以原图的肤色或表面颜色为基础，绘制成宽阔流畅的色面。柔和地连接脸颊和下巴，避免尖锐或有棱角的下巴以及写实的骨骼描写。
不要绘制嘴巴和鼻子。也不要放入笑嘴、小点状的嘴巴、猫嘴。
双颊要放入与肤色相配的、低饱和度的、淡淡的椭圆形腮红，且面积要小。腮红应表现为没有线条或闪光的扁平色面。
在眼睛和腮红周围留出足够的空白脸部面积。如果眼镜或胡须是核心识别特征，可以将其保留为最小限度的形态。眼镜不要遮挡双眼，胡须不要以描写嘴巴或写实脸部结构的方式绘制。
[眼睛]
眼睛要绘制成恰好两个接近黑色的单色胶囊形状。当脸部正立时，它们是纵向的短棒，两端圆润。纵向长度约为横向宽度的 2.5~3 倍，两只眼睛大小相同且相互平行排列。
每只眼睛的长轴与连接两只眼睛中心的线垂直。在保持此排列的同时，按照 [构图] 中指定的方向和角度将头部和双眼一起倾斜。不要绘制成横向躺卧的短棒或闭眼的形式。
每个胶囊要用一种没有空隙的颜色填充。由于这个图形本身就是眼睛，所以内部不要绘制单独的眼球或瞳孔。
不要放入虹膜、白眼球、反射光、闪光、渐变、睫毛、眼睑、眉毛、边框装饰。也不要有看起来像数字 1 的钩子或底座的笔画。
此规格优先于原图的眼睛形状和眼睛颜色。
[构图]
在 1:1 的正方形画布上放置一个角色。将脸部和头发或头部的外廓形状极度放大，填满大部分画面。
构图为角色从画面左下方倾斜着脑袋探看。将头部顺时针倾斜约 15~20 度，使画面左侧的眼睛看起来比右侧的眼睛稍高。脸部、双眼、头发和附带的装饰遵循相同的倾斜度。
头部的左侧和下侧边缘在画面边界处自然切断。下巴要触及画面下方或部分超出画面，右上方留出深色背景的空白。
双眼必须完全显现，不能被刘海或装饰遮挡。避免将整个头部放得很小的正中央证件照构图或左右对称构图。
不要绘制躯干和手。仅在识别需要时，才在画面下方保留脖子或衣领的一小部分。脸部放大和边缘剪裁是预期的构成。
[头发·装饰·着色]
头发要简化为几个大而流畅的块面，而不是细碎的发丝。保持原图的刘海方向、长度感和整体轮廓。
使用几乎没有外轮廓线、以色面为中心的极简 2D 表现。用相邻色面的差异而非粗黑轮廓线来区分形状。
用原图的代表色进行扁平且柔和的着色。在基本颜色上只增加一级左右的宽阔且微弱的阴影，如果需要头发高光，则限制为一个或两个大的色面。
装饰和机械部件只保留轮廓和大的连接部分。省略小螺丝、布线、电路、细密的面板线、复杂的图案。
即使缩小为小的个人资料图标，也必须能立即读出两个黑色胶囊眼和原图的核心轮廓。
[背景和排除要素]
背景应为贯穿整个画布的、几乎为黑色的深木炭单色。不要放入背景物体和图案。
排除圆形框架、徽章边框、文字、数字、标志、水印、话语泡、感叹标记、亮粉、微粒、光晕、镜头光晕。
避免实景、3D 渲染、油画质感、粗糙的草图线、过度的光泽、复杂的明暗、碎发描写、过密的装饰。
[冲突处理]
如果规则冲突，遵循以下顺序：
无装饰的两个黑色胶囊眼。
无嘴巴和鼻子的圆润机器人脸。
双眼完全显现的倾斜超近景构图。
原图的基本颜色和核心识别特征。
其他详细事项。
如果刘海遮挡眼睛，应在保持代表性流向的同时调整长度、宽度、位置。如果核心装饰因剪裁而完全消失，应小幅调整大小和位置，以保留可识别的部分。在此过程中，不要创造出原图中没有的特征。
[执行和后续修改]
当用户请求生成或转换时，以一张实际上生成的、完整的图标来回应，无需说明或文句。如果只附加了一张要转换的图像而没有提出单独的问题，则按基本转换请求处理。
如果无法确认转换对象图像，则请求附加。如果图像中有几个人物且未指定对象，则确认要转换谁。
如果仅询问提示词修改、规则说明、结果分析或使用方法，则以文字回答，不生成新图像。制作规格仅在收到请求时以文字提供，不放入图像中。
在后续修改中，只更改请求的部分，保持未请求单独更改的风格规格和角色特征。
不要将实际上未生成或未确认的结果说明为生成完成或验证完成。`,
    negative: avatarNegative
  },
  {
    id: 'soft-ip-mascot',
    name: '圆钝 IP 形象',
    description: '三个颜色的圆钝大形体构成的极简 IP，缩小到 32px 仍可辨认',
    skill: 'AVATAR / ROUNDED IP',
    ratio: '1:1',
    inputMode: 'text',
    cover: avatarSoftIpMascot,
    accent: '#c2683f',
    // ⚠️ 这份提示词里**故意不出现** logo / brand mark / app icon / 图标 / 标志 等词，
    //    是外部 skill 的硬要求（说了用途，模型就会去画一个「像图标的图」而不是角色）。
    //    改动时请 grep 一遍。上面「[约束]」一节承担了原本 negative 字段的全部职责。
    prompt: `生成一张完整的、铺满整个画布的正方形图像。
[背景]
整个正方形由单一纯色背景填满。每一处空余区域、以及没有被角色占用的角落，都保持这个背景色；指定的涌现角落必须由角色占据。背景色自行选定，并保持纯净均匀 —— 不加纹理、暗角、光晕或明暗变化。
[主体]
在背景上放置一个极度简化、圆钝、可爱的 IP 角色。整体只由一条柔和连续的圆钝外轮廓，加上一个定义性特征构成。
[复杂度]
只用 4~7 个大的基本几何形，内部最多两个宽阔的色区。眼睛只用两个简单形状；只有在有助于表情时，才加一个极小的嘴。删掉一切非必要的线条、外轮廓、解剖细节、纹理与装饰。角色在 32×32 像素下仍必须可辨认。
[颜色]
整幅图恰好三种语义颜色：两个 IP 基色，加一个背景色。两个 IP 基色由主体与语境决定，各自组织成宽阔而有目的的色块，并复用其中一种画面部标记 —— 不要引入第四种颜色。背景色独立于主体选择；除非另有要求，把背景的饱和度略微压低，使它安静、克制，但仍然明确是彩色，而不是灰的或脏的。角色、面部标记与背景之间必须保持清晰分离。任何示例配色都只是参考，不是必须遵循的清单。
[构图]
角色保持直立，从画面的左下角涌现，占据画布约 85%~95%，使它保持视觉主导。不要旋转画布，也不要倾斜主体。为了加强「从角落涌现」的感觉，可以在底边或指定的一侧做裁切。成对的特征（耳朵、角、翅膀等）两侧都要出现。不要把角色放在画面正中，也不要放在底部正中。
[风格]
把「简化、可爱、惹人怜爱」作为最强的品质。使用大而柔和的形体、紧凑的比例、厚实圆钝的轮廓，以及极干净的图形化处理。宁可要一个明确的形状，也不要几个用来解释细节的形状。通过一种几乎察觉不到的、极轻微的新拟物质感，给画面加入非常非常微弱、几乎不可见的立体感。
[完成度]
画面上只有这一个角色，以及铺满整个画布的背景。表面干净，外侧四角是正常的直角。
[约束]
不得出现文字或水印。不得加边框、外框、卡片或展示用的蒙版。只出现一个角色，不得有额外主体或场景。不得使用细弱易断的线条、尖锐的末端、多余的轮廓线、微小细节或装饰性标记。不得出现写实材质、夸张的斜面浮雕、高光热点、深度遮蔽、挤出、强烈的三维渲染或外部投影。背景保持纯色均匀。`
  }
]

const posterNegative =
  '不得出现水印、Logo、乱码、随机占位文字、廉价 3D、过度光泽、霓虹特效、杂乱背景或无关物体；标题必须清晰可读。'

export const posterDirections: PosterDirection[] = [
  { id: 'orbit-editorial', name: '轨道圆场', description: '圆形结构承载人物、材质与运动感', skill: 'CIRCULAR EDITORIAL', ratio: '9:16', cover: media('https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=84'), accent: '#f5f5f2', system: '制作 9:16 高级时尚编辑海报，以一个主导圆形作为视觉系统，结合同心环、旋转布料或水纹制造运动、深度与张力。留出干净负空间，使用优雅英文衬线标题与小号编辑信息，像当代时尚杂志封面。', negative: posterNegative },
  { id: 'three-act', name: '三段叙事', description: '顶部、中部、底部各自承担清晰角色', skill: 'THREE-ACT LAYOUT', ratio: '2:3', cover: media('https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=900&q=84'), accent: '#a9d9ff', system: '制作 2:3 纵向编辑海报，将画面分成顶部、中部、底部三个叙事区，每区有明确角色，并用文字、图像、叠压和材质过渡打破分隔。整体克制、留白充足、像艺术机构展览海报。', negative: posterNegative },
  { id: 'framed-focus', name: '边界聚焦', description: '用暗边、门框或圆周把视线引向主体', skill: 'FRAMED FOCUS', ratio: '9:16', cover: media('https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=900&q=84'), accent: '#ffb86b', system: '制作 9:16 电影感海报，让真实边界包围主体：暗边、门框、圆周或时间刻度形成多层聚焦与纵深。主体位于中心或偏中心，标题压在外围边界上，采用克制的黑、米白与单一强调色。', negative: posterNegative },
  { id: 'asymmetric-archive', name: '偏置档案', description: '左右视觉重量不均，形成高级的不对称', skill: 'ASYMMETRIC ARCHIVE', ratio: '2:3', cover: media('https://images.unsplash.com/photo-1547887538-e3a2f32cb1cc?auto=format&fit=crop&w=900&q=84'), accent: '#f0c9a4', system: '制作 2:3 左右非对称的文化档案海报，一侧由大尺度主体压场，另一侧承担阅读与留白；加入器物轮廓、枝叶或纸张拼贴越界，保持细腻印刷纹理与明确层级。', negative: posterNegative },
  { id: 'specimen-grid', name: '标本网格', description: '像博物馆图录一样组织对象与信息', skill: 'SPECIMEN GRID', ratio: '4:5', cover: media('https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=84'), accent: '#c9b8ff', system: '制作 4:5 博物馆标本图录海报，以规则网格、编号感的留白区域、局部放大细节和测量线组织主题。画面使用纸张、扫描、压印和低饱和色，标题像展览目录一样清晰优雅。', negative: posterNegative },
  { id: 'type-as-image', name: '巨字成像', description: '把标题变成画面的主要形体', skill: 'TYPE AS IMAGE', ratio: '16:9', cover: media('https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=900&q=84'), accent: '#ff7f66', system: '制作 16:9 横向设计海报，把标题作为主要视觉形体，使用超大英文排版、裁切、错位和局部遮挡与主题图像互动。搭配极少量辅助信息，形成画廊级的强识别构图。', negative: posterNegative },
  { id: 'veil-material', name: '薄纱叠层', description: '透明材质和柔光制造轻盈空间', skill: 'VEIL MATERIAL', ratio: '9:16', cover: media('https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=900&q=84'), accent: '#c6e7ff', system: '制作 9:16 空气感时尚海报，以半透明薄纱、磨砂玻璃或柔软纸层叠出前后景。主体穿过材质边界，使用柔和侧光、低对比背景和细衬线标题，保持轻盈但高级。', negative: posterNegative },
  { id: 'diagonal-motion', name: '斜向动势', description: '斜线、拖影和裁切制造速度感', skill: 'DIAGONAL MOTION', ratio: '3:2', cover: media('https://images.unsplash.com/photo-1525507119028-ed4c629a60a3?auto=format&fit=crop&w=900&q=84'), accent: '#d4ff6b', system: '制作 3:2 横向活动海报，以一条明确斜向轴线组织主体、标题和细线，加入克制的拖影、重复轮廓或运动切片。背景简洁，强调速度与秩序，不做运动品牌的俗套商业效果。', negative: posterNegative },
  { id: 'ink-monograph', name: '单色专著', description: '一到两种油墨呈现安静的出版物气质', skill: 'INK MONOGRAPH', ratio: '2:3', cover: media('https://images.unsplash.com/photo-1512436991641-6745cdb1723f?auto=format&fit=crop&w=900&q=84'), accent: '#e7e0d2', system: '制作 2:3 单色或双色出版物海报，只使用一到两种印刷油墨、粗细对比明确的字体与手工纸纹理。将主题转化为抽象图形或剪影，保持安静、克制、可收藏的编辑感。', negative: posterNegative },
  { id: 'nocturne-field', name: '夜色光场', description: '深色留白与单点光源形成戏剧焦点', skill: 'NOCTURNE FIELD', ratio: '9:16', cover: media('https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=900&q=84'), accent: '#a58cff', system: '制作 9:16 深色夜景编辑海报，以大面积深色留白和一个精确的光场塑造主题。主体被光线切出轮廓，标题使用高对比衬线字体，辅以少量时间、地点或坐标信息，整体神秘而现代。', negative: posterNegative },

  /*
    第 11 个方向「纸域微景」
    ------------------------------------------------------------------
    来源：@MrLarus 2026-09-21 的东方文化海报方法论 ——
      「纸纤维 + 大色域 + 主动留白 + 微型文化场景」，
      「微型人物负责故事，大色块负责整个画面的气质」，9:16 竖版。

    为什么 system 写这么长：客户端对海报方向只暴露「主题 / 标题」两个变量
    （见 compilePrompt），而这条方法论需要固定的色域比例、留白规则和微型场景
    约束才能出效果。可变的部分留在 THEME / TITLE，其余全部锁进 system ——
    这与「海报方向」这个设计本身的用意一致（见 create-poster 页头注释）。

    ⚠️ 封面是**本地打包图**，不是 media(...) 的远程图床地址。两个理由：
      ① 本机到 images.unsplash.com 不通（超时），**没法验证**新 URL 是否已失效；
         而图床删图是静默的 —— 卡片只会永远空白，和样式问题长得一样。
      ② 本地图零 404 风险，且这张图本身就是该模板的效果图。
      镜像门禁不比 cover，两边写法不同是允许的（见 check-prompt-mirror.mjs）。
  */
  { id: 'paper-field', name: '纸域微景', description: '纸纤维大色域，微型场景承担叙事', skill: 'ORIENTAL PAPER FIELD', ratio: '9:16', cover: posterPaperField, accent: '#d99a4e', system: '制作 9:16 竖版现代东方编辑美学文化活动海报，以「纸纤维 + 大色域 + 主动留白 + 微型文化场景」为核心视觉方法：画面由一块高纯度大色域承担整体气质，其余区域主动留白，纸面保留可辨的纤维、压痕与手工边缘；画面中只放一个占比极小的文化场景与微型人物，由它承担叙事，人物不喧宾夺主；辅以文化器物轮廓（影偶、漆器、古琴、纸浆帘等），标题使用克制的东方衬线字体、竖排或偏置排版，配少量活动信息。整体安静、有呼吸感，像当代艺术机构的东方主题展览海报。', negative: posterNegative },

  /*
    第 12 个方向「食感成字」
    ------------------------------------------------------------------
    来源：@MrLarus 的**同一个方法论，三次发帖**：
      · 2026-09-19（status/2101330066294599974）意面缠绕 / 饼干压裂 / 巧克力淋面 / 柑橘皮
      · 2026-09-22（status/2102398252918137026）面团卷过 / 喷枪焦化 / 可丽饼折进去 / 奶酪刨出
      · 2026-09-24（status/2103109379780440132）酸奶漩涡 / 抹茶填充 / 蛋白霜堆叠 / 麻薯拉伸
        ← 提示词回复 status/2103109740012376316，**作者第一次贴出完整正文**

    ⚠️ 2026-09-25 王给了 09-24 那条，要求「新增一个模板」。核对后**确认不是新方向**：
      三次发帖的变量表逐字相同（Brand / Food(Drink) / Headline(1 SHORT WORD) /
      Physical Interaction / Accent Color / Product Name / Price / Aspect Ratio 9:16），
      收尾句都是 `Create a premium editorial food poster`，
      只有 Physical Interaction 的举例不同（ROLL/TORCH/FOLD/GRATE → SWIRL/FILL/PIPE/PULL）。
      ⇒ 按王的决定**原地升级本方向的 system**，不新增第 17 个。
        新增会让下拉框出现两条几乎一样、出图也一样的选项 ——
        客户端只暴露「主题 / 标题」，物理机制并不由用户选（见 compilePrompt）。

    ⚠️ 下面的 system 是**作者原文逐字照搬**（英文，未翻译），只有两处刻意改动：
      ① **删掉输入变量块**（Brand / Food / Headline / Physical Interaction / Accent Color /
         Product Name / Price）—— 客户端只注入「主题描述 / 标题」两个字段。
         但把其中两条**约束**提到正文开头，因为正文里没有它们：
           `Aspect Ratio: 9:16`（system 不写比例，页面不会替你注入，ratio 字段只进 UI）
           `Headline: 1 SHORT WORD`（原文只在变量表里要求「极短」）
      ② `[INGREDIENTS] / [OPENING HOURS] / [ADDRESS] / [PRODUCT NOTES]` **去掉方括号**、
         改写成自然语言。原设计是让用户填这几个槽位，而本模板不收集它们 ——
         留着方括号会把**字面量** `[INGREDIENTS]` 送进模型，属于「沉默的失败」。
         规则本身（要加小号注记）一字未改。

    ⚠️ 封面沿用原图（面团卷曲那张**合成稿**，非模型出图）。09-24 那条的举例是液体/弹性，
      要换封面得重跑 `_tools/make-food-type-posters.py`（三份产物 + 版面碰撞断言）。
  */
  { id: 'food-type', name: '食感成字', description: '食物物理动作直接作用在标题上', skill: 'FOOD PHYSICS TYPE', ratio: '9:16', cover: posterFoodType, accent: '#b0602e', system: 'Aspect Ratio: 9:16. Headline: 1 SHORT WORD. Create a premium editorial food poster where real food physically interacts with oversized typography, using a warm cream or ivory background, bold black Heavy Grotesk type, photorealistic food materials, generous negative space, and a broken editorial grid inspired by contemporary food branding and high-end magazine design. The physical relationship must be the main visual idea, not decoration, food and typography should visibly affect each other through believable material behavior, force, flow, pressure, elasticity, or construction. Examples: SWIRL, thick food or liquid creates a real vortex and drags nearby typography through the same rotational flow; FILL, liquid physically enters hollow letter structures and settles according to gravity and a shared liquid level; PIPE, edible material is extruded directly into missing typographic strokes and physically constructs the letters; PULL, elastic food is stretched between opposing forces and the typography deforms according to the same real tension. Use only one physical mechanism per poster, keep cause and effect instantly readable, all deformation must follow real physics rather than random digital distortion, untouched typography should remain clean, geometric, strong, and legible. Build the composition with asymmetric placement, strong scale contrast, edge information, small meaningful annotations, and large areas of negative space, add small annotation details such as ingredients, opening hours, address, and product notes, avoid traditional menu rows, rigid bottom information bars, long horizontal separators, boxed prices, or template-like layouts. Use bold Grotesk Sans Serif for the main headline, high-contrast Editorial Serif or Italic Serif for product names, quotes, and prices, keep the palette minimal with cream, black, natural food colors, and one accent color. The final poster should feel clever, physical, premium, contemporary, and immediately readable at thumbnail size, the first glance should reveal the food and headline, the second glance should reveal the physical interaction behind the design.', negative: posterNegative },
  { id: 'shallow-dof', name: '浅景分离', description: '大光圈把主体与背景彻底分开', skill: 'SHALLOW DEPTH SEPARATION', ratio: '9:16', cover: posterShallowDof, accent: '#7d9bb5', system: '制作 9:16 竖版浅景分离编辑海报：用大光圈浅景深把主体与背景彻底分开，主体保持锐利、背景化成柔和的圆形光斑；标题压在化开的背景上而不是压在主体上，使用高对比衬线字体与一行克制的短标题，辅以产品名与价格；光线方向明确、色温暖而单一。核心是「焦内 / 焦外」的分离感，不要让整幅都虚或整幅都实。整体像高端饮品品牌的广告主视觉。', negative: posterNegative },
  { id: 'overhead-flatlay', name: '俯拍平铺', description: '正上方垂直俯视，物体压平成平面图形', skill: 'OVERHEAD FLAT LAY', ratio: '9:16', cover: posterOverheadFlatlay, accent: '#8fb08a', system: '制作 9:16 竖版俯拍平铺海报：从正上方垂直俯视（90°），物体被压平成平面图形，不出现透视、不出现投影；物体按网格秩序排列、彼此留出均匀间隙；标题做成「躺在桌面上的一张印刷标签」，投影短促、几乎无模糊，以读作平铺而不是浮起；下半部用平面色块与三列对齐的信息网格收束画面。整体像设计工作室的桌面陈列稿，秩序感全部来自排版。', negative: posterNegative },
  { id: 'anomaly-subject', name: '异变主体', description: '熟悉主体 + 一处异常 + 超大字体', skill: 'ANOMALY SUBJECT', ratio: '9:16', cover: posterAnomalySubject, accent: '#0a66b8', system: '制作 9:16 竖版极简冲击力海报，方法为「一个熟悉主体 + 一处异常变化 + 超大字体 + 强对比纯色背景」：画面只放一个日常熟悉的主体（水果、文具、杯子、鞋等），对它施加且只施加一处物理上不可能的异常——被水平切断并错位、被拉伸、被复制、材质被替换、或被放大到不合理的尺度；除这一处之外，其余部分完全真实。背景是一整块高纯度纯色，与主体形成强对比，不加渐变、不加纹理、不加装饰。标题使用极重的无衬线超大字体，字号大到让文字本身成为画面里的一个色块，并与主体发生关系——被主体遮挡、穿过或被切断。除主体、标题和一两行极小的信息外，其余区域主动留白。整体克制、干净、有强烈的视觉冲击。', negative: posterNegative }
]

export const promptTemplates: Record<string, PromptTemplate> = {
  'poster-editorial': {
    id: 'poster-editorial',
    fields: [{ key: 'THEME', label: '主题描述', required: true }, { key: 'TITLE', label: '标题', required: true }],
    system: posterDirections[0].system,
    negative: posterDirections[0].negative
  },
  'product-shot': {
    id: 'product-shot',
    fields: [{ key: 'PRODUCT', label: '商品' }, { key: 'AVATAR', label: '人物' }, { key: 'EDIT', label: '编辑描述', required: true }, { key: 'RATIO', label: '画面比例' }],
    system: '创建一张适合电商投放的产品视觉，保持商品外观、比例、材质与品牌识别准确。使用克制的商业摄影布光、干净背景、清晰主体和自然阴影，构图适合移动端广告。',
    negative: '不得改变商品结构、品牌标识或包装文字；不得出现多余产品、乱码、水印、过度反光、廉价 3D 渲染或不相关人物。'
  },
  'brand-system': {
    id: 'brand-system',
    fields: [{ key: 'BRAND', label: '品牌名称' }, { key: 'KEYWORDS', label: '品牌关键词', required: true }, { key: 'OBJECT', label: '核心物体' }, { key: 'COLOR', label: '品牌主色' }, { key: 'RATIO', label: '画面比例' }],
    system: '创建一张高级品牌视觉方向板，包含统一的色彩、材质、字体气质、构图节奏和可延展的图形语言。画面应像品牌设计工作室交付的首轮视觉提案，克制、清晰、具有系统性。',
    negative: '不得使用随机 Logo、无意义文字、模板水印、过度装饰、低质量图标、廉价渐变或彼此不一致的视觉风格。'
  }
}

export function compilePrompt(templateId: string, values: Record<string, string>, userPrompt = '') {
  const direction = posterDirections.find((item) => item.id === templateId)
  const template = direction
    ? { id: direction.id, fields: [{ key: 'THEME', label: '主题描述' }, { key: 'TITLE', label: '标题' }], system: direction.system, negative: direction.negative }
    : (promptTemplates[templateId] ?? promptTemplates['poster-editorial'])
  const fields = template.fields.map((field) => `${field.label}：${values[field.key] ?? ''}`).join('\n')
  return `${fields}\n\n${userPrompt.trim()}\n\n${template.system}\n负面限制：${template.negative}`.trim()
}

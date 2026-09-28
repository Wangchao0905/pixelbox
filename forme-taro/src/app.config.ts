export default defineAppConfig({
  pages: [
    'pages/home/index',
    'pages/create-poster/index',
    'pages/create-freeform/index',
    'pages/product-gallery/index',
    'pages/create-product/index',
    'pages/create-reference/index',
    'pages/create-product-shot/index',
    'pages/create-marketplace/index',
    'pages/avatar-gallery/index',
    'pages/create-avatar/index',
    'pages/result/index',
    'pages/assets/index',
    'pages/recharge/index',
    'pages/profile/index'
  ],
  window: {
    backgroundTextStyle: 'light',
    /**
     * 全屏：app 的背景一直铺到屏幕最上沿，盖住状态栏 / 灵动岛。
     * ------------------------------------------------------------------
     * 默认的 `default` 会让微信在顶部画一条原生导航栏，页面只能从它下面开始，
     * 于是「上方留一条、盖不住灵动岛」。
     *
     * 代价是**微信不再提供导航栏，也不再提供返回箭头** ——
     * 所以每个非首页页面都必须渲染 `components/AppHeader`（返回 + 标题），
     * 并且自己给状态栏让位（见 `services/system.ts` 的 statusBarHeight）。
     * 这条不变量由 `scripts/verify-dist.mjs` 逐页把关。
     *
     * ⚠️ 下面这几个 navigationBar* 字段在 custom 模式下不再生效，
     * 但**不要删**：它们是回退到 `default` 时的配置，留着才不会一改回去就变白条。
     * 2026-09-22：配色从奶白改成近黑，与深色基准一致。
     *
     * 同日 21:2x 王定「**深色无条件默认**」⇒ 不再跟随系统，于是
     * `navigationBarTextStyle: 'white'` 成了**唯一且正确**的取值，
     * 不存在「浅色下要翻成 black」的问题（状态栏白字压在奶白底上，
     * 正是这次从截图里实测到的 bug，见 forme.scss §15 的墓碑注释）。
     * 如果哪天重新加浅色变体，必须同时开 `darkmode: true` + `themeLocation`
     * 指向 theme.json，否则这里写死的 white 会再次变成白字压浅底。
     */
    navigationStyle: 'custom',
    navigationBarBackgroundColor: '#050505',
    navigationBarTitleText: '像素盒子',
    navigationBarTextStyle: 'white',
    backgroundColor: '#050505'
  },
  /**
   * 网络超时兜底（毫秒）。框架默认四个都是 **60000**。
   * ------------------------------------------------------------------
   * 这里不是「调优」，每一项都对应一个具体的坏结果：
   *
   * request —— 必须 >= 客户端的 generationTimeoutMs（200 秒）。
   *   生成请求会显式传 timeout，正常走不到这里；但万一哪天显式值被漏掉，
   *   兜底必须仍然是「等得比服务端久」。反过来就会出现「用户看到失败、
   *   服务端却已扣费」——这是最不能接受的一种。
   *
   * downloadFile —— **这条是合规相关的**。导出图片前要用 downloadFile 取原图
   *   再合成「AI 生成」标识；一旦下载超时，代码会退回**不带标识的原图**
   *   （见 services/export-image.ts 的 `return sourceUrl`）。
   *   60 秒在慢网下下载一张多 MB 的图并不宽裕，而失败的代价是标识缺失，
   *   不只是体验差。所以放到 120 秒。
   *
   * uploadFile —— 素材上传，同样受慢网影响。上传失败是可见错误、可重试，
   *   不像上面两条那样静默，但 60 秒对手机大图偏紧。
   */
  networkTimeout: {
    request: 200000,
    uploadFile: 120000,
    downloadFile: 120000
  }
})

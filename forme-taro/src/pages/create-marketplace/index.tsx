import { View } from '@tarojs/components'
import { useRouter } from '@tarojs/taro'
import { AppHeader, ProductStudioComposer } from '@/components'
import { productStudioParamName } from '@/services/product-studio'

/**
 * 电商主图
 * ==================================================================
 * 上传一张产品图，产出白底主图 / 纯色卖点图 / 细节特写三种商品图。
 * 对应交接文件 `docs/handoffs/2026-09-23-inspiration-recreate.md`。
 *
 * 这一页**故意只有两行**（理由与「产品拍摄」完全相同，见那个文件）：
 *  · `<AppHeader>` 留在页面文件里，产物门禁才能在该页分块里找到调用点；
 *  · 表单在 `components/ProductStudioComposer`，与「产品拍摄」共用一份。
 *
 * `shot` 参数来自产品工作室选完主图类型的那一跳。参数名走
 * `productStudioParamName()` —— 注意它和产品拍摄**不是同一个名字**
 * （那边是 `mode`）：「棚拍」是拍摄方式、「白底主图」是主图类型，
 * 共用 `mode` 会让分享链接看起来像同一个东西，而它们不是。
 *
 * ⚠️ 与产品拍摄唯一的实质差别：这一类的提示词**额外禁止生成促销文字**
 *    （见 `services/product-studio.ts` 的 `NO_PROMO_TEXT`）——
 *    商品主图上多出没写过的价格或标签，是这类图最不能容忍的错。
 */
export default function CreateMarketplace() {
  const router = useRouter()
  return (
    <View className='app-screen create-content page-pad has-dock page-enter'>
      <AppHeader title='电商主图' />
      <ProductStudioComposer
        kind='marketplace'
        initialValue={router.params?.[productStudioParamName('marketplace')]}
      />
    </View>
  )
}

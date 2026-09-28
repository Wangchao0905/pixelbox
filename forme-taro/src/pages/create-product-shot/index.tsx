import { View } from '@tarojs/components'
import { useRouter } from '@tarojs/taro'
import { AppHeader, ProductStudioComposer } from '@/components'
import { productStudioParamName } from '@/services/product-studio'

/**
 * 产品拍摄
 * ==================================================================
 * 上传一张产品图，产出棚拍 / 生活方式 / 人物使用三种成品图。
 * 对应交接文件 `docs/handoffs/2026-09-23-inspiration-recreate.md`。
 *
 * 这一页**故意只有两行**：
 *  · `<AppHeader>` 必须留在这里 —— 产物门禁 `HEADER_PAGES` 是在**页面分块**里
 *    找 `title:"产品拍摄"` 这个调用点，挪进共享组件就会红（而页面其实是对的）。
 *  · 表单本身在 `components/ProductStudioComposer`，与「电商主图」共用一份。
 *    两个工作流的差别只在提示词约束上，界面结构完全相同。
 *
 * `mode` 参数来自产品工作室选完模式的那一跳。参数名走
 * `productStudioParamName()`，不在这里写 `'mode'` 字面量 ——
 * 产品工作室那一侧读的是同一个来源，两边各写一份就会漂。
 * 非法 / 缺失的值由 `productStudioIntentFromParam` 退回默认，**不会白屏**。
 *
 * 与「灵感复刻」的根本区别：**没有视觉参考图**。产品主体只能是上面那一张。
 */
export default function CreateProductShot() {
  const router = useRouter()
  return (
    <View className='app-screen create-content page-pad has-dock page-enter'>
      <AppHeader title='产品拍摄' />
      <ProductStudioComposer
        kind='product-shot'
        initialValue={router.params?.[productStudioParamName('product-shot')]}
      />
    </View>
  )
}

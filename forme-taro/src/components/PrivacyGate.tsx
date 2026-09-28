import { useEffect, useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import {
  AGREE_BUTTON_ID,
  denyPrivacyConsent,
  grantPrivacyConsent,
  openPrivacyContract,
  subscribePrivacy,
  type PrivacyState
} from '@/services/privacy'

/**
 * 隐私授权弹窗
 * ------------------------------------------------------------------
 * 用户点按上传/导出时，如果微信侧还没记录过同意，就弹这个。
 *
 * 关键的实现约束：同意按钮必须是 `<Button open-type="agreePrivacyAuthorization">`。
 * 基础库会校验「被点过的按钮」确实是这个 id，用普通 View 假装点一下
 * 是不会放行的——所以这里不能用项目里通用的 View + hoverClass 按钮写法。
 *
 * 另外：弹窗组件必须真的挂载，`ensurePrivacyAuthorized()` 才等得到结果。
 * 挂在触发隐私接口的组件里（见 UploadSlot）比挂在页面上更保险，
 * 将来有人把上传入口搬到别处也不会漏。
 */
export default function PrivacyGate() {
  const [state, setState] = useState<PrivacyState>({ visible: false, contractName: '' })

  useEffect(() => subscribePrivacy(setState), [])

  if (!state.visible) return null

  const contractName = state.contractName || '《用户隐私保护指引》'

  return (
    <View className='privacy-mask'>
      <View className='privacy-card'>
        <Text className='eyebrow'>PRIVACY</Text>
        <View className='privacy-title'>使用前请阅读隐私政策</View>
        <Text className='privacy-copy'>
          上传产品图需要读取你选择的照片，导出结果需要写入你的相册。
          这些信息只在完成对应功能时使用，具体范围以{contractName}为准。
        </Text>

        <View className='privacy-link' hoverClass='press-dim' onClick={openPrivacyContract}>
          <Text>查看{contractName}</Text>
        </View>

        <View className='privacy-actions'>
          <View className='secondary-button privacy-decline' hoverClass='is-pressed' onClick={denyPrivacyConsent}>
            <Text>暂不</Text>
          </View>
          <Button
            id={AGREE_BUTTON_ID}
            className='primary-cta privacy-agree'
            openType='agreePrivacyAuthorization'
            onAgreePrivacyAuthorization={grantPrivacyConsent}
          >
            <Text>同意并继续</Text>
          </Button>
        </View>
      </View>
    </View>
  )
}

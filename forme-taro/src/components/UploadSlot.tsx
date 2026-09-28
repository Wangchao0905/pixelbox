import { Image, View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { pickImage, type ImageAsset } from '@/services/image-api'
import PrivacyGate from './PrivacyGate'

type Props = {
  label: string
  required?: boolean
  icon?: string
  asset?: ImageAsset
  /**
   * 空状态下的用途说明（第二行小字）。
   * ⚠️ **同一页面里多个槽位必须各不相同**：这是区分「产品图」与「参考图」
   * 的主要手段之一，而且它不依赖颜色 —— 读屏、低对比度、只看截图都分得清。
   * 不传就只显示 label（老页面维持原样）。
   */
  hint?: string
  /**
   * 已填状态下删除按钮的文案。
   * ⚠️ 同样必须逐槽不同（「移除产品图」/「换掉参考图」）：两个槽位的删除
   * 如果都叫「移除」，用户在读屏下无法知道会删掉哪一张。
   */
  removeLabel?: string
  onChange: (asset: ImageAsset) => void
  /** 传了才渲染删除按钮。不传 = 老行为（只能重选，不能清空）。 */
  onRemove?: () => void
}

/**
 * 素材上传槽
 * ------------------------------------------------------------------
 * 原型用 <input type="file"> + FileReader 拿 base64；
 * 小程序改用 wx.chooseMedia 拿本地临时路径，真正上传发生在生成时
 * （服务端用 wx.uploadFile 或预签名 URL 收文件）。
 *
 * PrivacyGate 挂在这里而不是页面上：wx.chooseMedia 是隐私接口，
 * 弹窗组件必须和触发它的入口在一起。挂在页面里的话，将来有人把
 * 上传入口搬到别的页面就会漏掉弹窗，用户直接吃到接口报错。
 */
export default function UploadSlot({
  label,
  required,
  icon = '▣',
  asset,
  hint,
  removeLabel,
  onChange,
  onRemove
}: Props) {
  const handlePick = async () => {
    try {
      const next = await pickImage()
      if (next) onChange(next)
    } catch (error: any) {
      const message = String(error?.message ?? error?.errMsg ?? '')
      // 用户主动取消不是错误，不要弹提示
      if (message.includes('cancel')) return
      Taro.showToast({ title: message || '选择图片失败', icon: 'none' })
    }
  }

  /**
   * ⚠️ 必须阻止冒泡。外面那层 `.upload-slot` 带着 onClick（重新选图），
   * 不拦的话点「移除」会紧接着弹出系统相册 —— 用户看到的是「删不掉，
   * 反而又让我选图」。而且它**不报错**，只有真的点一下才会发现。
   */
  const handleRemove = (event: any) => {
    event?.stopPropagation?.()
    onRemove?.()
  }

  return (
    <>
      <View
        className={`upload-slot ${asset ? 'is-filled' : ''}`}
        hoverClass='press-dim'
        onClick={handlePick}
      >
        {asset ? <Image className='slot-preview' src={asset.path} mode='aspectFill' /> : null}
        {!asset ? (
          <>
            <View className='slot-icon'>
              <Text>{icon}</Text>
            </View>
            <Text className='slot-label'>{label}</Text>
            {hint ? <Text className='slot-hint'>{hint}</Text> : null}
          </>
        ) : null}
        <Text className={`required-pill ${required ? 'is-required' : ''}`}>
          {required ? '必需' : asset ? '已添加' : '可选'}
        </Text>
        {asset && onRemove ? (
          <View className='slot-remove' hoverClass='press-dim' onClick={handleRemove}>
            <Text>{removeLabel ?? '移除'}</Text>
          </View>
        ) : null}
      </View>

      {/* 弹窗必须是 upload-slot 的**兄弟节点**，不能嵌在里面：
          上面那层带 onClick，嵌进去的话点「同意」会冒泡到 upload-slot，
          又触发一次选图，等于同时弹两次系统相册。 */}
      <PrivacyGate />
    </>
  )
}

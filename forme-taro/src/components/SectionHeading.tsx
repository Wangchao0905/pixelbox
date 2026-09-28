import { View, Text } from '@tarojs/components'

type Props = {
  eyebrow: string
  title: string
  caption?: string
}

/** 区块标题：eyebrow + 标题 + 右侧小注 */
export default function SectionHeading({ eyebrow, title, caption }: Props) {
  return (
    <View className='section-heading'>
      <View>
        <Text className='eyebrow'>{eyebrow}</Text>
        <View className='h2'>{title}</View>
      </View>
      {caption ? <Text className='section-caption'>{caption}</Text> : null}
    </View>
  )
}

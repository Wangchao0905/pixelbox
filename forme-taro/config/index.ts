import { defineConfig, type UserConfigExport } from '@tarojs/cli'
import devConfig from './dev'
import prodConfig from './prod'

/**
 * 设计宽度说明
 * ------------------------------------------------------------------
 * 视觉真源是 visual-studio 移动端原型，设备屏幕为 393 CSS px 宽。
 *
 * pxtransform 的换算公式是 `rpx = px * deviceRatio[designWidth]`，
 * 也就是源码 px 数乘上这个比例。想让源码里的 `font-size: 39px` 等于
 * 原型里的 39px（= 屏幕宽度的 39/393），比例必须取 750 / 393 ≈ 1.908：
 *   39 * 1.908 = 74.4rpx → 74.4 / 750 * 375pt 屏 = 37.2px ✓
 * 若把比例写成 1，会得到 39rpx = 19.5px，整个界面缩小一半。
 *
 * 好处：从 prototype.css 迁移样式时数值可以 1:1 照抄，不用手工换算。
 *
 * onePxTransform 关闭，让 1px 边框保持物理发丝线，不被放大成 2rpx。
 */
export default defineConfig<'webpack5'>(async (merge, { command, mode }) => {
  const baseConfig: UserConfigExport<'webpack5'> = {
    projectName: 'forme-taro',
    date: '2026-9-18',
    designWidth: 393,
    deviceRatio: {
      393: 750 / 393
    },
    sourceRoot: 'src',
    outputRoot: 'dist',
    // Taro 不内置 '@' 别名，这里手动指向 src。
    // 用 process.cwd() 而不是 __dirname：配置文件会被转译到临时目录后加载，
    // __dirname 不可靠；而 Taro 本身就要求从项目根目录运行。
    alias: {
      '@': `${process.cwd()}/src`
    },
    plugins: [],
    defineConstants: {},
    copy: {
      patterns: [],
      options: {}
    },
    framework: 'react',
    compiler: 'webpack5',
    cache: {
      enable: false
    },
    mini: {
      postcss: {
        pxtransform: {
          enable: true,
          config: {
            onePxTransform: false
          }
        },
        cssModules: {
          enable: false
        }
      }
    },
    h5: {
      publicPath: '/',
      staticDirectory: 'static',
      output: {
        filename: 'js/[name].[hash:8].js',
        chunkFilename: 'js/[name].[chunkhash:8].js'
      },
      miniCssExtractPluginOption: {
        ignoreOrder: true,
        filename: 'css/[name].[hash].css',
        chunkFilename: 'css/[name].[chunkhash].css'
      },
      postcss: {
        autoprefixer: {
          enable: true,
          config: {}
        },
        cssModules: {
          enable: false
        }
      }
    }
  }

  if (process.env.NODE_ENV === 'development') {
    return merge({}, baseConfig, devConfig)
  }
  return merge({}, baseConfig, prodConfig)
})

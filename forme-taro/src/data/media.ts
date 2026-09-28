import { APP_CONFIG } from '@/config'

/**
 * 把原型里的远程图片地址映射到自有 CDN。
 * 未配置 mediaBase 时原样返回，保持与 visual-studio 原型一致。
 *
 * ⚠️ 下面的「取最后一段、去掉查询串」这个规则**在另一处也实现了一遍**：
 *   forme-server/deploy/fetch-covers.mjs 的 coverFileName()
 * 那边按同样的规则算出文件名去下载，两边必须一致。
 * 改这里就要改那里，否则下载下来的文件名对不上 → 封面全 404。
 *
 * 另外：产出**没有扩展名**（photo-1549490349-8643362247b5），
 * 所以 nginx 那边必须给 default_type image/jpeg，
 * 否则会发 application/octet-stream，表现同样是封面空白。
 */
export function media(url: string): string {
  const base = APP_CONFIG.mediaBase
  if (!base) return url
  const file = url.split('?')[0].split('/').pop() ?? ''
  return `${base.replace(/\/+$/, '')}/${file}`
}

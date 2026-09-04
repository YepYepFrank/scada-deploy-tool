import type { WidgetDefinition } from '../../schema/registry'
import ImageWidget from './ImageWidget.vue'

// 内置演示图:1 像素透明 PNG 之外给一张简单 SVG(data URL),/dev 与缩略图不依赖外部资源
const SAMPLE_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 220"><rect width="400" height="220" fill="#061c40"/><g stroke="#19b7ff" stroke-width="3" fill="none"><path d="M40 40h320M200 40v60"/><circle cx="200" cy="120" r="18"/><path d="M200 138v42M120 180h160"/><rect x="80" y="150" width="60" height="30" rx="4"/><rect x="260" y="150" width="60" height="30" rx="4"/></g><text x="200" y="210" fill="#8fbce8" font-size="14" text-anchor="middle">接线图占位(image)</text></svg>`
  )

export const imageWidget: WidgetDefinition = {
  type: 'image',
  name: '图片',
  category: 'media',
  description: '静态图片或绑定地址;一期 main 槽位放接线图截图 / 站点照片',
  component: ImageWidget,
  propsSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', title: '标题', default: '' },
      src: { type: 'string', title: '图片地址', format: 'url', default: '' },
      alt: { type: 'string', title: '替代文字', default: '' },
      fit: {
        type: 'string',
        title: '适配',
        enum: ['contain', 'cover', 'fill'],
        enumNames: ['完整显示', '填满裁切', '拉伸'],
        default: 'contain',
      },
    },
    additionalProperties: false,
  },
  bindingSlots: [{ name: 'src', title: '地址(可选,覆盖 props.src)', valueType: 'string', modes: ['const', 'attr'] }],
  defaults: { title: '', src: '', alt: '', fit: 'contain' },
  sampleData: () => ({ src: SAMPLE_SVG }),
}

export { SAMPLE_SVG }

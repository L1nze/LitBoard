/* foliate bundle 入口：注册 <foliate-view> 自定义元素，导出 makeBook / CFI / Overlayer。
 * pdf/mobi/fb2/cbz/dict 等非 EPUB 格式在 build.js 中 external 剥离（LitBoard 的 PDF 走 MuPDF）。 */
import './view.js'
import { makeBook } from './view.js'
import * as CFI from './epubcfi.js'
import { Overlayer } from './overlayer.js'

globalThis.LitFoliate = { makeBook, CFI, Overlayer }

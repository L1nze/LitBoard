/* OCR bundle 入口：把 @paddleocr/paddleocr-js 的 create 工厂挂全局 LitPaddleOcr。
 * 主线程只承载 worker RPC 客户端；OpenCV 被 alias 到 stub（见 opencv-stub.js）。 */
import { PaddleOCR } from '@paddleocr/paddleocr-js';

globalThis.LitPaddleOcr = { PaddleOCR: PaddleOCR };

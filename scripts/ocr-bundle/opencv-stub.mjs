/* 主线程 OpenCV stub：worker 模式下主线程用不到 OpenCV（真 OpenCV 在 worker-entry 内）。
 * 真 OpenCV 的 Emscripten 壳在模块加载期就 new Function（extendError / createNamedFunction），
 * 渲染层 CSP script-src 'self'（无 unsafe-eval）会拦——主线程 bundle 绝不能装真 OpenCV。
 * 探针证据：scripts/one-off/probe-paddleocr/README.md「附带发现」。 */
export default null;

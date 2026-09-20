'use strict';

/* Word 联动诊断：用生产桥（electron/word-bridge.js）驱动真实 cscript + Word COM，
 * 执行 PING / INFO 两条只读命令。用法：npm run diag:word
 *
 * 结果解读：
 * - Version=16.0 之类 + 文档列表 → 链路正常；
 * - 「Microsoft Word is not running」→ Word 没开（桥附着已运行实例，不会替你启动）；
 * - 超时 → Word 弹着模态对话框（保护视图 / 激活 / 宏警告）时 COM 会挂起，先处理完 Word 里的弹窗；
 * - 「Unable to start Word bridge (cscript)」→ cscript 被安全软件拦截或系统脚本宿主被禁用。
 */

const path = require('node:path');
const { createWordBridge } = require(path.resolve(__dirname, '..', 'electron', 'word-bridge.js'));

const bridge = createWordBridge({ scriptPath: path.resolve(__dirname, '..', 'word', 'wordbridge.js') });

(async function () {
  try {
    const ping = await bridge.invoke({ command: 'PING' }, 15000);
    console.log('PING  → OK, Version =', JSON.stringify(ping));
    const info = await bridge.invoke({ command: 'INFO' }, 15000);
    const parts = String(info).split('|');
    console.log('INFO  → OK, Version =', JSON.stringify(parts[0]), '| 打开文档数 =', parts[1]);
    (parts[2] || '').split(';').filter(Boolean).forEach(function (p) {
      const name = Buffer.from(p, 'base64').toString('utf8');
      console.log('        文档:', name);
    });
    console.log('\n生产链路（Node → cscript → Word COM）真实可用 ✓');
    process.exit(0);
  } catch (error) {
    console.error('失败:', error.message);
    process.exit(1);
  } finally {
    bridge.stop();
  }
})();

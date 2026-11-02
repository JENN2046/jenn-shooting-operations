// Fixed-fixture local presentation only; intentionally no file/URL/credential input.
import {syntheticDailyOperations} from '../examples/daily-briefing-synthetic-v1.mjs';
import {projectDailyBriefing} from '../src/daily-briefing-v1.mjs';
import {renderDailyBriefingText, renderDailyBriefingHtml} from '../src/daily-briefing-render-v1.mjs';

const args = process.argv.slice(2);
if (args.length > 1 || args.length === 1 && !['--json', '--html', '--help'].includes(args[0])) {
  console.error('Usage: node scripts/demo-daily-briefing.mjs [--json|--html|--help]');
  process.exitCode = 1;
} else if (args[0] === '--help') {
  console.log('固定合成样本，只读本地演示；不连接 JSO 服务、数据库或模型。\nUsage: node scripts/demo-daily-briefing.mjs [--json|--html]');
} else {
  const briefing = projectDailyBriefing(syntheticDailyOperations());
  if (!briefing.ok) {
    console.error('SYNTHETIC_DAILY_BRIEFING_FAILED');
    process.exitCode = 1;
  } else console.log(args[0] === '--html' ? renderDailyBriefingHtml(briefing, {synthetic: true})
    : args[0] === '--json' ? JSON.stringify({synthetic: true, briefing}, null, 2)
      : '【合成样本 · 非真实业务数据】\n' + renderDailyBriefingText(briefing));
}

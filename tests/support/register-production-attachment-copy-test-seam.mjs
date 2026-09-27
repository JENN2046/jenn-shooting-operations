import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

if (process.env.NODE_TEST_CONTEXT !== 'child-v8') {
  throw new Error('attachment copy test seam is available only inside node --test');
}

const target = new URL(
  '../../src/production-attachment-copy-v1.mjs?attachment-copy-test-seam',
  import.meta.url,
).href;
const seam = readFileSync(
  new URL('./production-attachment-copy-test-seam.inc.mjs', import.meta.url),
  'utf8',
);

registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url !== target) return result;
    const source = typeof result.source === 'string'
      ? result.source
      : Buffer.from(result.source).toString('utf8');
    return {
      ...result,
      source: source + '\n' + seam + '\n',
    };
  },
});
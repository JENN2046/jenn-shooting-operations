import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { normalizePlannerData, validateSnapshot } from '../src/contract-validator.mjs';

const source = process.argv[2];
if (!source) {
  console.error('Usage: node scripts/validate-current-planner.mjs <planner-data.json>');
  process.exitCode = 2;
} else {
  const input = JSON.parse(await readFile(resolve(source), 'utf8'));
  const snapshot = normalizePlannerData(input, '2026-09-22T00:00:00.000Z');
  const errors = validateSnapshot(snapshot);
  if (errors.length) {
    console.error(`FAIL current planner data has ${errors.length} contract error(s)`);
    errors.forEach(error => console.error(`- ${error}`));
    process.exitCode = 1;
  } else {
    console.log(`PASS current planner maps to contract v1: ${snapshot.products.length} products, ${snapshot.tasks.length} tasks, ${snapshot.sessions.length} sessions`);
  }
}

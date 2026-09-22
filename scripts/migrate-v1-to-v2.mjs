import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import {
  MigrationError,
  buildMigrationPlan,
  exitCodeForReport,
  failureReport,
  parseResourceMap,
  reportForPlan,
} from '../src/migration-v2.mjs';
import {
  readResourceMapFile,
  readV1Source,
  resolveExistingPath,
  sameFile,
  verifyUploadManifest,
  verifyV2Target,
} from '../src/migration-sqlite-v2.mjs';

const FLAG_OPTIONS = new Set(['--dry-run', '--verify-only', '--apply', '--strict', '--hash-uploads']);
const VALUE_OPTIONS = new Set([
  '--source',
  '--target',
  '--source-label',
  '--business-time-zone',
  '--resource-map',
  '--upload-root',
  '--format',
]);
const UNSUPPORTED_OPTIONS = new Set(['--report-json', '--overwrite-report', '--force']);

function invalid(code = 'INVALID_USAGE') {
  throw new MigrationError(code, 'INVALID_USAGE');
}

export function parseMigrationArgs(args) {
  if (!Array.isArray(args)) invalid();
  const seen = new Set();
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (typeof argument !== 'string' || !argument.startsWith('--') || argument.includes('=')) invalid();
    if (UNSUPPORTED_OPTIONS.has(argument)) invalid('FEATURE_NOT_AVAILABLE');
    if (!FLAG_OPTIONS.has(argument) && !VALUE_OPTIONS.has(argument)) invalid('UNKNOWN_ARGUMENT');
    if (seen.has(argument)) invalid('DUPLICATE_ARGUMENT');
    seen.add(argument);
    if (VALUE_OPTIONS.has(argument)) {
      const value = args[index + 1];
      if (typeof value !== 'string' || value.startsWith('--')) invalid('MISSING_ARGUMENT_VALUE');
      values.set(argument, value);
      index += 1;
    }
  }

  const modes = ['--dry-run', '--verify-only', '--apply'].filter(option => seen.has(option));
  if (modes.length !== 1) invalid('MIGRATION_MODE_REQUIRED');
  if (modes[0] === '--apply') invalid('APPLY_NOT_AVAILABLE');
  const mode = modes[0].slice(2);
  if (!values.has('--source') || !values.has('--business-time-zone')) invalid('MISSING_REQUIRED_ARGUMENT');
  if (mode === 'verify-only' && !values.has('--target')) invalid('TARGET_REQUIRED');
  if (mode === 'dry-run' && values.has('--target')) invalid('TARGET_NOT_ALLOWED');
  const format = values.get('--format') ?? 'text';
  if (!['text', 'json'].includes(format)) invalid('INVALID_FORMAT');
  const sourceLabel = values.get('--source-label') ?? 'source';
  if (!/^[\p{L}\p{N}._-]{1,80}$/u.test(sourceLabel)) invalid('INVALID_SOURCE_LABEL');
  return Object.freeze({
    mode,
    source: values.get('--source'),
    target: values.get('--target'),
    sourceLabel,
    businessTimeZone: values.get('--business-time-zone'),
    resourceMap: values.get('--resource-map'),
    uploadRoot: values.get('--upload-root'),
    format,
    strict: seen.has('--strict'),
    hashUploads: seen.has('--hash-uploads'),
  });
}

function renderText(report) {
  const issueCodes = report.issues.map(issue => `${issue.code}:${issue.count}`).join(',') || 'none';
  return [
    `Result: ${report.result}`,
    `Mode: ${report.mode}`,
    `Switch readiness: ${report.switchReadiness}`,
    `Source label: ${report.source.label}`,
    `Snapshot revision: ${report.source.snapshotRevision ?? 'NOT_RUN'}`,
    `V1 round-trip: ${report.roundTrip.validatorStatus}`,
    `V2 validation: ${report.roundTrip.v2ValidatorStatus}`,
    `Attachment validation: ${report.attachments.validationStatus}`,
    `Target verification: ${report.targetVerification.status}`,
    `Issues: ${issueCodes}`,
  ].join('\n');
}

export function renderMigrationReport(report, format) {
  return format === 'json' ? JSON.stringify(report) : renderText(report);
}

export function executeMigration(args, { clock = () => new Date() } = {}) {
  let options;
  let sourceInfo;
  const requestedModes = Array.isArray(args)
    ? ['--dry-run', '--verify-only', '--apply'].filter(mode => args.includes(mode))
    : [];
  const requestedMode = requestedModes.length === 1 ? requestedModes[0].slice(2) : 'unknown';
  try {
    options = parseMigrationArgs(args);
    sourceInfo = resolveExistingPath(options.source, 'file');
    let targetInfo;
    if (options.target) {
      targetInfo = resolveExistingPath(options.target, 'file');
      if (sameFile(sourceInfo, targetInfo)) invalid('SOURCE_TARGET_CONFLICT');
    }
    let uploadRootInfo;
    if (options.uploadRoot) uploadRootInfo = resolveExistingPath(options.uploadRoot, 'directory');
    let resourceMap = null;
    if (options.resourceMap) {
      const resourceMapInfo = resolveExistingPath(options.resourceMap, 'file');
      if (sameFile(sourceInfo, resourceMapInfo)) invalid('SOURCE_RESOURCE_MAP_CONFLICT');
      resourceMap = parseResourceMap(
        readResourceMapFile(resourceMapInfo),
        options.businessTimeZone,
      );
    }
    const source = readV1Source(sourceInfo);
    const importedAt = clock().toISOString();
    const plan = buildMigrationPlan({
      source,
      businessTimeZone: options.businessTimeZone,
      resourceMap,
      importedAt,
    });
    const attachmentManifest = verifyUploadManifest(uploadRootInfo, plan, {
      hashUploads: options.hashUploads,
    });
    const verification = options.mode === 'verify-only'
      ? verifyV2Target(targetInfo, plan)
      : undefined;
    const effectivePlan = verification?.plan ?? plan;
    const report = reportForPlan(effectivePlan, {
      mode: options.mode,
      sourceLabel: options.sourceLabel,
      sourcePathDigest: sourceInfo.pathDigest,
      verification,
      attachmentManifest,
      uploadHashing: options.hashUploads,
    });
    return {
      report,
      output: renderMigrationReport(report, options.format),
      exitCode: exitCodeForReport(report, options.strict),
    };
  } catch (error) {
    const mode = options?.mode ?? requestedMode;
    const format = options?.format ?? 'text';
    const failure = failureReport(error, {
      mode,
      sourceLabel: options?.sourceLabel ?? 'source',
      sourcePathDigest: sourceInfo?.pathDigest,
    });
    return {
      report: failure.report,
      output: renderMigrationReport(failure.report, format),
      exitCode: failure.exitCode,
    };
  }
}

const invokedDirectly = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const result = executeMigration(process.argv.slice(2));
  const write = result.exitCode === 0 ? console.log : console.error;
  write(result.output);
  process.exitCode = result.exitCode;
}

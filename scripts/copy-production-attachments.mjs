import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { MigrationError } from '../src/migration-v2.mjs';
import {
  copyAndVerifyAttachments,
  verifyAttachmentDatabaseParity,
} from '../src/production-attachment-copy-v1.mjs';

const FLAGS = new Set([
  '--apply',
  '--verify-only',
  '--acknowledge-isolated-target',
]);
const VALUES = new Set([
  '--source-db',
  '--source-upload-root',
  '--target-db',
  '--target-upload-root',
  '--format',
]);

function invalid(code = 'INVALID_USAGE') {
  throw new MigrationError(code, 'INVALID_USAGE');
}

export function parseAttachmentCopyArgs(args) {
  if (!Array.isArray(args)) invalid();
  const seen = new Set();
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (typeof argument !== 'string' || !argument.startsWith('--') || argument.includes('=')) invalid();
    if (!FLAGS.has(argument) && !VALUES.has(argument)) invalid('UNKNOWN_ARGUMENT');
    if (seen.has(argument)) invalid('DUPLICATE_ARGUMENT');
    seen.add(argument);
    if (VALUES.has(argument)) {
      const value = args[index + 1];
      if (typeof value !== 'string' || value.startsWith('--')) invalid('MISSING_ARGUMENT_VALUE');
      values.set(argument, value);
      index += 1;
    }
  }

  const modes = ['--apply', '--verify-only'].filter(flag => seen.has(flag));
  if (modes.length !== 1) invalid('ATTACHMENT_COPY_MODE_REQUIRED');
  for (const option of ['--source-db', '--source-upload-root', '--target-db', '--target-upload-root']) {
    if (!values.has(option)) invalid('MISSING_REQUIRED_ARGUMENT');
  }

  const mode = modes[0].slice(2);
  if (mode === 'apply' && !seen.has('--acknowledge-isolated-target')) {
    invalid('ISOLATED_TARGET_ACK_REQUIRED');
  }
  if (mode === 'verify-only' && seen.has('--acknowledge-isolated-target')) {
    invalid('APPLY_ARGUMENT_NOT_ALLOWED');
  }

  const format = values.get('--format') ?? 'text';
  if (!['json', 'text'].includes(format)) invalid('INVALID_FORMAT');

  return Object.freeze({
    mode,
    sourceDatabasePath: values.get('--source-db'),
    sourceUploadRoot: values.get('--source-upload-root'),
    targetDatabasePath: values.get('--target-db'),
    targetUploadRoot: values.get('--target-upload-root'),
    format,
  });
}

function renderText(receipt, mode) {
  return [
    `Result: ${receipt.status}`,
    `Mode: ${mode}`,
    `Upload rows: ${receipt.uploadRows}`,
    `Unique files: ${receipt.uniqueFiles}`,
    `Total bytes: ${receipt.totalBytes}`,
    `Parity digest: ${receipt.parityDigest}`,
    ...(receipt.copyProofDigest ? [`Copy proof digest: ${receipt.copyProofDigest}`] : []),
  ].join('\n');
}

export function runAttachmentCopyCommand(args, { quiescenceCapability } = {}) {
  const options = parseAttachmentCopyArgs(args);
  if (!quiescenceCapability) invalid('ATTACHMENT_PARITY_PROVIDER_AUTH_REQUIRED');
  const receipt = options.mode === 'apply'
    ? copyAndVerifyAttachments({ ...options, quiescenceCapability })
    : verifyAttachmentDatabaseParity({ ...options, quiescenceCapability });
  return Object.freeze({
    exitCode: 0,
    receipt,
    output: options.format === 'json'
      ? JSON.stringify(receipt)
      : renderText(receipt, options.mode),
  });
}

function lowDisclosureFailure(error) {
  if (error instanceof MigrationError) {
    return {
      exitCode: error.exitCode,
      output: JSON.stringify({
        status: 'ATTACHMENT_COPY_FAILED',
        code: error.code,
        result: error.result,
      }),
    };
  }
  return {
    exitCode: 10,
    output: JSON.stringify({
      status: 'ATTACHMENT_COPY_FAILED',
      code: 'ATTACHMENT_COPY_INTERNAL_ERROR',
      result: 'INTERNAL_ERROR',
    }),
  };
}

const invokedDirectly = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  try {
    const result = runAttachmentCopyCommand(process.argv.slice(2));
    process.stdout.write(result.output + '\n');
    process.exitCode = result.exitCode;
  } catch (error) {
    const failure = lowDisclosureFailure(error);
    process.stdout.write(failure.output + '\n');
    process.exitCode = failure.exitCode;
  }
}

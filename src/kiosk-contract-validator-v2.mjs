import { readFileSync } from 'node:fs';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { validateKioskCurrentRelationships } from './kiosk-contract-rules-v2.mjs';

function loadSchema(filename) {
  return JSON.parse(readFileSync(new URL(`../contracts/${filename}`, import.meta.url), 'utf8'));
}

const ajv = new Ajv2020({ allErrors: true, strict: true, ownProperties: true });
addFormats(ajv, { mode: 'full' });

const validateEventStructure = ajv.compile(loadSchema('kiosk-run-event.v2.schema.json'));
const validateCurrentStructure = ajv.compile(loadSchema('kiosk-current.v2.schema.json'));
const validateResultStructure = ajv.compile(loadSchema('kiosk-run-event-result.v2.schema.json'));

function escapePointer(value) {
  return String(value).replaceAll('~', '~0').replaceAll('/', '~1');
}

function schemaIssues(validate, value) {
  if (validate(value)) return [];
  return (validate.errors ?? []).map(error => ({
    code: 'KIOSK_SCHEMA_VALIDATION_ERROR',
    path: error.keyword === 'additionalProperties'
      ? `${error.instancePath}/${escapePointer(error.params.additionalProperty)}`
      : (error.instancePath || '/'),
    keyword: error.keyword,
  }));
}

function result(issues) {
  return { ok: issues.length === 0, issues };
}

export function validateKioskRunEvent(value) {
  return result(schemaIssues(validateEventStructure, value));
}

export function validateKioskCurrent(value) {
  const structuralIssues = schemaIssues(validateCurrentStructure, value);
  if (structuralIssues.length > 0) return result(structuralIssues);
  return validateKioskCurrentRelationships(value);
}

export function validateKioskRunEventResult(value) {
  return result(schemaIssues(validateResultStructure, value));
}

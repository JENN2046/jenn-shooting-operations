// WO-06D evidence is declarative metadata, never a deployment-config language.
// Contract: docs/operations/PRODUCTION_EVIDENCE_INPUT_BOUNDARY_V1.md
const DECLARED_SECRET_IDS = Object.freeze([
  'VIEWER_TOKEN', 'SUBMITTER_TOKEN', 'SCHEDULER_TOKEN', 'ADMIN_TOKEN',
]);

// Use a forbidden-character check, not a $-anchored whitelist: a final LF is
// forbidden too. No quoting, escapes, expansion, line folding or normalization.
// Letters/marks/numbers, ASCII space and this punctuation are the entire profile.
const NON_DECLARATIVE_CHARACTER = /[^\p{L}\p{M}\p{N} .,:;()/+_-]/u;
const CREDENTIAL_LABEL = /access_token|VIEWER_TOKEN|SUBMITTER_TOKEN|SCHEDULER_TOKEN|ADMIN_TOKEN|Bearer/iu;
const LEGACY_SECRET_SHAPE = /sk-[A-Za-z0-9_-]{16,}|replace-with-random-/iu;

function forbiddenText(text) {
  return NON_DECLARATIVE_CHARACTER.test(text)
    || CREDENTIAL_LABEL.test(text)
    || LEGACY_SECRET_SHAPE.test(text);
}

/**
 * Apply only to parsed manifest JSON alongside the strict schema and frozen
 * semantic bindings. This is not a general secret detector or shell/YAML parser.
 * Returns a boolean only; never returns offending text or derived secret values.
 */
export function containsForbiddenEvidenceInput(manifest) {
  function visit(value, path) {
    if (typeof value === 'string') {
      // The sole credential-name exception is the existing schema-bound
      // declaration. It cannot exempt a free-text snippet or a sibling value.
      if (path.length === 3 && path[0] === 'secrets'
          && Number.isInteger(path[1]) && path[1] >= 0 && path[1] < 4
          && path[2] === 'id' && DECLARED_SECRET_IDS.includes(value)) return false;
      return forbiddenText(value);
    }
    if (Array.isArray(value)) {
      return value.some((item, index) => visit(item, [...path, index]));
    }
    if (value && typeof value === 'object') {
      return Object.entries(value).some(([key, item]) =>
        forbiddenText(key) || visit(item, [...path, key]));
    }
    return false;
  }
  return visit(manifest, []);
}

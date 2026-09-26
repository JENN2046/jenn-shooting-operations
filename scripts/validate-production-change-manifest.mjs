import { readFile } from 'node:fs/promises';
import { createProductionChangeManifestValidator } from '../src/production-change-manifest-v1.mjs';
import { parseProductionManifestJson } from '../src/production-manifest-json-v1.mjs';

function reject(issues) {
  // Source-validation output uses fixed codes and a fixed root path only.
  // Schema instance paths can contain hostile keys; do not echo them to CI.
  const safeIssues = [...new Set(issues.map(issue => issue.code))]
    .map(code => ({ code, path: '/' }));
  console.error(JSON.stringify({ status: 'WO_06D_MANIFEST_INVALID', issues: safeIssues }));
  process.exitCode = 1;
}

try {
  // Read once as bytes. Parsing, evidence admission and digesting share exactly
  // this source; neither duplicate keys nor invalid UTF-8 may be discarded.
  const schema = parseProductionManifestJson(await readFile(
    new URL('../contracts/production-change-manifest.v1.schema.json', import.meta.url),
  ));
  const parsed = parseProductionManifestJson(await readFile(
    new URL('../docs/operations/production-change-manifest.v1.json', import.meta.url),
  ));
  if (!schema.ok || !parsed.ok) {
    reject(!schema.ok ? schema.issues : parsed.issues);
  } else {
    const manifest = parsed.value;
    const result = createProductionChangeManifestValidator(schema.value)(manifest);
    if (!result.ok) {
      reject(result.issues);
    } else {
      console.log(JSON.stringify({
        status: 'WO_06D_MANIFEST_VALID',
        manifestDigest: result.digest,
        authorizationPacket: manifest.authorizationPacket.status,
        deploymentAuthorizationRequest: manifest.currentState.deploymentAuthorizationRequest,
        deploymentGate: manifest.currentState.deploymentGate,
        requestableActionIds: manifest.authorizationPacket.requestableActionIds,
        blockingGateIds: manifest.authorizationPacket.blockingGateIds,
        deploymentBlockingGateIds: manifest.authorizationPacket.deploymentBlockingGateIds,
      }));
    }
  }
} catch {
  reject([{ code: 'MANIFEST_SOURCE_VALIDATION_ERROR' }]);
}

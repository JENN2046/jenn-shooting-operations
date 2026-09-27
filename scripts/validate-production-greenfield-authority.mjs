import { readFile } from 'node:fs/promises';
import { createProductionChangeManifestValidator } from '../src/production-change-manifest-v1.mjs';
import { validateProductionGreenfieldAuthority } from '../src/production-greenfield-authority-v1.mjs';
import { parseProductionManifestJson } from '../src/production-manifest-json-v1.mjs';

function reject(code) {
  console.error(JSON.stringify({
    status: 'WO_06D_GREENFIELD_AUTHORITY_INVALID',
    issues: [{ code, path: '/' }],
  }));
  process.exitCode = 1;
}

try {
  const [schemaBytes, manifestBytes, greenfieldBytes] = await Promise.all([
    readFile(new URL('../contracts/production-change-manifest.v1.schema.json', import.meta.url)),
    readFile(new URL('../docs/operations/production-change-manifest.v1.json', import.meta.url)),
    readFile(new URL('../docs/operations/production-greenfield-authority.v1.json', import.meta.url)),
  ]);
  const schema = parseProductionManifestJson(schemaBytes);
  const manifest = parseProductionManifestJson(manifestBytes);
  const greenfield = parseProductionManifestJson(greenfieldBytes);
  if (!schema.ok || !manifest.ok || !greenfield.ok) {
    reject('GREENFIELD_SOURCE_VALIDATION_ERROR');
  } else {
    const baseResult = createProductionChangeManifestValidator(schema.value)(manifest.value);
    if (!baseResult.ok) {
      reject('BASE_MANIFEST_INVALID');
    } else {
      const result = validateProductionGreenfieldAuthority(greenfield.value, {
        baseManifest: manifest.value,
      });
      if (!result.ok) {
        reject(result.issues[0]?.code ?? 'GREENFIELD_AUTHORITY_INVALID');
      } else {
        console.log(JSON.stringify({
          status: 'WO_06D_GREENFIELD_AUTHORITY_VALID',
          authorityDigest: result.digest,
          baseManifestDigest: baseResult.digest,
          deploymentMode: greenfield.value.deploymentMode,
          instanceId: greenfield.value.target.instanceId,
          completedAcceptanceIds: greenfield.value.completedAcceptanceIds,
          authorization: greenfield.value.authorization.status,
          requestableActionIds: greenfield.value.authorization.requestableActionIds,
          nextActionId: greenfield.value.authorization.nextActionId,
        }));
      }
    }
  }
} catch {
  reject('GREENFIELD_SOURCE_VALIDATION_ERROR');
}

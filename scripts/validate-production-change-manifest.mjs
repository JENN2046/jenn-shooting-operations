import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import { createProductionChangeManifestValidator } from '../src/production-change-manifest-v1.mjs';

const schema = JSON.parse(await readFile(new URL('../contracts/production-change-manifest.v1.schema.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('../docs/operations/production-change-manifest.v1.json', import.meta.url), 'utf8'));

const result = createProductionChangeManifestValidator(schema)(manifest);
if (!result.ok) {
  console.error(JSON.stringify({ status: 'WO_06D_MANIFEST_INVALID', issues: result.issues }));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    status: 'WO_06D_MANIFEST_VALID',
    manifestDigest: result.digest,
    authorizationPacket: manifest.authorizationPacket.status,
    deploymentAuthorizationRequest: manifest.currentState.deploymentAuthorizationRequest,
    deploymentGate: manifest.currentState.deploymentGate,
    requestableActionIds: manifest.authorizationPacket.requestableActionIds,
    blockingGateIds: manifest.authorizationPacket.blockingGateIds,
  }));
}

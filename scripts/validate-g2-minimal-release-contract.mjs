import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { MIGRATIONS } from '../src/sqlite-schema-v2.mjs';
import { parseProductionManifestJson } from '../src/production-manifest-json-v1.mjs';

const CONTRACT_URL = new URL('../docs/operations/g2-minimal-release-contract.v1.json', import.meta.url);
const CONTRACT_SCHEMA_URL = new URL('../contracts/g2-minimal-release-contract.v1.schema.json', import.meta.url);
const G3_PACKET_SCHEMA_URL = new URL('../contracts/g3-schema11-cutover-packet.v1.schema.json', import.meta.url);

function fail(code) {
  console.error(JSON.stringify({ status: 'G2_MINIMAL_RELEASE_CONTRACT_INVALID', code }));
  process.exitCode = 1;
}

function parse(bytes) {
  const parsed = parseProductionManifestJson(bytes);
  if (!parsed.ok) throw new Error('SOURCE_INVALID');
  return parsed.value;
}

try {
  const [contractBytes, contractSchemaBytes, packetSchemaBytes] = await Promise.all([
    readFile(CONTRACT_URL),
    readFile(CONTRACT_SCHEMA_URL),
    readFile(G3_PACKET_SCHEMA_URL),
  ]);
  const contract = parse(contractBytes);
  const contractSchema = parse(contractSchemaBytes);
  const packetSchema = parse(packetSchemaBytes);

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validateContract = ajv.compile(contractSchema);
  ajv.compile(packetSchema);

  if (!validateContract(contract)) {
    fail('SCHEMA_VALIDATION_FAILED');
  } else {
    const migration = MIGRATIONS.find(item => item.version === 11);
    const ids = contract.invariants.map(item => item.id);
    const expectedIds = [
      'G2_I1_DURABLE_WRITER_CONTAINMENT',
      'G2_I2_EXACT_ARTIFACT_BINDING',
      'G2_I3_VERIFIED_PRESTATE_RECOVERY',
      'G2_I4_EXPLICIT_CUTOVER_ENTRY',
      'G2_I5_TERMINAL_OUTCOME_MODEL',
      'G2_I6_UNKNOWN_BLOCKS_READMISSION',
    ];
    if (!migration
      || migration.name !== contract.transition.migrationName
      || migration.checksum !== contract.transition.migrationChecksum
      || JSON.stringify(ids) !== JSON.stringify(expectedIds)
      || contract.authority.productionMutationAuthorized !== false
      || contract.authority.schema11CutoverAuthorized !== false
      || contract.currentPacketStatus !== 'NOT_CREATED'
      || contract.nextGate !== 'G3_SCHEMA11_CUTOVER') {
      fail('SEMANTIC_INVARIANT_FAILED');
    } else {
      console.log(JSON.stringify({
        status: 'G2_MINIMAL_RELEASE_CONTRACT_VALID',
        contractDigest: `sha256:${createHash('sha256').update(contractBytes).digest('hex')}`,
        authorityBase: contract.authority.g1MergeCommit,
        transition: `${contract.transition.sourceSchemaVersion}->${contract.transition.targetSchemaVersion}`,
        migrationChecksum: contract.transition.migrationChecksum,
        invariantCount: contract.invariants.length,
        productionMutationAuthorized: false,
        schema11CutoverAuthorized: false,
        currentPacketStatus: contract.currentPacketStatus,
        nextGate: contract.nextGate,
      }));
    }
  }
} catch {
  fail('SOURCE_OR_SCHEMA_ERROR');
}

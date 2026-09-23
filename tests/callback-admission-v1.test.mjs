import assert from 'node:assert/strict';
import test from 'node:test';

import { createTrustedPrincipal } from '../src/authorization-v2.mjs';
import {
  CALLBACK_ENABLED_ACTIONS_V1,
  createDingTalkCallbackAdmissionV1,
  digestVerifiedCallbackV1,
} from '../src/callback-admission-v1.mjs';
import {
  createCallbackNonceDigestV1,
  createEmptyCallbackActionRegistryV1,
  createFakeCallbackReplayStoreV1,
  createUnconfiguredCallbackPrincipalMapperV1,
  createUnconfiguredCallbackReplayStoreV1,
  createUnconfiguredCallbackVerifierV1,
} from '../src/callback-ports-v1.mjs';

const receivedAt = '2026-09-25T09:00:00.000Z';
const requestHeaders = Object.freeze([
  Object.freeze(['content-type', 'application/json']),
  Object.freeze(['x-provider-signature', 'fixture-signature']),
]);
const callback = Object.freeze({
  callbackId: 'CALLBACK-0001',
  actionId: 'fixture.complete',
  cardTemplateId: 'production-run.completed.v1',
  providerCardRef: 'CARD-REF-1',
  aggregateType: 'production_run',
  aggregateId: 'RUN-0001',
  revisionScope: 'run',
  expectedRevision: 4,
});

function encode(value = callback) {
  return new TextEncoder().encode(JSON.stringify(value));
}

function principal() {
  const created = createTrustedPrincipal({
    subjectId: 'USER-OPERATOR-01',
    role: 'operator',
    resourceIds: ['STUDIO-A'],
  });
  assert.equal(created.ok, true);
  return created.principal;
}

function configuredVerifier(overrides = {}) {
  return Object.freeze({
    readiness: () => Object.freeze({ ok: true }),
    verify: async ({ rawBody }) => Object.freeze({
      ok: true,
      code: 'CALLBACK_VERIFIED',
      plaintext: new TextDecoder().decode(rawBody),
      nonceDigest: createCallbackNonceDigestV1('fixture-nonce'),
      providerPrincipalRef: 'PROVIDER-USER-1',
      ...overrides,
    }),
  });
}

function configuredMapper(mappedPrincipal = principal()) {
  return Object.freeze({
    readiness: () => Object.freeze({ ok: true }),
    mapPrincipal: async () => Object.freeze({
      ok: true,
      code: 'CALLBACK_PRINCIPAL_MAPPED',
      principal: mappedPrincipal,
    }),
  });
}

function configuredRegistry({ known = true } = {}) {
  return Object.freeze({
    readiness: () => Object.freeze({ ok: true }),
    resolveAction: async input => known
      ? Object.freeze({
          ok: true,
          code: 'CALLBACK_ACTION_RESOLVED',
          action: Object.freeze({
            actionId: input.actionId,
            cardTemplateId: input.cardTemplateId,
            providerCardRef: input.providerCardRef,
            aggregateType: 'production_run',
            aggregateId: input.aggregateId,
            revisionScope: 'run',
            expectedRevision: input.expectedRevision,
            requiredCapability: 'submitRunEvent',
            resourceId: 'STUDIO-A',
          }),
        })
      : Object.freeze({ ok: false, code: 'CALLBACK_ACTION_NOT_ALLOWED' }),
  });
}

function request(rawBody = encode(), headers = requestHeaders) {
  return Object.freeze({ rawBody, headers, receivedAt });
}

function admission(overrides = {}) {
  return createDingTalkCallbackAdmissionV1({
    verifier: configuredVerifier(),
    principalMapper: configuredMapper(),
    actionRegistry: configuredRegistry(),
    replayStore: createFakeCallbackReplayStoreV1(),
    enabledActions: ['fixture.complete'],
    ...overrides,
  });
}

test('runtime-facing ports and the frozen action allowlist fail closed when unwired', async () => {
  assert.deepEqual(CALLBACK_ENABLED_ACTIONS_V1, []);
  assert.equal(Object.isFrozen(CALLBACK_ENABLED_ACTIONS_V1), true);

  const verifier = createUnconfiguredCallbackVerifierV1();
  const mapper = createUnconfiguredCallbackPrincipalMapperV1();
  const registry = createEmptyCallbackActionRegistryV1();
  const replay = createUnconfiguredCallbackReplayStoreV1();
  for (const port of [verifier, mapper, registry, replay]) {
    assert.deepEqual(port.readiness(), { ok: false, code: 'CALLBACK_NOT_CONFIGURED' });
  }
  assert.deepEqual(await verifier.verify({}), { ok: false, code: 'CALLBACK_NOT_CONFIGURED' });
  assert.deepEqual(await mapper.mapPrincipal({}), { ok: false, code: 'CALLBACK_NOT_CONFIGURED' });
  assert.deepEqual(await registry.resolveAction({}), { ok: false, code: 'CALLBACK_NOT_CONFIGURED' });
  assert.deepEqual(await replay.claim({}), { ok: false, code: 'CALLBACK_NOT_CONFIGURED' });

  const admit = createDingTalkCallbackAdmissionV1();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('network forbidden'); };
  try {
    assert.deepEqual(await admit(request()), { ok: false, code: 'CALLBACK_NOT_CONFIGURED' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('raw request gates reject size, content type, and duplicate normalized headers before verifier', async () => {
  let calls = 0;
  const verifier = configuredVerifier();
  const admit = admission({
    verifier: Object.freeze({
      readiness: verifier.readiness,
      verify: async input => { calls += 1; return verifier.verify(input); },
    }),
  });
  const cases = [
    request(new Uint8Array(65_537)),
    request(encode(), [['content-type', 'text/plain']]),
    request(encode(), [['content-type', 'application/json'], ['Content-Type', 'application/json']]),
    request(encode(), [['content-type', 'application/json'], ['x-provider-signature', 'a'], ['X-Provider-Signature', 'b']]),
    Object.freeze({ rawBody: 'not-bytes', headers: requestHeaders, receivedAt }),
  ];
  for (const input of cases) {
    assert.deepEqual(await admit(input), { ok: false, code: 'CALLBACK_REQUEST_INVALID' });
  }
  assert.equal(calls, 0);
});

test('forged and expired callbacks fail at the verifier boundary with stable codes', async () => {
  for (const code of ['CALLBACK_SIGNATURE_INVALID', 'CALLBACK_TIMESTAMP_EXPIRED']) {
    const admit = admission({
      verifier: Object.freeze({
        readiness: () => Object.freeze({ ok: true }),
        verify: async () => Object.freeze({ ok: false, code }),
      }),
    });
    assert.deepEqual(await admit(request()), { ok: false, code });
  }
});

test('verified plaintext uses duplicate-key rejecting exact-schema parsing', async () => {
  let mapped = false;
  const plaintext = '{"callbackId":"CALLBACK-1","callbackId":"CALLBACK-2","actionId":"fixture.complete","cardTemplateId":"production-run.completed.v1","providerCardRef":"CARD-1","aggregateType":"production_run","aggregateId":"RUN-1","revisionScope":"run","expectedRevision":4}';
  const admit = admission({
    verifier: configuredVerifier({ plaintext }),
    principalMapper: Object.freeze({
      readiness: () => Object.freeze({ ok: true }),
      mapPrincipal: async () => { mapped = true; return { ok: false, code: 'CALLBACK_PRINCIPAL_UNKNOWN' }; },
    }),
  });
  assert.deepEqual(await admit(request()), { ok: false, code: 'CALLBACK_DUPLICATE_KEY' });
  assert.equal(mapped, false);

  const nestedDuplicate = `{"callbackId":"CALLBACK-1","actionId":"fixture.complete","cardTemplateId":"production-run.completed.v1","providerCardRef":"CARD-1","aggregateType":"production_run","aggregateId":"RUN-1","revisionScope":"run","expectedRevision":4,"unknown":{"x":1,"x":2}}`;
  assert.deepEqual(await admission({
    verifier: configuredVerifier({ plaintext: nestedDuplicate }),
  })(request()), { ok: false, code: 'CALLBACK_DUPLICATE_KEY' });

  for (const value of [
    { ...callback, unknown: true },
    { ...callback, expectedRevision: -1 },
    { ...callback, providerCardRef: 'bad\nref' },
  ]) {
    assert.deepEqual(await admission({ verifier: configuredVerifier({ plaintext: JSON.stringify(value) }) })(request()), {
      ok: false,
      code: 'CALLBACK_PAYLOAD_INVALID',
    });
  }
});

test('malformed or extended verifier results collapse to protocol error without leaking fields', async () => {
  for (const verified of [
    null,
    { ok: true, code: 'CALLBACK_VERIFIED' },
    {
      ok: true,
      code: 'CALLBACK_VERIFIED',
      plaintext: JSON.stringify(callback),
      nonceDigest: createCallbackNonceDigestV1('fixture-nonce'),
      providerPrincipalRef: 'PROVIDER-USER-1',
      role: 'administrator',
    },
    { ok: false, code: 'CALLBACK_SIGNATURE_INVALID', message: 'raw provider response' },
  ]) {
    const admit = admission({
      verifier: Object.freeze({
        readiness: () => Object.freeze({ ok: true }),
        verify: async () => verified,
      }),
    });
    assert.deepEqual(await admit(request()), {
      ok: false,
      code: 'CALLBACK_VERIFIER_PROTOCOL_ERROR',
    });
  }

  const admit = admission({
    verifier: Object.freeze({
      readiness: () => Object.freeze({ ok: true }),
      verify: async () => { throw new Error('token and raw callback'); },
    }),
  });
  assert.deepEqual(await admit(request()), {
    ok: false,
    code: 'CALLBACK_VERIFIER_PROTOCOL_ERROR',
  });
});

test('unknown principal/role and unknown action fail closed before replay storage', async () => {
  let claims = 0;
  const replayStore = Object.freeze({
    readiness: () => Object.freeze({ ok: true }),
    claim: async () => { claims += 1; return { ok: true, code: 'CALLBACK_REPLAY_CLAIMED' }; },
    storeReceipt: async () => ({ ok: true, code: 'CALLBACK_RECEIPT_STORED' }),
  });
  const unknownPrincipal = admission({
    principalMapper: Object.freeze({
      readiness: () => Object.freeze({ ok: true }),
      mapPrincipal: async () => Object.freeze({ ok: false, code: 'CALLBACK_PRINCIPAL_UNKNOWN' }),
    }),
    replayStore,
  });
  assert.deepEqual(await unknownPrincipal(request()), { ok: false, code: 'CALLBACK_PRINCIPAL_UNKNOWN' });

  const invalidRole = admission({
    principalMapper: configuredMapper({ ...principal(), role: 'owner' }),
    replayStore,
  });
  assert.deepEqual(await invalidRole(request()), { ok: false, code: 'CALLBACK_PRINCIPAL_UNKNOWN' });

  const unknownAction = admission({ actionRegistry: configuredRegistry({ known: false }), replayStore });
  assert.deepEqual(await unknownAction(request()), { ok: false, code: 'CALLBACK_ACTION_NOT_ALLOWED' });
  assert.equal(claims, 0);
});

test('the frozen empty allowlist rejects before principal mapping, registry, or replay', async () => {
  const calls = {
    mapper: 0,
    registryReadiness: 0,
    registry: 0,
    replayReadiness: 0,
    replay: 0,
  };
  const admit = createDingTalkCallbackAdmissionV1({
    verifier: configuredVerifier(),
    principalMapper: Object.freeze({
      readiness: () => Object.freeze({ ok: true }),
      mapPrincipal: async () => { calls.mapper += 1; return configuredMapper().mapPrincipal({}); },
    }),
    actionRegistry: Object.freeze({
      readiness: () => { calls.registryReadiness += 1; return Object.freeze({ ok: true }); },
      resolveAction: async () => { calls.registry += 1; return configuredRegistry().resolveAction(callback); },
    }),
    replayStore: Object.freeze({
      readiness: () => { calls.replayReadiness += 1; return Object.freeze({ ok: true }); },
      claim: async () => { calls.replay += 1; return { ok: false, code: 'CALLBACK_NONCE_REPLAY' }; },
      storeReceipt: async () => ({ ok: true, code: 'CALLBACK_RECEIPT_STORED' }),
    }),
  });
  assert.deepEqual(await admit(request()), {
    ok: false,
    code: 'CALLBACK_ACTION_NOT_ALLOWED',
  });
  assert.deepEqual(calls, {
    mapper: 0,
    registryReadiness: 0,
    registry: 0,
    replayReadiness: 0,
    replay: 0,
  });
});

test('action resolution must bind the exact provider card, aggregate, and expected revision', async () => {
  const resolved = {
    actionId: callback.actionId,
    cardTemplateId: callback.cardTemplateId,
    providerCardRef: callback.providerCardRef,
    aggregateType: callback.aggregateType,
    aggregateId: callback.aggregateId,
    revisionScope: callback.revisionScope,
    expectedRevision: callback.expectedRevision,
    requiredCapability: 'submitRunEvent',
    resourceId: 'STUDIO-A',
  };
  let claims = 0;
  const replayStore = Object.freeze({
    readiness: () => Object.freeze({ ok: true }),
    claim: async () => { claims += 1; return { ok: true, code: 'CALLBACK_REPLAY_CLAIMED' }; },
    storeReceipt: async () => ({ ok: true, code: 'CALLBACK_RECEIPT_STORED' }),
  });

  for (const tampered of [
    { ...resolved, providerCardRef: 'CARD-REF-OTHER' },
    { ...resolved, aggregateType: 'schedule_item' },
    { ...resolved, aggregateId: 'RUN-OTHER' },
    { ...resolved, revisionScope: 'schedule' },
    { ...resolved, expectedRevision: callback.expectedRevision + 1 },
    { ...resolved, requiredCapability: 'administer' },
    { ...resolved, resourceId: 'STUDIO-B' },
  ]) {
    const admit = admission({
      replayStore,
      actionRegistry: Object.freeze({
        readiness: () => Object.freeze({ ok: true }),
        resolveAction: async () => Object.freeze({
          ok: true,
          code: 'CALLBACK_ACTION_RESOLVED',
          action: Object.freeze(tampered),
        }),
      }),
    });
    assert.deepEqual(await admit(request()), {
      ok: false,
      code: 'CALLBACK_ACTION_NOT_ALLOWED',
    });
  }
  assert.equal(claims, 0);
});

test('authorization uses the registry-bound resource and snapshots a mutable mapped principal', async () => {
  let claims = 0;
  const trusted = principal();
  const mutablePrincipal = {
    subjectId: trusted.subjectId,
    role: trusted.role,
    capabilities: { ...trusted.capabilities },
    resourceIds: [...trusted.resourceIds],
  };
  const actionRegistry = configuredRegistry();
  const admit = admission({
    principalMapper: configuredMapper(mutablePrincipal),
    actionRegistry: Object.freeze({
      readiness: actionRegistry.readiness,
      resolveAction: async input => {
        const action = await actionRegistry.resolveAction(input);
        mutablePrincipal.capabilities.submitRunEvent = false;
        mutablePrincipal.resourceIds.length = 0;
        return action;
      },
    }),
    replayStore: Object.freeze({
      readiness: () => Object.freeze({ ok: true }),
      claim: async () => { claims += 1; return { ok: false, code: 'CALLBACK_NONCE_REPLAY' }; },
      storeReceipt: async () => ({ ok: true, code: 'CALLBACK_RECEIPT_STORED' }),
    }),
  });
  assert.deepEqual(await admit(request()), { ok: false, code: 'CALLBACK_NONCE_REPLAY' });
  assert.equal(claims, 1);

  const denied = admission({
    actionRegistry: Object.freeze({
      readiness: () => Object.freeze({ ok: true }),
      resolveAction: async input => Object.freeze({
        ok: true,
        code: 'CALLBACK_ACTION_RESOLVED',
        action: Object.freeze({
          actionId: input.actionId,
          cardTemplateId: input.cardTemplateId,
          providerCardRef: input.providerCardRef,
          aggregateType: input.aggregateType,
          aggregateId: input.aggregateId,
          revisionScope: input.revisionScope,
          expectedRevision: input.expectedRevision,
          requiredCapability: 'submitRunEvent',
          resourceId: 'STUDIO-B',
        }),
      }),
    }),
  });
  assert.deepEqual(await denied(request()), {
    ok: false,
    code: 'CALLBACK_ACTION_NOT_ALLOWED',
  });
});

test('fake replay store rejects nonce reuse with a different callback digest', async () => {
  const nonceDigest = createCallbackNonceDigestV1('fixture-nonce');
  const replayStore = createFakeCallbackReplayStoreV1({
    entries: [{
      nonceDigest,
      callbackDigest: digestVerifiedCallbackV1('different verified callback'),
      receipt: Object.freeze({ code: 'CALLBACK_REJECTED' }),
    }],
  });
  assert.deepEqual(await admission({ replayStore })(request()), {
    ok: false,
    code: 'CALLBACK_NONCE_REPLAY',
  });
});

test('fake replay store returns only the original minimal receipt for an exact replay', async () => {
  const plaintext = JSON.stringify(callback);
  const receipt = Object.freeze({ code: 'CALLBACK_ACTION_NOT_WIRED' });
  const replayStore = createFakeCallbackReplayStoreV1({
    entries: [{
      nonceDigest: createCallbackNonceDigestV1('fixture-nonce'),
      callbackDigest: digestVerifiedCallbackV1(plaintext),
      receipt,
    }],
  });
  assert.deepEqual(await admission({ replayStore })(request()), {
    ok: true,
    code: 'CALLBACK_REPLAYED',
    receipt,
  });
});

test('raw bytes reach only the verifier; downstream ports receive reduced trusted data', async () => {
  const rawBody = encode();
  const seen = {};
  const verifier = configuredVerifier();
  const admit = admission({
    verifier: Object.freeze({
      readiness: verifier.readiness,
      verify: async input => { seen.verifier = input; return verifier.verify(input); },
    }),
    principalMapper: Object.freeze({
      readiness: () => Object.freeze({ ok: true }),
      mapPrincipal: async input => { seen.mapper = input; return configuredMapper().mapPrincipal(input); },
    }),
    actionRegistry: Object.freeze({
      readiness: () => Object.freeze({ ok: true }),
      resolveAction: async input => { seen.registry = input; return configuredRegistry().resolveAction(input); },
    }),
    replayStore: Object.freeze({
      readiness: () => Object.freeze({ ok: true }),
      claim: async input => { seen.replay = input; return { ok: false, code: 'CALLBACK_NONCE_REPLAY' }; },
      storeReceipt: async () => ({ ok: true, code: 'CALLBACK_RECEIPT_STORED' }),
    }),
  });

  assert.deepEqual(await admit(request(rawBody)), { ok: false, code: 'CALLBACK_NONCE_REPLAY' });
  assert.equal(seen.verifier.rawBody, rawBody);
  assert.deepEqual(Object.keys(seen.mapper), ['providerPrincipalRef']);
  assert.deepEqual(Object.keys(seen.registry), [
    'actionId',
    'cardTemplateId',
    'providerCardRef',
    'aggregateType',
    'aggregateId',
    'revisionScope',
    'expectedRevision',
  ]);
  assert.deepEqual(Object.keys(seen.replay).sort(), ['callbackDigest', 'nonceDigest']);
  assert.equal(JSON.stringify([seen.mapper, seen.registry, seen.replay]).includes('fixture-signature'), false);
  assert.equal(JSON.stringify([seen.mapper, seen.registry, seen.replay]).includes(JSON.stringify(callback)), false);
});

test('a newly claimed callback remains locally NOT_WIRED and never calls a domain command', async () => {
  assert.deepEqual(await admission()(request()), {
    ok: false,
    code: 'CALLBACK_ACTION_NOT_WIRED',
  });
});

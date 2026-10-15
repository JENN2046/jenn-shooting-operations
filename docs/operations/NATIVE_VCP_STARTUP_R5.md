# Native VCP conversation startup acceptance R5

R5 is a local candidate contract for the existing trusted administrator installation
mechanism. It is not a production authorization, a new credential system, or a general
integration permission. Existing R3/R4 records keep their schema and runtime-digest
semantics; their `integrations: disabled` cannot mount a conversation boundary.

R5 uses `g3-forward-reconciliation-exception.r5.schema.json`, schema12, purpose
`CORE_SCHEMA12_NATIVE_VCP_CONVERSATION_ACCEPTANCE`, and the single integration value
`native-vcp-conversation-v1`. The existing target/file identity, source digest,
owner material, installation binding, backup/restore and activation checks all apply.
No R4 record is converted automatically. A new release changes the source digest;
old release pins must not be rewritten merely to make startup pass.

Use `runtimeConfigDigest(env, 5)` for R5. It includes the existing runtime fields,
the exact `JSO_AGENT_IDENTITIES_JSON` string and the fixed conversation composition.
Owner identities remain covered by `JSO_BUSINESS_IDENTITIES_JSON`. Only the digest
belongs in acceptance materials; never place raw identity/token configuration there.
Formatting changes to identity JSON also require re-binding. R3/R4 continue using the
previous digest algorithm. No live credentials are provided by this document.

PREPARED runs the ordinary core entry with write admission disabled, without the
conversation factory. It cannot attach conversation or Kiosk online runtime, and
cannot enable writes. ACTIVE must use `src/server-conversation.mjs`, or the equivalent
reviewed `conversationFactoryFromEnv` plus `createBusinessRuntimeOptionsFromEnv`
composition. It rejects omitted, replaced or stale factories/authenticators before
opening the store. This check binds the actual closures, not caller-provided metadata.
ACTIVE R5 cannot attach Kiosk online runtime. No new grant or identity is issued;
the existing per-command owner delegation remains required.
The conversation factory rejects preconfigured nonempty `grants` in agent identities;
omit `grants` or use an empty array. Static grants supported by other agent compositions
cannot substitute for live owner delegation in R5.
Agent credentials must also be distinct from business identities and the legacy
`SCHEDULER_TOKEN`/`ADMIN_TOKEN`, so the schema11 composition cannot bypass delegation
through the legacy snapshot endpoint.
Outside R5, when online Kiosk is enabled alongside conversation, its identities are
validated and their tokens must also be distinct from every agent credential.
Conversation and the legacy Basic-auth kiosk are not a supported composition.
A nonblank `KIOSK_AUTH_CONFIG_PATH` rejects conversation startup before reading
the password file; direct server composition also rejects a legacy kiosk
authenticator alongside a conversation factory before opening the store.
Run the legacy kiosk separately; no password collision scanning is added.

The JSO boundary is HTTP behind the trusted ToolBox connection. R5 does not independently
prove that a remote client used a physical keypress or WebSocket: the reviewed
Chat/ToolBox strict WS binding and production reverse-proxy reachability controls
remain required deployment checks. Call-policy behavior is pinned by the source
release, while ToolBox settings and its release must be included in the deployment
packet. R5 does not enable notifications, sync, other integrations, or session-token
persistence in the client.

Tests use synthetic materials and isolated stores only. The new test file covers
R4 denial, R5 PREPARED read-only behavior, real factory/authenticator binding,
configuration drift, missing/revoked materials, other-integration rejection and two
independent-process same-target ACTIVE startups. Existing conversation tests cover
confirmation binding and receipt recovery; they do not repeat the accepted human
operation. Real root-owned custody/default-path evidence is reported separately from
fixtures that relocate custody for testing.

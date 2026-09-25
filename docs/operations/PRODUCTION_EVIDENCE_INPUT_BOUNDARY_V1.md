# Production Evidence Input Boundary V1

Status: implementation contract for WO-06D / PR #16. This defines input admission, not production authorization or completed CI/review.

## Outcome and scope

Production-change JSON records exact actions, nonsecret evidence summaries and credential declarations. It is not a container for environment files, request headers, command lines, deployment snippets or credential values. Admission must neither guess what a second language evaluates to nor discard source members before inspecting their structure.

One boundary handles the five scanner findings: 4104724822 (continued header), 4104786571 (append assignment), 4105069439 (plain-scalar backslash), 4105112228 (continued key), and 4105165136 (split name/value entry). Its raw-source layer also rejects duplicate JSON properties, including a credential-bearing first member hidden by a later canonical member. Target-wide cutover write-fence findings are separate and remain open.

## Reuse and decision

Reuse the existing strict JSON schema, `secrets[].id` declarations, exact authority bindings, validation command, and exact-head workflow. The schema continues to forbid secret values and fixes `valuePresent`, `repositoryAllowed` and `logsAllowed` to false.

Reuse `parseCallbackJsonRejectingDuplicateKeysV1` from `src/callback-json-v1.mjs` unchanged. Its historical name does not make it callback execution: it is a pure JSON parser with no provider, file, network, authorization or configuration dependency. It detects decoded-key duplicates per object before assignment, uses null-prototype objects, limits nesting to 64 and delegates only isolated string tokens to native JSON parsing. No whole object is first parsed with last-member-wins behavior. Add only a small manifest-source adapter for byte admission and fixed failure results; do not fork the parser or change callback behavior.

The partial shell/config parsers and header length heuristic have been replaced by one declarative-text profile. Do not add a YAML dependency, shell interpreter, config importer, secret store, second authorization system or another name/value special case.

## Mandatory admission layers

1. **Raw JSON source integrity.** `parseProductionManifestJson` accepts the original string or UTF-8 bytes, not an already parsed object. Input is limited to 1 MiB; byte input is decoded fatally, without replacing invalid UTF-8 or stripping a BOM. Each object rejects repeated decoded property names, even equal-valued duplicates, at any nesting level. Escaped and literal spellings of the same key collide. Same-spelled keys in different objects remain valid. Malformed JSON, trailing tokens, excess nesting and duplicate properties fail before schema validation, evidence admission or hashing. No trimming, rewriting or repair is performed.
2. **Strict parsed-JSON schema.** Existing shapes, enums/constants and unknown-field rejection remain required. Source formatting between JSON tokens is not evidence text. Passing syntax admission alone does not validate a manifest or its schema.
3. **Declarative text profile.** Every decoded string value and object key contains only Unicode letters, marks and numbers, ASCII space, and `. , : ; ( ) / + _ -`. All other characters are rejected, including quotes, backslashes, equals signs, control characters, tabs and any line break, even a terminal newline within a string. There is no second-language decoding, trimming, normalization, concatenation or line joining that can turn rejected evidence into accepted evidence.
4. **Credential declarations only.** `access_token`, the four role-token names and `Bearer` are reserved case-insensitively anywhere in other strings, including substrings and object keys. The sole exception is an exact canonical role-token name at the real array path `secrets[index].id`, index 0 through 3, under the unchanged strict secret schema. A same-spelled path encoded as text does not create an exception. `access_token` is not a fifth declaration. Existing token-shaped/unsafe-placeholder checks remain additional defense.
5. **Frozen semantic bindings.** Lexically admitted text must still match exact authority, gate, action, evidence, revalidation and rollback contracts. A new summary is not true, requestable or authorized merely because it uses permitted characters. A digest is published by the source-validation command only after all layers succeed.

Credential-label rejection has no length threshold. Empty, short, placeholder, escaped and example assignments are forbidden in evidence too. These are intentional compatibility restrictions; the server authorizer and its runtime token rules are unchanged.

## One model for all reported examples

| Problem | Boundary that closes it |
| --- | --- |
| Continued header value | Header label and non-declarative characters are rejected, with no length or physical-line cutoff. |
| Shell append assignment | Embedded credential labels and equals syntax are forbidden independently of inherited value or appended length. |
| Plain YAML backslash | Backslash is outside the profile; no format-specific escape rule removes it. |
| Continued assignment key | Backslash/newline are forbidden even when the credential name is no longer contiguous. |
| Separate name and value | Credential-name use outside the declaration path is forbidden regardless of ordering, indentation or sibling association. Real extra objects/value fields fail schema validation. |
| Duplicate JSON members hide earlier content | The raw parser rejects the whole object before overwriting members. No successful verdict or digest can attest only to a last-value projection. |

Plain summaries such as `SECRET_STORAGE_PROOF`, `No credential values recorded`, source commit identifiers and permitted multilingual text remain usable where the authority allows them. Credential names belong only in their existing declarations. This profile governs decoded strings in the machine manifest, not Markdown syntax or inert synthetic test source.

## Data flow and authority

`original bytes -> strict UTF-8 -> duplicate-rejecting JSON -> strict schema -> declarative text -> exact semantic bindings -> stable manifest digest`

`src/production-manifest-json-v1.mjs` owns raw-source admission. `src/production-evidence-input-boundary-v1.mjs` owns decoded-text admission. The unchanged semantic validator owns the frozen authority comparison. The CLI `scripts/validate-production-change-manifest.mjs` reads both schema and manifest once as bytes, admits both through the raw parser, and validates/hashes the resulting manifest directly. It never reparses either file with native whole-object `JSON.parse` or re-reads a different version for hashing.

The lower-level `createProductionChangeManifestValidator` accepts parsed objects for application composition and semantic tests. It cannot establish source-file integrity or reconstruct discarded duplicates. Callers starting from files/text MUST use raw-source admission first; native JSON parsing followed by object validation is not a supported source attestation path. The schema itself goes through the same raw parser so duplicate schema members cannot be silently discarded either.

The raw adapter returns only `ok/value` on successful syntax admission or a fixed root-path issue on failure. It returns no partial object, original key, source fragment, parser exception or digest on failure. Codes are `MANIFEST_JSON_DUPLICATE_KEY`, `MANIFEST_JSON_INVALID`, and `MANIFEST_JSON_TOO_LARGE`.

The existing `SECRET_MATERIAL_DETECTED` compatibility code now covers forbidden credential material OR unsupported evidence syntax. It is not proof that a real credential was found. For schema-valid boundary rejection the object validator emits only that issue at `/`, before semantic diagnostics and digesting. Schema-invalid input remains schema-rejected. The CLI reduces all failure paths to fixed root-path codes, suppresses exceptions and input-derived schema paths, writes a single invalid verdict to stderr, emits no success output/digest, and exits nonzero. Read/compile failures use `MANIFEST_SOURCE_VALIDATION_ERROR`.

These components perform no production or provider action and evaluate no supplied shell/config text. Source reads are read-only. No rejected input is rewritten into an apparently valid artifact.

## Verification and compatibility migration

Retain the historical hostile fixture corpus. Former negative controls containing short or differently interpreted credential values are now explicit rejections under the narrower profile. Keep independent in-memory authorizer assertions where present: runtime behavior must not be rewritten to match this input policy. Do not remove long-value regressions or silently relax authority checks to make the suite pass.

`production-change-manifest-input-boundary.test.mjs` covers all five findings across gate evidence, action title, authority target and effect text, all token names/cases, old length boundaries, split locations, line breaks, flow/quoted layouts, empty append values, encoded/fragmented names, ASCII/Unicode controls, declaration-path isolation, immutability and no-value-echo rejection. Admitted plain text must still fail when it changes frozen authority.

`production-change-manifest-json-source.test.mjs` covers raw duplicate members at root/nested/array levels, equal-valued duplicates, escaped-equivalent and astral keys, independent object scopes, apparent keys inside strings, generated unique JSON, invalid syntax/encoding/BOM/depth/size, unchanged input and normal format/digest parity. The exact overwritten-credential counterexample is first shown to pass the old native-parse/object-validation path, then rejected by raw admission.

End-to-end tests execute the real CLI against an isolated temporary layout containing copied input files and script, with the actual source modules linked read-only. The checkout's authority files are never edited by these tests. Cases cover hidden duplicate secrets/authorization, duplicate schema keys, malformed input, missing input and hostile schema-error paths. Rejection must exit nonzero, emit no stdout, no source value and no digest. Ordinary unique-key input must retain the normal valid non-authorizing verdict. Synthetic shell snippets never execute.

Run the unchanged implementation exact-head CI. After success, synchronize both acceptance/work-order documents and run docs-only final-head CI. Reply and resolve the five scanner findings and raw-duplicate finding only after these stages, then request one independent final-head review. Automatic intermediate review observations do not justify one manual review trigger per syntax example. CI does not close unrelated cutover findings.

## Limits, failure handling and rollback

This is not a universal detector for unlabelled passwords, opaque encodings, encrypted material or covert channels. An alphanumeric identifier can also be a secret; lexical rules do not establish provenance. Frozen semantic values and source-grounded review remain independent controls. Future input formats require a reviewed boundary revision, not a local exception, discarded syntax or weaker test.

A rejection leaves the packet non-authorizing. Do not copy rejected material into another field, error, comment or log. Replace it with a nonsecret declaration/summary. Reverting raw admission reopens the duplicate-key finding; reverting declarative admission reopens the five scanner findings. Either requires review and fresh exact-head CI, not automatic fallback to a looser parser.

The machine manifest, schema, production actions/gates, dependencies, workflow permissions and requested/approved/requestable/derived-rollback arrays remain unchanged. This contract neither implements the separate target write fence nor authorizes deployment, real provider access, credential generation, migration, cutover or merge.

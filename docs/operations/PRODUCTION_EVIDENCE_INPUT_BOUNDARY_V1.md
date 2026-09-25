# Production Evidence Input Boundary V1

Status: implementation contract for WO-06D / PR #16. This document defines input admission, not production authorization or a claim of completed CI/review.

## Outcome and scope

Production-change JSON records exact actions, nonsecret evidence summaries and credential declarations. It is not a place to embed environment files, request headers, command lines, deployment snippets or credential values. Admission must not depend on guessing the value a second language might evaluate to.

This single boundary addresses review comments 4104724822 (continued header), 4104786571 (append assignment), 4105069439 (plain-scalar backslash), 4105112228 (continued key) and 4105165136 (split name/value entry). It also retains rejection of the earlier Unicode, quoting, concatenation, escaped-key and block-scalar fixtures. The target-wide cutover write-fence findings are separate and remain open.

## Reuse and decision

Reuse the existing strict JSON schema, `secrets[].id` declaration surface, exact authority bindings, issue code, validation command and exact-head workflow. The schema already prohibits secret values and freezes `valuePresent`, `repositoryAllowed` and `logsAllowed` to false. Do not add a secret store, config importer, YAML dependency, shell interpreter or another authorization mechanism.

Replace the two partial language parsers and assignment/header length heuristics with one declarative-text admission rule. A longer parser would preserve an unnecessarily broad input surface. A generic pattern scanner alone does not prove that arbitrary text is secret-free.

## Exact admitted input

The public validator applies the following layers, all required:

1. **Strict parsed-JSON schema.** Existing shapes, enum/constant values and unknown-field rejection remain unchanged. JSON file formatting between values is not evidence text.
2. **Declarative text profile.** Every decoded string value and object key contains only Unicode letters, marks and numbers, ASCII space, and the punctuation `. , : ; ( ) / + _ -`. All other characters are rejected. This excludes quotes, backslashes, equals signs, expansion/operator syntax, control characters, tabs and all physical line breaks, including a terminal newline. There is no trimming, concatenation, escape decoding, continuation joining or normalization that could turn a rejected value into an admitted one.
3. **Credential declarations only.** Literal `access_token`, the four role-token names, and `Bearer` are reserved case-insensitively wherever they occur in other strings, including a longer string or object key. The sole exception is an exact canonical role-token name at the real array path `secrets[index].id`, index 0 through 3, with the unchanged strict secret schema. A same-spelled path in a string or object key does not create an exception. `access_token` is not an additional allowed declaration.
4. **Frozen semantic bindings.** Admitted text must still match the current authority/gate/action/revalidation/rollback contracts. Passing the lexical profile does not make a new summary true, grant permission or make an action requestable.

Existing token-shaped and unsafe-placeholder detection is retained as additional defense. There is no credential-length threshold for the five declared/recognized token labels or header label. Short, empty, apparently escaped, placeholder and example assignments are also forbidden in manifest text. These are intentional compatibility restrictions, not an attempt to classify their runtime validity.

## Consequences for the five findings

| Finding | Shared boundary, not a new parser branch |
| --- | --- |
| Header value continued onto another physical line | Header label and non-declarative characters are rejected before any sizing or line splitting. |
| Shell append assignment | All embedded credential-name use outside declarations is rejected; equals syntax is independently outside the text profile. No inherited environment value needs to be known. |
| Backslash in a plain YAML scalar | Backslash is not admitted. No character is removed or counted using the wrong language's escape rules. |
| Continuation inside a variable name | Backslash and newline are rejected even when the literal credential label is no longer contiguous. No key reconstruction is needed. |
| Separate name and value fields | A literal credential name anywhere in the snippet is rejected. Quoted/flow/multiline representations are independently outside the profile. Actual extra objects/fields cannot evade the strict schema. No indentation or name/value association inference is needed. |

Plain summaries such as `SECRET_STORAGE_PROOF`, `No credential values recorded` and a source commit identifier remain possible where the authority permits them. Credential names belong in the existing declaration objects only. Describe a role in prose instead of pasting a credential-bearing command. This rule governs decoded strings in the machine manifest, not the syntax of Markdown documentation or the synthetic test corpus.

## Data and control flow

`JSON.parse -> strict schema -> input boundary -> exact semantic bindings -> stable manifest digest`

The pure boundary function performs no file/network/process access, evaluates no supplied text, mutates no input and returns only a boolean. The validator keeps `SECRET_MATERIAL_DETECTED` as its low-disclosure compatibility code for prohibited credential material **or unsupported evidence syntax**. It returns only that issue at `/` for a schema-valid boundary rejection, before emitting semantic paths or computing a digest. The code is not an assertion that a real credential was found. Schema-invalid input remains a schema rejection.

Only `src/production-evidence-input-boundary-v1.mjs` owns this text rule. The old shell/config length parsers and header threshold detector are removed rather than maintained as competing acceptance paths. The server authorizer is unchanged; its runtime acceptance condition does not determine which text may enter Git.

## Verification and compatibility migration

Retain every existing hostile fixture. Former negative controls which embedded a short or differently interpreted credential value are now explicit rejection cases. Keep their independent in-memory authorizer assertions where present, so runtime behavior is not rewritten to fit the new boundary. Do not erase a long-value regression or reinterpret a failed test as success.

The unified matrix must include all five review examples, all recognized names/case variants, values on both sides of the former length threshold, key/value split positions, LF/CRLF, quoted and flow layouts, append with empty/short values, escaped and literal Unicode, controls, terminal newlines, encoded/fragmented names, and combinations. Test all four free-text surfaces (gate evidence, action title, authority target, effect), schema rejection of real value fields, declaration-path exception isolation, input immutability and deterministic/no-value-echo rejection. Plain allowed text must not bypass semantic bindings.

Run the unchanged implementation exact-head CI first. Only after it passes, synchronize the two acceptance/work-order evidence files and run the docs-only final-head CI. Reply/resolve the five findings with both exact SHAs and evidence, then request one independent final-head review. Intermediate automatic reviews are observations, not a reason to trigger a separate review for each syntax example. CI success never closes unrelated findings.

## Limits and failure handling

This is not a universal detector for arbitrary unlabelled passwords, opaque encodings, encrypted data or covert channels. An alphanumeric string can be either an identifier or a secret; a lexical rule cannot establish its provenance. No arbitrary config decoder is supported or promised. Frozen semantic values, source-grounded review and the prohibition on storing credentials remain necessary independent controls. Future text or declaration formats require a reviewed boundary revision, not a local bypass, length exception or relaxed test.

A boundary rejection fails closed and has no production effects. Do not move rejected material into a different manifest field, force-approve it or place the value in an error/comment. Use a nonsecret declaration/summary instead. Reverting this change reopens the five findings and requires review; it does not authorize using the earlier looser scanner.

The machine manifest, schema, production action/gate bindings, dependencies, workflow permissions and all requested/approved/requestable/derived-rollback arrays are unchanged. No deployment, real provider, credential generation, migration, cutover, production write or merge is authorized by this contract.

# JSO candidate release preparation R1

Status: **LOCAL CANDIDATE FROZEN FOR REVIEW / NO PRODUCTION DEPLOYMENT**.

Authority was freshly verified as PR37 merge
`302c7224f92eab79989fe53d259056519ff1832d` on
`codex/v2-1-architecture-freeze`. Its GitHub workflow query returned zero runs;
PR37 source-head CI is historical evidence, not merge-SHA CI. Work uses a new local
clone on `jenn-System-Product-Name`, leaving existing checkouts/services untouched.
No repository AGENTS.md or .agents/skills were present. Runtime `CODEX_HOME` was
unset and no local memory summary was available; no memory was updated.

## Frozen source and image

```text
candidate source = 37ee97d5726d990e8f7178938eeb9b6c5f8b5424
source tree      = 7db893e73cf89ca3107c5a1a68cc25ce19094dd6
image ID / OCI manifest digest
                 = sha256:fd8a2fb03c86901e26c64389138bbc494491e8bf6025af1e22eec9e1f11113e7
OCI config       = sha256:59f489a623cb6d6cc007d8dd139584f039ad7ebb9c0578df02aa11cd382ac46a
diagnostic tag   = jenn-shooting-operations:prod-37ee97d5726d990e8f7178938eeb9b6c5f8b5424
platform         = linux/amd64
Node             = 24.21.0
base             = node@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
local image archive SHA256
                 = 86d9d5a1066776533aa47204b553463847cb7df583ab76416fd5c24e5db0582c
```

The diagnostic tag is local and has no execution authority. The image has not been
published or transported. Docker 29.8.1 on this host reports the OCI manifest as
its local image ID; the separate config digest is recorded explicitly for transport
and target-daemon verification. A future target must verify the approved image
binding, rather than assume all Docker versions expose the same ID convention.

The source commit includes the Dockerfile packaging repair, reproducible builder,
disposable fixture/schema/startup tools and the three proposals below. Final PR
evidence commits add only documents; they do not redefine the image source as PR
HEAD. The 112 runtime input files match that source byte-for-byte (aggregate SHA256
in the JSON). Rebuild/rebind if any image input changes. The builder archives exact
Git source, pins the base digest and SOURCE_DATE_EPOCH, disables variable provenance
attestations, refuses a differing existing diagnostic tag and records inputs/inspect
output. Two builds on the same existing local builder/cache returned the exact same
manifest digest. This is not a claim of independent uncached reproducibility.

```bash
bash scripts/build-local-release-candidate.sh \
  37ee97d5726d990e8f7178938eeb9b6c5f8b5424 \
  node@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 \
  /tmp/jso-new-candidate-evidence
```

The original authority-source image was investigated before this freeze and is
ineligible: Dockerfile omitted the authority JSON imported at startup. Bare startup
failed ERR_MODULE_NOT_FOUND. Only the corrected source/image above is proposed.
The historical d1fe85 image remains evidence only and never substitutes.

## Actual verification and limits

The machine-readable record is
[jso-candidate-release-evidence.r1.json](jso-candidate-release-evidence.r1.json).
It includes commands, counts, log hashes, fixture and schema evidence, and the
unchanged authority digest. Full raw logs and the 61 MiB image archive are preserved
in the task-local sibling `evidence/` directory, not committed binary artifacts.

- Merge source: targeted 284/284; Node 24.21.0 Debian full 897 tests, 896 pass,
  zero failures, one existing absent external-adapter skip.
- Candidate source: all four repository validators and full 897-test suite pass
  with the same one skip on pinned Node 24.21.0 Debian. Both declared migration
  recovery and external-readiness harnesses pass their **local** boundary criteria;
  external adapter, physical device, provider and deployment closure remain blocked.
- Candidate runtime: targeted safeguard count/outcome is recorded in the JSON.
  Tests use read-only exact-source test inputs; runtime code is supplied by the image.
- Actual Alpine full runtime check: 897 tests, 894 pass, **two failures**, one skip.
  Both inherited WAL-rewrite tests fail at BusyBox `touch -m -d @<nanosecond timestamp>`
  with `invalid date`, before completing the timestamp-restoration test setup.
  These are not suppressed or counted as PASS. No host settings/packages were changed
  to hide them; require review of this limit before deployment approval.
- Bare candidate, **no bind mounts**: actual server entrypoint starts twice on a
  disposable container-private loopback, health 200, Kiosk reads/writes 401
  `AUTH_NOT_CONFIGURED`, migration prefix 1–9, zero run events and smoke owners,
  same synthetic DB identity across process reopen. No host port/credential created.
- Candidate fixture/schema tools: new disposable single/grouped DBs materialize and
  return expected current/task bindings under a synthetic clock; v6 definitions
  match recorded old source, which rejects v7–v9. v9 ownership survives reopen and
  is undeletable. This is local source compatibility, not a production rollback test.

The first targeted image invocation omitted a JSON file used by the tests and failed
ENOENT. The corrected invocation mounts that exact non-runtime test-input contract
read-only. The bare startup test independently proves runtime packaging; test mounts
are never accepted as its substitute. No physical-device result is claimed.

## Reviewable contracts

1. [Replacement deployment and rollback proposal](../operations/JSO_CANDIDATE_REPLACEMENT_DEPLOYMENT_PROPOSAL_R1.md):
   separate approval, Kiosk disabled, production storage/fence/migration evidence,
   explicit v6→v9 old-image incompatibility and compatible-image/zero-fact restore limits.
2. [Isolated WO03 preparation proposal](WO03_ISOLATED_PREPARATION_PROPOSAL_R1.md):
   same-image test binding, actual local single/grouped fixture digests, proposed
   external setup scope, complete original matrix and pending exact device inputs.
3. [Post-smoke normal-operation contract proposal](../operations/KIOSK_POST_SMOKE_NORMAL_OPERATION_CONTRACT_PROPOSAL_R1.md):
   terminal smoke stays closed; separately reviewed normal-mode implementation,
   image/authority transition, finite validation budget, explicit operation release
   and same-compatible-image disable rollback. Candidate normal mode is not implemented.

None of these self-ratifies or closes live requestability. Both existing authority
files are unchanged. `nextActionId` remains GF15, status `FROZEN_NOT_REQUESTED`, and
requested/approved/requestable arrays remain empty. No production host/data/service,
external setup, credential, persistent access, device/profile, provider, registry,
GF15, PROD11 or merge effect occurred.

## Remaining inputs and separate work

Confirm tablet/iPad model/OS, exact Safari target, mobile device/browser/profile,
screen reader/version/settings and external keyboard plus studio environment.
Bind and approve external isolated endpoint/storage/auth/setup; this local fixture
work is not completed external WO03 setup. Production deployment needs fresh live
facts, VCP continuity, backup/fence evidence, compatible rollback/restore decision,
transport and separate action authorization. GF15 needs its own fresh Shanghai
window/packet. PROD11 still requires all frozen pre-request/revalidation and later
WO03 gates. Normal-use contract ratification, runtime implementation, tests and
explicit transition/release remain separate. No production-ready claim is made.

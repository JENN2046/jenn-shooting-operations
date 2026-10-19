# G3-05 R2 SSH executable review fix R1

Scope: PR #63 finding [discussion_r4236007536](https://github.com/JENN2046/jenn-shooting-operations/pull/63#discussion_r4236007536), raised against `65e56f8c020c24661b07f820a6c979a75ba7fabf`. This is an implementation correction within the approved R2 method, not a production acceptance or merge approval.

The collector previously launched bare `ssh`, so the approved Python runtime and command arguments did not identify the executable selected through the caller's PATH. It now requires the approved transport fields `sshExecutablePath` and `sshExecutableSha256`, accepts only `/usr/bin/ssh`, and verifies its bytes through bounded, no-symlink FD reads. The file and every parent, including `/`, must remain under root custody and cannot be group/other writable. The TRUSTED_HOST_ADMIN model still requires administrators to preserve these objects throughout the window; this check does not defend against a trusted root administrator replacing software.

The subprocess receives only `PATH=/usr/bin:/bin`, `LANG=C`, and `LC_ALL=C`. The exact environment is recorded in the immutable transport receipt and checked during independent replay, together with the approved executable and exact command. Missing old fields fail closed; an old R2 transcript cannot be silently upgraded to this contract. Existing R1 receipts and the R1 witness/signature verifier are unchanged.

The R2 evidence contract records both requirements and refreshed source hashes; its exception contract references the new evidence-contract digest. Production approval projects the complete transport object, so these fields must be bound in the future exact production package. There is no caller-selected executable fallback or new authority.

Validation is recorded in `docs/acceptance/g3-05-r2-ssh-executable-fix.r1.json`:

- 35 Python tests pass, including seven new defensive regression tests for the absolute executable, missing/wrong pins, custody failure including the root FD, explicit environment, transport receipt binding, and rejection before process launch.
- A fresh disposable KVM guest with ext4, Python 3.12.3 and SQLite 3.45.1 completed an authenticated SSH capture and a separate fresh replay. The caller's PATH pointed to a nonexistent directory. The receipt binds the actual executable and fixed environment. Synthetic databases and a lab-only approval were used.
- Guest preflight/protect/verify prepared that capture; they are not a repeat claim for the previous E1 failure matrix. Original protected synthetic objects were rechecked unchanged, with no temporary copy directories left.
- Raw evidence was independently retained and byte-verified before destroying the exact disposable VM, closing its loopback port, and removing its temporary keys and lab trust store.

The prior `g3-05-r2-isolated-validation.r1.json` and original receipts remain historical records of their exact source versions. Their unchanged E1/E3 implementation and previously tested protocol behavior remain relevant, but old SSH transport results are not presented as new-source E2 acceptance. The fresh capture/replay above supplies the changed transport evidence. No reconstruction experiment was repeated.

Method SHA-256 remains `e1acba51102404d87e756b0e6a502c6a9cd92bbe4a2136c0f6d8c41b19b6ffd0`. Historical WAL completeness and writer-window coverage remain `NOT_PROVEN`. G3-05 remains `BLOCKED`; production actions are zero. GitHub Codex review, CI, and merge authority must bind the new PR head separately; this document does not grant clean-review, merge, G3-06, writer, or service authority.

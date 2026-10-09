# G3-03 R1 coverage and scope

Authority: #59 issuecomment-6074360103. Owner authorized revised G3-03 task in the current execution session. Base: PR #56 @ 620136f322fddd194144ae90a44d833a40e15fff; canonical @ 371bf8982b0cd0df579b0e981964b27f9d0319fc. No production or G3-04 authority.

| Predicate | Evidence treatment | Reason / current execution |
| --- | --- | --- |
| Double immutable, old FD/helper, ordinary writer, partial installation | Inherit R1 44/44 | Exact unchanged R2 E1 tool; source DBs synthetic. No repeat of entire old suite. |
| Full parent symlink/inode/permission rejection | Inherit R2 F3 8/8 plus new witness tests | New actual FD traversal requires new local drift cases and integrated guest rejection. |
| SSH trust, nonce persistence, deadlines, terminal integrity | Inherit R1 25/25, R2 F1/F2 17/17, independent replay 5/5 | Reuse R2 transport/ledger; new integrated real SSH success/expiry/loss and strict readback validate added witness binding. Record-copy negatives remain labelled. |
| E3 WAL 2/2, original bytes/header/hash, O_NOATIME, sidecars | New execution | 12 new unittest methods plus 12 existing semantic regression tests; actual ext4 immutable WAL captures through SSH. |
| Reboot/crash continuity with new witness | New execution | Same exact two original guest inodes; fresh integrated captures following guest reboot and owned QEMU crash/restart. |
| Application semantic scope and G2/G3 hard gates | Existing tests and static unchanged semantic functions | No production samples; synthetic profile does not assert exact production 40/42 data admission. |
| Optional Ed25519 envelope chain | DEFER | Not selected for this SSH profile. Remains 1/1-only; no 2/2 signature compatibility claim. |

R1 archive SHA256: 81443aeffefd83d75c09ea06ed646a6872c807dca04c8178fb90a92401d2c33d.
R2 archive SHA256: aa72269411ce675538af7e28e384400122c93d2697c58b40d35c3606057025f5.
Independent signoff: #60 issuecomment-6072360986. Inherited counts are not newly executed tests.

Implementation: private-memory-only header normalization, strict NOATIME open, actual descriptor-linked ancestor checking before/after capture. Root/admin remain trusted; bounded checks do not prove uninterrupted custody against malicious root. No new public service or API. The prospective non-executable contract updates only its observation code digest; historical approvals, ledgers, runtime gate and G2 invariants remain unchanged.

Runtime repinning and independent review are mandatory for this revision. This document is a coverage plan; actual results and final exact-head review are delivered separately. No implementation PASS implies production admission, adoption, writer/service readmission, merge or G3-04 authority.

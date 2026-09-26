# Pre-Cutover Orphan Cleanup Control V1

## Purpose

This repository control prevents orphan-upload cleanup from mutating imported or staging attachment facts before cutover. It is a runtime safety mechanism, not production authorization.

## Control surface

All destructive orphan cleanup enters through the same persisted gate:

- startup cleanup in `createOperationsServer`;
- periodic cleanup;
- `saveUpload()` triggered cleanup;
- `submitRequest()` triggered cleanup;
- explicit `uploads:cleanup -- --apply` maintenance.

Dry-run inspection remains non-destructive and may execute while cleanup is disabled.

## Persistence and restart behavior

For file-backed databases, the control lives beside the SQLite database in:

`.orphan-cleanup-control/disabled.json`

A disable operation creates an exact epoch. The disabled marker is retained across process and container restart. `inherit` mode respects the persisted state. Explicit re-enable requires the matching epoch and zero active destructive cleanup runs.

The production entrypoint accepts:

- `ORPHAN_CLEANUP_MODE=inherit|disabled|enabled`
- `ORPHAN_CLEANUP_ENABLE_EPOCH=<exact-disabled-epoch>` when explicitly reopening a persisted disabled state.

The compose definition exposes both variables without changing their default behavior.

## Admission and drain

Each destructive cleanup run creates a marker in:

`.orphan-cleanup-control/runs/`

The marker exists from destructive admission until database cleanup, staged-file handling, and final file deletion have all completed.

Disable follows this order:

1. persist the disabled marker first;
2. reject new destructive cleanup admissions;
3. wait for already admitted run markers to disappear;
4. return success only when the active set is empty.

If the drain deadline expires, the control remains disabled and returns `ORPHAN_CLEANUP_DRAIN_TIMEOUT`. A stale marker after crash or uncertain ownership therefore fails closed rather than reopening cleanup.

Re-enable fails when:

- the persisted control marker is malformed;
- active cleanup markers remain;
- the supplied epoch does not equal the persisted disabled epoch.

## Staged cleanup recovery

Startup and request-path recovery may restore a staged file that is still referenced by SQLite. While cleanup is disabled, recovery does not delete unreferenced staged files. Destructive removal of those files occurs only inside an admitted cleanup run.

This preserves safety after a cleanup crash without turning recovery into a hidden cleanup bypass.

## Production boundary

The repository implementation changes the machine evidence for:

- `PRE_CUTOVER_ORPHAN_CLEANUP_CONTROL`
- `RESTORED_CLEANUP_DISABLE_CAPABILITY`

Both gates remain `BLOCKED`. Repository tests are not deployed multi-process acceptance. A later authority revision must still prove real runtime configuration, shared-volume visibility, drain behavior, restart behavior, and exact rollback execution before these gates can close.

No production data, deployment, cutover, provider call, credential, network rule, or cleanup against real files is authorized by this document.

# JSO cross host recovery after new writes

This procedure covers recovery from 106.52.85.232 to the retained installation on
159.75.139.246. It is not a request to execute recovery. The healthy target remains
authoritative until an explicitly authorized recovery window starts.

## Preconditions

- Record current source/destination host identities, exact image/source and R5
  records, mounts, credentials' protected references and current revisions.
- Verify the proposed destination image supports the current Schema12 facts and
  projections, using the detached snapshot and the ordinary R5 validation path.
- Prepare an independent latest backup/restore on the current writer; test the
  destination route and existing certificate without changing DNS.
- Keep owner authority, Trusted Action and credential scopes unchanged. Do not
  deploy a read-only adapter as proof that native confirmation works.

## Freeze and transfer

1. Coordinate a short maintenance window. Preserve UNKNOWN operations and their
   original ids. Stop the current writer on 106.52.85.232, then verify there is no
   remaining writable database handle or other container writing that volume.
   The old JSO on 159.75.139.246 must remain stopped.
2. Record the last authoritative consistent business snapshot and audit boundary.
   Save the complete stopped SQLite family and uploads, with a manifest of all
   business table digests, revisions and attachment hashes. Preserve configuration
   and R5 custody separately in protected server-side backups.
3. Restore that final backup into a detached check directory and run:

   ```sh
   python3 scripts/verify-cross-host-recovery.py \
     --snapshot-root /absolute/protected-backup/snapshot/data \
     --manifest /absolute/protected-backup/snapshot/snapshot-manifest.json
   ```

   This is a verifier only. It must not initialize/migrate/repair a database.
   SQLite is opened only on a private temporary copy of the sealed database
   family. Committed WAL records are copied and read; SHM is rebuilt in scratch
   space. The backup directory and its existing files remain unchanged, including
   on read-only storage. Supply a quiesced sealed family, never a changing live
   database: independent file copying is not an online SQLite backup mechanism.
4. Transfer the sealed archive over authenticated encrypted channels. Do not
   persist the business data or credentials on the chat/workstation. Verify the
   archive digest at the destination before extraction; reject links/path escapes.
5. Preserve the destination's prior data family and custody. Install the latest
   data into the designated stopped destination volume, retaining all new orders,
   operations and receipts. Do not merge business facts with SQL or replace the
   latest data with the pre-migration snapshot.

## Bind and validate

6. Restore-check the destination copy against the final manifest and every
   referenced attachment. Any unexplained difference blocks activation.
7. Use the existing administrator-custodied R5 process for the real destination
   host, database/upload inode identities, image/source and exact configuration.
   The old source approval is not automatically valid for replaced files.
   Record truthful backup/restore and current authorization evidence; do not
   transplant old identities or claim a verification that was not performed.
8. Validate PREPARED against the detached/stopped copy as supported by the existing
   gate, then establish ACTIVE through that same process. Run initial diagnostics
   with write admission disabled and loopback-only access. The global disabled
   gate also rejects POST-based Agent reads; that is expected, not a reason to
   bypass it.
9. Confirm the former writer remains stopped before enabling the destination.
   Verify health, authenticated facts, old and new original-operation receipts,
   the real VCP dispatcher and user-facing route. Compare business facts with the
   final frozen manifest before any intended acceptance write.
10. Switch only the JSO DNS record once the destination is ready. Keep Cloudflare
    proxy/TLS protections and verify public runtime provenance. Record final host,
    single-writer state and receipt readbacks; do not delete the retained backups.

## Failure handling

Before the destination accepts any new business write, it is safe to stop it and
resume the former writer only after proving its facts still match the sealed
authoritative snapshot. Restore DNS and verify availability.

After the destination accepts a new write, never simply resume the former writer.
Stop the writer, seal its latest facts, and repeat this procedure in the opposite
direction. If outcome or data ownership is uncertain, preserve both stores,
leave one writer at most, reconcile original ids, and report the exact blocker.

An interrupted transfer or missing snapshot manifest is not proof that no new
write happened. Inspect actual container state and authoritative data before
restarting anything. Never auto-break journal locks or clear UNKNOWN state.

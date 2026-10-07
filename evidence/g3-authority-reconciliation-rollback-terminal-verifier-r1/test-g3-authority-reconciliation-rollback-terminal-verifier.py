#!/usr/bin/env python3
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent
VERIFIER = ROOT / "g3-authority-reconciliation-rollback-terminal-verifier.py"
MANIFEST = ROOT / "g3-authority-reconciliation-rollback-terminal-verifier.r1.json"

spec = importlib.util.spec_from_file_location("verifier", VERIFIER)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
manifest = json.loads(MANIFEST.read_text())

actual_sha = "sha256:" + hashlib.sha256(VERIFIER.read_bytes()).hexdigest()
assert actual_sha == manifest["verifier"]["sha256"]
assert module.EXPECTED_AUTHORITY_HEAD == manifest["authority"]["canonicalHead"]
assert module.EXPECTED_ROLLBACK_TARGET_DIGEST == manifest["targetBinding"]["rollbackTargetDigest"]
assert module.EXPECTED_TARGET_RECORD_SHA256 == manifest["targetBinding"]["targetRecordSha256"]
assert module.EXPECTED_EXECUTOR_SHA256 == manifest["targetBinding"]["rollbackExecutorSha256"]
assert module.OPERATION_ID == manifest["targetBinding"]["operationId"]
assert module.PACKET_ID == manifest["targetBinding"]["packetId"]

source = VERIFIER.read_text()
for forbidden in [
    "claim_attempt(", "os.rename(", ".rename(", ".unlink(", "shutil.move(",
    "[\"docker\", \"run\"", "[\"docker\", \"start\"", "[\"docker\", \"stop\"",
    "[\"systemctl\", \"start\"", "[\"systemctl\", \"stop\"",
]:
    assert forbidden not in source, forbidden

assert 'sqlite3.connect(f"file:{proc_path}?mode=ro&immutable=1", uri=True)' in source
assert "renameat2" in source
assert '"flag": "RENAME_EXCHANGE"' in source
assert 'getattr(os, "O_NOFOLLOW", 0)' in source
assert "os.fstat(fd)" in source
assert "metadata.st_uid != 0" in source
assert "stat.S_IMODE(metadata.st_mode) & 0o022" in source
assert "metadata.st_uid != 0" in source
assert "stat.S_IMODE(metadata.st_mode) != 0o600" in source
assert "fuser.stdout + " not in source
assert "TERMINAL_SNAPSHOT_UNSTABLE" in source
assert source.count("read_current_canonical_head()") >= 2
assert "stableAcrossIndependentSamples" in source
assert "parser.add_argument(\"--output\")" not in source

verify_body = source[source.index("def verify(target_record"):source.index("def self_test_classification")]
assert verify_body.index("attempt = verify_attempt_record(target_digest)") < verify_body.index(
    "active_fd = open_pinned_regular_file("
)
assert verify_body.index("active_fd = open_pinned_regular_file(") < verify_body.index(
    "snapshot = observe_terminal_snapshot(attempt, active_fd, exchanged_fd)"
)
assert verify_body.index("snapshot = observe_terminal_snapshot(attempt, active_fd, exchanged_fd)") < verify_body.index(
    "return build_terminal_result(snapshot, classified_at)"
)
assert verify_body.index("return build_terminal_result(snapshot, classified_at)") < verify_body.index(
    "os.close(exchanged_fd)"
)

observe_body = source[source.index("def observe_terminal_snapshot"):source.index("def rolled_back_snapshot_matches")]
final_authority = observe_body.index("final_authority_head = read_current_canonical_head()")
post_authority_containment = observe_body.index("verify_terminal_containment(allowed_pids)", final_authority)
post_authority_active = observe_body.index(
    "revalidate_pinned_path(ACTIVE_DB, active_fd, active)", post_authority_containment
)
post_authority_exchanged = observe_body.index(
    "revalidate_pinned_path(EXCHANGED_OUT_SCHEMA11, exchanged_fd, exchanged)",
    post_authority_active,
)
assert final_authority < post_authority_containment < post_authority_active < post_authority_exchanged

attempt_body = source[source.index("def verify_attempt_record"):source.index("def verify_terminal_containment")]
assert 'Path("/mnt/datadisk0")' in attempt_body
assert "CONTROL_ROOT.parent" in attempt_body
assert "CONTROL_ROOT / \"attempts\"" in attempt_body
assert "verify_root_controlled_directory(directory)" in attempt_body
assert "os.read(fd, 1024 * 1024)" in attempt_body

with tempfile.TemporaryDirectory() as td:
    root = Path(td)
    path = root / "db.sqlite"
    path.write_bytes(b"pinned-original")
    fd = module.open_pinned_regular_file(path, "TEST_PIN_FAILED")
    try:
        expected = module.file_identity_fd(fd, path)
        replacement = root / "replacement.sqlite"
        replacement.write_bytes(b"replacement")
        os.replace(replacement, path)
        try:
            module.revalidate_pinned_path(path, fd, expected)
        except RuntimeError as exc:
            assert str(exc) == "TERMINAL_SNAPSHOT_UNSTABLE"
        else:
            raise AssertionError("path exchange was not detected")
    finally:
        os.close(fd)

with tempfile.TemporaryDirectory() as td:
    unsafe = Path(td) / "unsafe"
    unsafe.mkdir()
    unsafe.chmod(0o777)
    try:
        module.verify_root_controlled_directory(unsafe)
    except RuntimeError as exc:
        assert str(exc) == "TERMINAL_ATTEMPT_DIRECTORY_NOT_ROOT_CONTROLLED"
    else:
        raise AssertionError("group/other-writable attempt directory was accepted")

for arg, marker in [
    ("--self-test-classification", "G3_AUTH_RECON_ROLLBACK_TERMINAL_CLASSIFICATION_SELF_TEST_PASS"),
    ("--self-test-approval-signature", "G3_AUTH_RECON_ROLLBACK_TERMINAL_APPROVAL_SELF_TEST_PASS"),
]:
    run = subprocess.run([sys.executable, str(VERIFIER), arg], text=True, capture_output=True)
    assert run.returncode == 0, run.stderr
    assert marker in run.stdout

assert manifest["terminalModel"]["attemptRequiredBeforeClassification"] is True
assert manifest["terminalModel"]["successfulRollbackOutcome"] == "ROLLED_BACK"
assert manifest["terminalModel"]["ambiguousStartedAttemptOutcome"] == "UNKNOWN"
assert manifest["terminalModel"]["committedOutcomeUsedByThisVerifier"] is False
assert manifest["terminalModel"]["automaticRetryAllowed"] is False
assert manifest["verifier"]["productionMutationCapability"] is False
assert manifest["verifier"]["receiptWrittenByVerifier"] is False
assert manifest["verifier"]["pinnedDatabaseDescriptorsThroughClassification"] is True
assert manifest["verifier"]["postAuthorityContainmentRevalidationRequired"] is True
assert manifest["verifier"]["attemptLedgerRootControlledRequired"] is True
assert manifest["verifier"]["attemptRecordReadFromPinnedDescriptor"] is True
assert manifest["rolledBackRequirements"]["pinnedPathIdentityRevalidationRequired"] is True
assert manifest["rolledBackRequirements"]["postAuthorityContainmentRevalidationRequired"] is True
assert manifest["rolledBackRequirements"]["attemptLedgerRootOwnershipRequired"] is True

print(json.dumps({
    "status": "G3_AUTH_RECON_ROLLBACK_TERMINAL_VERIFIER_TEST_PASS",
    "verifierSha256": actual_sha,
    "rollbackTargetDigest": module.EXPECTED_ROLLBACK_TARGET_DIGEST,
}))

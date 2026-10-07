#!/usr/bin/env python3
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

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
assert 'sqlite3.connect(f"file:{path}?mode=ro&immutable=1", uri=True)' in source
assert "renameat2" in source
assert '"flag": "RENAME_EXCHANGE"' in source
assert source.index("attempt = verify_attempt_record(target_digest)") < source.index("snapshot = observe_terminal_snapshot(attempt)")
assert "TERMINAL_SNAPSHOT_UNSTABLE" in source
assert source.count("read_current_canonical_head()") >= 2
assert "stableAcrossIndependentSamples" in source
assert "parser.add_argument(\"--output\")" not in source

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

print(json.dumps({
    "status": "G3_AUTH_RECON_ROLLBACK_TERMINAL_VERIFIER_TEST_PASS",
    "verifierSha256": actual_sha,
    "rollbackTargetDigest": module.EXPECTED_ROLLBACK_TARGET_DIGEST,
}))

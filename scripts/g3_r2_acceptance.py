"""Independent R2 acceptance of complete observations, never trusts a success word."""
import datetime
import json
from pathlib import Path

from g3_r2_common import (bounded, canonical, DENY, exact, load_r1, METHOD, need, parse, REF_PINS,
                          SHA, sha, SIDES)

G3_PRESTATE_TABLES = ['audit_log', 'empty_db_initialization', 'empty_db_maintenance_operations', 'gf15_command_packets', 'gf15_control_receipts', 'gf15_outbox_isolation', 'gf15_scheduling_leases', 'kiosk_smoke_binding', 'kiosk_smoke_outbox_isolation', 'kiosk_smoke_phases', 'kiosk_smoke_runtime_session', 'kiosk_smoke_stop', 'legacy_asset_entries', 'legacy_compat_fragments', 'migration_batches', 'notification_outbox', 'operations', 'product_catalog_entries', 'production_events', 'production_runs', 'requests_v2', 'revision_counters', 'run_event_id_owners', 'run_event_reviews', 'schedule_item_tasks', 'schedule_items', 'schedule_state', 'scheduling_active_config', 'scheduling_admin_operations', 'scheduling_config_activations', 'scheduling_config_versions', 'scheduling_proposal_decisions', 'scheduling_proposals', 'scheduling_request_requirements', 'scheduling_resources', 'scheduling_run_context_snapshots', 'schema_migrations', 'snapshot_projections', 'sqlite_sequence', 'uploads']

VIEW_KEYS = ('schemaDigest', 'columnsDigest', 'indexXinfo', 'foreignKeys', 'indexList', 'tableList',
             'tables', 'header', 'markers', 'integrity', 'foreignKeyViolations', 'schemaObjects', 'excludedHeaderFields')
RECORD_KEYS = ('version', 'domain', 'status', 'challenge', 'methodSha256', 'approvalManifestSha256',
               'contractSha256', 'exceptionSha256', 'referenceEvidenceSha256', 'reference', 'code', 'runtime',
               'host', 'scope', 'custodyBefore', 'custodyAfter', 'prestate', 'active', 'comparedLegacyTables',
               'historicalWalCompleteness', 'historicalWriterCoverage', 'sampling', 'checks', 'problems',
               *DENY, 'captureDigest')
CHECK_KEYS = ('integrity', 'foreignKeys', 'migrationPrefix', 'fullTypedRowsets', 'structureAndIndexes',
              'originalsStable', 'privateMount', 'copyHashes', 'noSidecars', 'cleanupConfirmed')
IDENTITY_KEYS = ('device', 'inode', 'size', 'mode', 'uid', 'gid', 'nlink', 'sha256',
                 'fileFormatRead', 'fileFormatWrite', 'headerPageSizeBytes')


def verify_sources(approval, store, uid):
    """Fixed historical execution format. Every listed byte is bound by the installed index."""
    need(type(approval['sourceIndexSha256']) is str and SHA.fullmatch(approval['sourceIndexSha256']), 'SOURCE_INDEX_PIN_REQUIRED')
    raw = bounded(store / 'source-index.json', trusted_uid=uid)
    need(sha(raw) == approval['sourceIndexSha256'], 'SOURCE_INDEX_DRIFT')
    index = parse(raw)
    exact(index, ('version', 'scope', 'files'))
    need(index['version'] == 1 and index['scope'] == approval['scope'], 'SOURCE_INDEX_SCOPE')
    roles = ('receipt', 'status', 'stderr', 'consumed', 'authorization', 'transport', 'independentAcceptance')
    exact(index['files'], roles)
    material = {}
    for role, info in index['files'].items():
        exact(info, ('file', 'sha256'))
        need(type(info['file']) is str and Path(info['file']).name == info['file'], 'SOURCE_NAME')
        # Empty stderr is represented as JSON base64 by the immutable index exporter, not discarded.
        raw = bounded(store / 'sources' / info['file'], trusted_uid=uid)
        need(sha(raw) == info['sha256'], 'SOURCE_BYTES_DRIFT')
        material[role] = raw
    if approval['purpose'] == 'ISOLATED_VALIDATION_ONLY':
        # A lab trust store cannot assert production provenance, even if all synthetic records match.
        need(approval['scope'] == 'SYNTHETIC_ONLY_NOT_PRODUCTION', 'LAB_SOURCE_SCOPE')
        return
    need(sha(material['receipt']) == REF_PINS['reconstructionReceipt'] and
         sha(material['independentAcceptance']) == REF_PINS['independentAcceptance'], 'FIXED_HISTORICAL_ACCEPTANCE')
    result = json.loads(material['receipt'])
    need(result['status'] == 'LIMITED_RECONSTRUCTION_EVIDENCE' and len(result['tables']) == 40, 'RECONSTRUCTION_STATUS')
    need(all(result[k] is False for k in ('productionAdmission', 'historicalCoverageProven', 'livePreservedBound', 'originalHeaderChangedByTool')), 'HISTORICAL_SCOPE_ESCALATION')
    need(result['archiveSha256'] == [REF_PINS['schema6Archive'], REF_PINS['schema10Archive']] and
         result['inputMainSha256'][1] == REF_PINS['schema10Main'], 'HISTORICAL_ARCHIVE_BINDING')
    need(result['explicitCloseAndReopen'] is True and result['migration11Count'] == 0 and
         result['archivePostcheck'] is True and result['scratchRemoved'] is True and
         [x['version'] for x in result['declaredTimestampDifferences']] == [7, 8, 9, 10], 'HISTORICAL_LIMITED_RESULT')
    need(result['image'] == 'sha256:581e9fa25e04b582aa39c2fdaa291f6db3e80fc3f3ac15a8a4afa06622442144' and
         result['runnerSha256'] == '04e2d0897503b34ebc82e2b27715fe48fa25a834bd65e1637f8b6b94495a099f' and
         result['runtime'] == {'node': 'v24.21.0', 'sqlite': '3.53.4'}, 'HISTORICAL_TOOL_RUNTIME')
    status, auth, consumed = (json.loads(material[k]) for k in ('status', 'authorization', 'consumed'))
    exact(status, ('start', 'end', 'exit', 'command'))
    need(type(status['exit']) is int and status['exit'] == 0 and status['command'] ==
         'sudo -n python3 /var/tmp/jso-g305-reconstruction-tool-r1/g3-bounded-reconstruction.py --execute-approved', 'HISTORICAL_TRANSPORT')
    need(json.loads(material['stderr']) == {'encoding': 'base64', 'bytes': ''}, 'HISTORICAL_STDERR')
    need(auth['oneAttemptOnly'] is True and auth['target'] == 'ubuntu@159.75.139.246' and
         auth['bundleSha256'] == '72f3354d48ef6e4521ed27fe74473cc9d18c7120d589b2460bfe22436c87a360' and
         consumed['automaticRetryAllowed'] is False and consumed['authorization'] == auth['userApproval'], 'HISTORICAL_ONCE_APPROVAL')
    times = [datetime.datetime.fromisoformat(x) for x in (auth['startedUtc'], consumed['utc'], status['start'], status['end'])]
    need(times == sorted(times) and all(t.tzinfo is not None for t in times), 'HISTORICAL_TIME_ORDER')
    # Authentication is not derived from these strings. The exact transport source and independent
    # acceptance are anchored in the Jenn-approved source index, with original approval/consumption.


def view_shape(view):
    exact(view, VIEW_KEYS)
    for key in ('schemaDigest', 'columnsDigest'):
        need(type(view[key]) is str and view[key].startswith('sha256:') and SHA.fullmatch(view[key][7:]), 'VIEW_DIGEST')
    need(type(view['schemaObjects']) is int and view['schemaObjects'] > 0, 'SCHEMA_COVERAGE')
    need(view['integrity'] == ['ok'] and type(view['foreignKeyViolations']) is int and view['foreignKeyViolations'] == 0, 'INTEGRITY_OR_FK')
    exact(view['header'], ('application_id', 'user_version', 'encoding', 'page_size', 'auto_vacuum'))
    need(view['header']['encoding'] == 'UTF-8' and all(type(view['header'][k]) is int for k in ('application_id','user_version','page_size','auto_vacuum')), 'HEADER_TYPES')
    need(view['excludedHeaderFields'] == load_r1().HEADER_EXCLUDED, 'METADATA_SCOPE_DRIFT')
    need(type(view['tables']) is dict and view['tables'], 'TABLES_MISSING')
    for name, table in view['tables'].items():
        load_r1().ident(name)
        exact(table, ('columns', 'rowCount', 'rowSetSha256'))
        need(type(table['columns']) is list and table['columns'] and all(type(x) is str for x in table['columns']), 'ROW_COLUMNS')
        # R1 SELECT rowid,* legitimately repeats an INTEGER PRIMARY KEY column name.
        for column in table['columns']:
            load_r1().ident(column)
        need(type(table['rowCount']) is int and 0 <= table['rowCount'] <= 250000, 'ROW_COUNT')
        need(type(table['rowSetSha256']) is str and table['rowSetSha256'].startswith('sha256:') and SHA.fullmatch(table['rowSetSha256'][7:]), 'ROW_DIGEST')
    for key in ('foreignKeys', 'indexList', 'tableList'):
        exact(view[key], view['tables'])
        need(all(type(x) is list for x in view[key].values()), 'METADATA_SHAPE')
    need(type(view['indexXinfo']) is dict and all(type(x) is list for x in view['indexXinfo'].values()), 'INDEX_SHAPE')
    for key in ('foreignKeys', 'indexList', 'indexXinfo'):
        for rows in view[key].values():
            need(all(type(row) is list and all(type(v) in (str, int, type(None)) for v in row) for row in rows), 'METADATA_VALUES')
    for row in view['tableList'].values():
        need(len(row) == 6 and all(type(x) in (str, int) for x in row), 'TABLE_FLAGS_SHAPE')
    need(type(view['markers']) is list, 'MIGRATION_MARKERS')
    for row in view['markers']:
        need(type(row) is list and len(row) == 4 and type(row[0]) is int and all(type(x) is str for x in row[1:]), 'MIGRATION_SHAPE')


def validate_observation(raw, approval, approval_sha, challenge):
    record = parse(raw)
    exact(record, RECORD_KEYS)
    need(type(record['version']) is int and record['version'] == 2 and record['status'] == 'R2_OBSERVATION_REQUIRES_LOCAL_ACCEPTANCE', 'R2_VERSION_OR_STATUS')
    need(record['captureDigest'] == sha(canonical({k: v for k, v in record.items() if k != 'captureDigest'})), 'CAPTURE_DIGEST')
    profile = 'g3' if approval['purpose'] == 'PRODUCTION_WINDOW' else 'synthetic'
    need(record['domain'] == ('G3_PRODUCTION_EVIDENCE_R2' if profile == 'g3' else 'G3_ISOLATED_EVIDENCE_R2'), 'DOMAIN_SCOPE')
    for k in ('contractSha256', 'exceptionSha256', 'referenceEvidenceSha256', 'reference', 'code', 'runtime', 'host', 'scope'):
        need(record[k] == approval[k], 'APPROVAL_BINDING_' + k.upper())
    need(record['methodSha256'] == METHOD and record['approvalManifestSha256'] == approval_sha and record['challenge'] == challenge, 'EXACT_APPROVAL_CHALLENGE')
    need(record['historicalWalCompleteness'] == record['historicalWriterCoverage'] == 'NOT_PROVEN', 'HISTORICAL_NOT_PROVEN_REQUIRED')
    need(record['problems'] == [] and all(record[k] is False for k in DENY), 'PROBLEMS_OR_AUTHORITY')
    exact(record['checks'], CHECK_KEYS)
    need(all(x is True for x in record['checks'].values()), 'INCOMPLETE_CHECKS')
    need(record['sampling'] == 'PINNED_ORIGINAL_FDS_PRIVATE_TMPFS_RO_IMMUTABLE_COPIES', 'SAMPLING')
    need(record['custodyBefore'] == record['custodyAfter'], 'CUSTODY_DRIFT')
    exact(record['custodyBefore'], SIDES)
    inodes = []
    for side in SIDES:
        custody = record['custodyBefore'][side]
        exact(custody, ('identity', 'parents', 'mount', 'flags'))
        exact(custody['identity'], IDENTITY_KEYS)
        for key in ('identity', 'parents', 'mount'):
            need(custody[key] == approval['files'][side][key], 'ORIGINAL_OBJECT_BINDING')
        need(type(custody['flags']) is int and custody['flags'] & 16, 'IMMUTABLE_REQUIRED')
        identity = custody['identity']
        fmt = 2 if side == 'prestate' else 1
        need(all(type(identity[k]) is int for k in IDENTITY_KEYS if k != 'sha256'), 'IDENTITY_TYPES')
        need(identity['nlink'] == 1 and identity['fileFormatRead'] == identity['fileFormatWrite'] == fmt, 'FORMAT_OR_HARDLINK')
        inodes.append((identity['device'], identity['inode']))
        view_shape(record[side])
    need(inodes[0] != inodes[1], 'DISTINCT_ORIGINALS')
    w = load_r1()
    problems, legacy = w.prove(record['prestate'], record['active'], profile)
    need(not problems and type(record['comparedLegacyTables']) is int and record['comparedLegacyTables'] == len(legacy), 'INDEPENDENT_SEMANTIC_REJECTION')
    if profile == 'g3':
        need(sorted(record['prestate']['tables']) == sorted(G3_PRESTATE_TABLES) and
             sorted(record['active']['tables']) == sorted(G3_PRESTATE_TABLES + ['agent_grant_attempts', 'schedule_reschedule_operations']), 'EXACT_TABLE_ROSTER')
        need(record['prestate']['tables']['schema_migrations']['rowCount'] == 10 and record['active']['tables']['schema_migrations']['rowCount'] == 11, 'MIGRATION_ROW_COUNT')
        # The ten original records, including timestamps, have no reconstruction-time exception here.
        need(w.digest(record['prestate']['markers']) == 'sha256:20e76fece64d733d50e68f852c98a665d2dd77f0f258e9b05c0739f8003f1445', 'ORIGINAL_MIGRATION_PREFIX')
        datetime.datetime.strptime(record['active']['markers'][-1][3], '%Y-%m-%dT%H:%M:%S.%fZ')
        need(len(record['prestate']['tables']) == 40 and len(record['active']['tables']) == 42, 'FULL_TABLE_COVERAGE')
    return record

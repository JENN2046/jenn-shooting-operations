import { mkdirSync, realpathSync, statSync, openSync, closeSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { initializeWritableSchema, MIGRATIONS } from '../src/sqlite-schema-v2.mjs';
import { seedEmptyLegacyState } from '../src/empty-legacy-state-v1.mjs';
import { createOrphanCleanupControl } from '../src/orphan-cleanup-control.mjs';
import { resolveOrphanCleanupControlRoot } from '../src/store.mjs';

// Caller supplies separately reviewed authority. This creates schema only, never
// initialization receipts, an acceptance installation, a runtime or a volume.
// Failure preserves the partial new directory; it is never overwritten or retried.
export function createGreenfieldDomain({root,synthetic=false,schemaVersion=12,now=()=>new Date()}) {
  if(typeof root!=='string'||root!==resolve(root)||realpathSync(dirname(root))!==dirname(root))throw new Error('CANONICAL_NEW_ROOT_REQUIRED');
  if(![11,12].includes(schemaVersion))throw new Error('UNSUPPORTED_GREENFIELD_SCHEMA');
  const at=now();if(!(at instanceof Date)||!Number.isFinite(at.getTime()))throw new Error('INVALID_CREATION_TIME');
  mkdirSync(root,{mode:0o700}); // Exclusive: any pre-existing target is refused.
  const filename=join(root,synthetic?'synthetic.sqlite':'shooting-operations.sqlite');
  closeSync(openSync(filename,'wx',0o600));
  const db=new DatabaseSync(filename);
  try {
    db.exec('PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON');
    initializeWritableSchema(db,{now:()=>at,migrations:MIGRATIONS.slice(0,schemaVersion)});
    db.exec('BEGIN IMMEDIATE');
    try{seedEmptyLegacyState(db,at);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
    if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('NEW_SCHEMA_VERIFICATION_FAILED');
  } finally {db.close();}
  const uploadRoot=join(root,'uploads');mkdirSync(uploadRoot,{mode:0o700});mkdirSync(join(uploadRoot,'.cleanup'),{mode:0o700});
  const control=createOrphanCleanupControl({controlRoot:resolveOrphanCleanupControlRoot({filename})});
  if(!control.disable({reason:'greenfield-schema-only',waitForDrainMs:0}).ok)throw new Error('NEW_CONTROL_DISABLE_FAILED');
  const identity=p=>{const s=statSync(p);return {device:s.dev,inode:s.ino};};
  return {purpose:synthetic?'SYNTHETIC_SCHEMA_ONLY_NOT_OWNER_APPROVAL':'GREENFIELD_SCHEMA_ONLY_NOT_EXECUTION_AUTHORITY',root,filename,uploadRoot,schemaVersion,databaseIdentity:identity(filename),uploadIdentity:identity(uploadRoot),sha256:createHash('sha256').update(readFileSync(filename)).digest('hex'),initialized:false};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.length!==4||!['--synthetic-new-root','--approved-new-root'].includes(process.argv[2]))throw new Error('Use --synthetic-new-root or --approved-new-root with a new absolute directory; production requires separate approval');
  console.log(JSON.stringify(createGreenfieldDomain({root:process.argv[3],synthetic:process.argv[2]==='--synthetic-new-root'})));
}

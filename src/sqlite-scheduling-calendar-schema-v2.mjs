import { SCHEDULING_SCHEMA_SQL } from './sqlite-scheduling-schema-v1.mjs';
// Rebuild under one exclusive writer transaction; historical migration SQL is untouched.
export const SCHEDULING_CONFIG_TABLE_V2_SQL = SCHEDULING_SCHEMA_SQL.match(/CREATE TABLE scheduling_config_versions[\s\S]*?\) STRICT;/)[0].replace('CHECK (schema_version = 1)', 'CHECK (schema_version IN (1, 2))');
const triggers = [...SCHEDULING_SCHEMA_SQL.matchAll(/CREATE TRIGGER scheduling_config_versions_\w+[\s\S]*?END;/g)].map(m => m[0]).join('\n');
export const SCHEDULING_CALENDAR_SCHEMA_V2_SQL = `
  CREATE TABLE scheduling_config_versions_migration11 AS SELECT * FROM scheduling_config_versions;
  DROP TABLE scheduling_config_versions;
  ${SCHEDULING_CONFIG_TABLE_V2_SQL}
  INSERT INTO scheduling_config_versions SELECT * FROM scheduling_config_versions_migration11;
  DROP TABLE scheduling_config_versions_migration11;
  ${triggers}
`;

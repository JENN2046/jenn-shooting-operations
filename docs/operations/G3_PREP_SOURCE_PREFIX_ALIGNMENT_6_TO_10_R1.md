# G3 Preparation Source-Prefix Alignment 6 → 10 R1

Status: **ALIGNED_TO_10_CONTAINED / SCHEMA11 NOT AUTHORIZED**

Authority base:

\`codex/v2-1-architecture-freeze @ 26a3390035fa209bbd1a926a3ebb1bb0df486935\`

This record closes the in-gate prerequisite \`G3_PREP_SOURCE_PREFIX_ALIGNMENT_6_TO_10\`.
It does not authorize or execute Schema 11.

## Production result

Fresh production execution used the exact candidate image already frozen by G3 Preparation:

\`\`\`text
candidate image = sha256:581e9fa25e04b582aa39c2fdaa291f6db3e80fc3f3ac15a8a4afa06622442144
execution script = sha256:ce48facc88364b5028297d20c2e1f4d85d593c29a8d226caa943bbca5875c9df
\`\`\`

Before mutation:

\`\`\`text
schema = 6
integrity_check = ok
foreign_key_check = 0
write admission = enabled
orphan cleanup = enabled
\`\`\`

The production container was first changed from \`restart=unless-stopped\` to \`restart=no\`, then stopped.
Zero running containers remained on the production data volume. Two stable DB/WAL/SHM samples matched byte-for-byte.

A Schema-6 recovery family was copied and independently restored/read back before migration:

\`\`\`text
recovery artifact digest =
sha256:5c7e9a17d9762e8fb31d534e03ea2285182e44a82ddbaf6863f10b655989b103

readback schema = 6
integrity_check = ok
foreign_key_check = 0
\`\`\`

Only the runtime pre-cutover initializer was executed. It applied exactly migrations 7–10:

1. \`gf15_bounded_capabilities\`
2. \`kiosk_bounded_smoke\`
3. \`kiosk_smoke_runtime_ownership\`
4. \`empty_db_maintenance_receipts\`

Postcondition:

\`\`\`text
schema = 10
migration count = 10
migration 11 count = 0
integrity_check = ok
foreign_key_check = 0
\`\`\`

A new authoritative Schema-10 pre-state/recovery family was then captured while normal writers remained contained:

\`\`\`text
family observation digest =
sha256:d294f752d51bc6091aef932a52774163815178a0a6aacfc10ea994fab66d8212

source manifest digest =
sha256:1c12912586639127f2192e1bf72bdc1f28c04d5be81dc985969300e237a6dd0b

recovery artifact digest =
sha256:f2e643317a152600c8bf864648cec095ad57ba398c804feb35f9338a7073cfef
\`\`\`

Independent Schema-10 recovery readback again returned \`integrity_check=ok\`, zero FK violations and zero migration-11 rows.

## Fail-closed production state

At completion:

\`\`\`text
old production container running = false
old production restart policy = no
running volume users = 0
normal writers = blocked
Schema11 cutover = NOT AUTHORIZED / NOT STARTED
executable G3 packet = NOT_CREATED
\`\`\`

The old Schema-6 container must not be restarted against the Schema-10 database.

## What this clears

\`BLOCKED_SOURCE_SCHEMA_MISMATCH\` is cleared.

G3 Preparation may now continue from an exact Schema-10 source with verified recovery evidence.
It must still freeze and verify the 10→11 execution boundary, build the exact G3 packet, and obtain separate exact human approval before Schema 11.

No part of this record authorizes writer readmission or Schema 11.

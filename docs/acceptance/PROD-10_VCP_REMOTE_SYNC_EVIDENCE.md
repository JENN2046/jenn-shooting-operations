# PROD-10 VCP Remote Sync Evidence

Status: **COMPLETED / LIVE PRODUCTION EVIDENCE**

Action ID:

```text
PROD-10-ENABLE-VCP-REMOTE-SYNC
```

Explicit human authorization was received for this exact action ID.

## Runtime identity

```text
VCPToolBox release = 12380d7d
VCPToolBox commit  = 12380d7dbd47219c012d3bda029dafdfed4b0224

Jenn extension release = 7ea5d49c
Jenn extension commit  = 7ea5d49ca000a2298e012b9ff54ec229ebb59e96

plugin       = JennShootingOperations
JEV category = shooting_operations
service      = https://jso.skmt617.top
```

The external plugin was loaded through the exact VCP external-root and name+source allow policy. The live JEV planner expands `{拍摄运营}` to `JennShootingOperations`.
## Secret and principal boundary

The production scheduler principal remained in restricted runtime secret storage.

Low-disclosure evidence records only:

```text
credential source type = restricted env file
credential key         = SCHEDULER_TOKEN
principal scope        = scheduler bearer for revision-guarded V1 snapshot write
```

The credential value was not written to Git, logs, evidence, chat, VCP Memory, or agent arguments.

The Agent-facing plugin remains READ / PROPOSE only. No standing Agent write capability was granted.

## Authorized pull -> guarded push -> verification pull

Fresh pre-write state:

```text
revision = 1
products = 0
tasks    = 0
sessions = 0
```

Acceptance operation:

```text
operation id = prod10-enable-vcp-remote-sync-r1-0001
expected revision = 1
payload mode = NO_OP_BUSINESS_PAYLOAD
real guarded push attempts = 1
```
Result:

```text
push result revision = 2
verification revision = 2
credentialExposed = false
```

Post-write state:

```text
revision = 2
products = 0
tasks    = 0
sessions = 0
business payload unchanged = true
```

This proves a real production guarded write without inventing a test task or changing production scheduling facts.

## Post-action state

```text
integration enabled          = true
read capability              = enabled
proposal capability          = enabled
standing Agent write         = disabled
acceptance write gate        = disabled
VCP Hot Memory binding       = resolved
VCP Cold Memory binding      = resolved
Kiosk                        = unchanged
DingTalk                     = unchanged
```

`ROLLBACK-09-DISABLE-VCP-CONFIG` remains configuration-only. It may disable the VCP integration but MUST NOT decrement or erase committed revision 2.
## Deployment-chain evidence

```text
Core release promotion         = PASS
Jenn extension release         = PASS
external plugin registration   = PASS
JEV category activation        = PASS
production endpoint binding    = PASS
scheduler principal binding    = PASS
real production pull           = PASS
real guarded push              = PASS
verification pull              = PASS
```

The live runtime receipt is:

```text
policy/promotions/PROD10_ENABLE_VCP_REMOTE_SYNC_20260929.json
sha256 = 31274e2828452301c610f6579fbe039449811ac08c8ca72c3ba49feab8991b12
```

One public health probe timed out after the acceptance write. Immediate read-only reconciliation showed container health healthy, loopback health 200, loopback revision 2, and public health 200. No write was replayed.

## Current external state

```text
VCP_SOURCE_COMPATIBILITY   = PASS
VCP_EXTERNAL_COMPATIBILITY = PASS
PROD-10-ENABLE-VCP-REMOTE-SYNC = COMPLETED
next production action = PROD-11-ENABLE-KIOSK-IDENTITY-DEVICE
```

The VCP-APP `vcp_tool_resolve` catalog surface currently reports `CATALOG_CONTRACT_INVALID`; this remains a separate resolver/state-authority compatibility issue. It did not affect JEV planning, live external registration, `/v1/human/tool`, the authorized guarded write, or the verification pull.

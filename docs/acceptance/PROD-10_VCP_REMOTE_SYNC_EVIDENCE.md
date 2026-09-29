# PROD-10 VCP Remote Sync Evidence

Status: **COMPLETED / LIVE PRODUCTION ACCEPTANCE**

Action ID: `PROD-10-ENABLE-VCP-REMOTE-SYNC`

## Runtime identity

- VCPToolBox release: `12380d7d`
- VCPToolBox commit: `12380d7dbd47219c012d3bda029dafdfed4b0224`
- Jenn extension release: `7ea5d49c`
- Jenn extension commit: `7ea5d49ca000a2298e012b9ff54ec229ebb59e96`
- Plugin: `JennShootingOperations`
- JEV category: `shooting_operations`
- Endpoint: `https://jso.skmt617.top`

The Agent-facing plugin remains READ / PROPOSE only. Standing Agent write authority is disabled.

## Historical first execution

The first authorized guarded push advanced revision 1 → 2 with an unchanged business payload.

That execution proved the live adapter path but was **not** admitted as formal PROD-10 completion because exact container/target identity had not been freshly attested before the write. The authority remained fail-closed and did not advance to PROD-11.
## Re-acceptance pre-write target attestation

Before the second authorized write, the exact target was freshly revalidated while the acceptance write gate was still disabled.

```text
instanceId = ins-mi85f3my
hostname = VM-0-12-ubuntu
publicIpv4 = 159.75.139.246
privateIpv4 = 172.16.0.12
containerId = b29798598ac043794420599c23f735c19038744a76f1b490b3e8c5a58e28e6be
image = sha256:c305de265b480160e24d0ad4ce75b7c4617a7f49a5a8497ef6ba71d99d9aa545
containerHealth = healthy
volumeDeviceInode = 64784:1835042
databaseDeviceInode = 64784:1835048
nginxSha256 = 35ea9acd80ba600e88d8c594a3a2558ec4cb57dd078c61d6832f5798c2eabc33
backendHealth = 200
localTlsRoute = 200
publicHealth = 200
prewriteRevision = 2
acceptanceWriteEnabled = false
```

Full pre-write attestation SHA-256:
`3da8f0cea76029e5f27244a4988257f9229c5e2d03860137591f3f35b67c0384`

Final immediately-pre-write attestation SHA-256:
`ab276166e3cdcc601fc397b95a9abe83c73b927ceba14e40e1403501c1a9fcbd`
## Bounded acceptance data

The candidate snapshot was validated by the **running production image's** strict V1 validator before opening the write gate.

Created product:

```text
SKU  = PROD10-ACCEPT-R2
Name = PROD-10 VCP 正式接入验收
```

Created task:

```text
ID      = TASK-PROD10-REACCEPT-R2
SKU     = PROD10-ACCEPT-R2
Status  = pending
Source  = submission
Kind    = 待定
Request = 平面 / 待定 / 1 deliverable / aspect ratio 待定
```

No session was created.

## Authorized guarded write

```text
operationId = prod10-reaccept-create-data-r2-0001
expectedRevision = 2
pushRevision = 3
verificationRevision = 3
realGuardedPushAttempts = 1
credentialExposed = false
```

The acceptance write gate was closed immediately after the single write attempt.
## Post-write verification

Verification through the live `JennShootingOperations` VCP tool returned revision 3 and the exact created product/task.

Post-write target continuity also passed:

```text
same instance = PASS
same container = PASS
same image = PASS
same Nginx route hash = PASS
container health = healthy
backend health = 200
public health = 200
verified revision = 3
acceptanceWriteEnabled = false
```

Post-write continuity SHA-256:
`9ffbbae81dfe8d969fa073556f33f6e6e83d5368d1c69bf0d0e175583b3aef45`

VCP-APP state remained:

```text
Hot Memory binding = resolved
Cold Memory binding = resolved
```

Kiosk and DingTalk were unchanged.
## Formal closure

The frozen PROD-10 readiness requirements are now satisfied:

```text
VCP runtime wiring proof       = PASS
VCP adapter revision           = PASS
service endpoint               = PASS
principal scope                = PASS
fresh exact target attestation = PASS
pull / guarded push / verify   = PASS
deployment chain               = PASS
```

Formal runtime receipt:

`policy/promotions/PROD10_REACCEPT_COMPLETE_20260929.json`

SHA-256:
`25817823aa7f7eb954f4fc072653b5e12b786e502552a16591fdd9ff0fb99689`

Canonical state:

```text
VCP_SOURCE_COMPATIBILITY = PASS
VCP_EXTERNAL_COMPATIBILITY = PASS
PROD-10-ENABLE-VCP-REMOTE-SYNC = COMPLETED
standing Agent write capability = DISABLED
acceptance write gate = DISABLED
nextActionId = PROD-11-ENABLE-KIOSK-IDENTITY-DEVICE
```

`ROLLBACK-09-DISABLE-VCP-CONFIG` remains configuration-only and does not erase committed revision 3 or the created acceptance task.

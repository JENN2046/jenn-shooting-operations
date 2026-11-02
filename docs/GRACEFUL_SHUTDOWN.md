# Native graceful shutdown

Both `node src/server.mjs` and `node src/server-conversation.mjs` handle SIGTERM
and SIGINT through their existing shared startup composition. No maintenance
endpoint, inspector, identity, schema change or additional supervisor is needed.

Shutdown stops accepting new connections and rejects any later HTTP request with
503 `SERVICE_SHUTTING_DOWN`. Requests already admitted may finish under their
original authority. It waits for both the async handler and the response/stream
to finish or close; disconnecting a client cannot close the database while its
handler is still running. Periodic orphan cleanup is stopped, then the existing
store is closed once. SIGUSR2 cannot enable writes while draining. Repeated
termination signals share the same operation and never force an early exit.

The default drain deadline is 25 seconds. Use a longer container stop grace
period, for example `docker stop --time 30 <verified-container>`. Configure the
equivalent stop timeout in the trusted deployment composition. Docker may still
SIGKILL at its outer deadline: exit 137 or any nonzero result is not a successful
drain and must not admit a replacement writer.

On timeout, the application logs a fixed `SHUTDOWN_TIMEOUT`, marks failure and
keeps resources alive for outstanding work. It does not call process.exit or
destroy active connections. If that work later finishes, resources close and the
process still exits unsuccessfully; it cannot turn an overdue drain into exit 0.
If work never settles, the listener remains closed and the process remains held
for operator reconciliation. A resource-close failure is likewise non-successful.
Existing nonzero exit status is preserved. Diagnostics contain fixed events and
counts only, never request bodies, credentials or raw exceptions.

Trusted in-process callers of `createOperationsServer` can use `shutdown()` and
await its `{ok,...}` result, or inspect `shutdownStatus()`/`shutdownCompletion`.
The legacy HTTP `server.close()` callback describes transport closure; callers
needing application-resource completion should await `shutdownCompletion`.

Tests cover in-flight SQL, slow real Schema12 reference upload, aborted clients,
streamed responses, repeated signals, timeouts, close failures and both real
entrypoints. All use synthetic data and isolated execution. The deployment R5
source digest changes with this code: install a newly approved immutable release
and its matching acceptance material; source/CI success is not deployment.

Node transport behavior: [Node 24 HTTP server.close](https://nodejs.org/download/release/v24.21.0/docs/api/http.html#serverclosecallback).

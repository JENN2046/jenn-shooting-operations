import { createSchedulingV2Application } from './server.mjs';
import { createJsoAgentApplication, createJsoAgentHttpHandler } from './jso-agent-api-v1.mjs';
import { createSqliteAgentGrantAttemptStoreV1 } from './sqlite-agent-grant-attempt-store-v1.mjs';

// JSO-side composition only: no listen(), identity discovery, environment secrets or default activation.
// Mount on a dedicated trusted listener; do not reuse these identities on legacy business routes.
export function createJsoAgentBoundary({ store, identities, clock = () => new Date(), allowedBriefHosts = [] }) {
  const scheduling = createSchedulingV2Application({ store, authenticate: () => null, clock, allowedBriefHosts });
  const attempts = createSqliteAgentGrantAttemptStoreV1({ db: store.db, now: clock });
  const application = createJsoAgentApplication({ service: scheduling.agentService, identities,
    claimGrantAttempt: attempts.claim, clock });
  return Object.freeze({ application, handler: createJsoAgentHttpHandler(application) });
}

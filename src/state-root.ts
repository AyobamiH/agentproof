import path from "node:path";

export function resolveAgentProofStateRoot(explicitRoot?: string): string {
  const root = explicitRoot?.trim() || process.env.OPENCLAW_OPERATOR_STATE_DIR?.trim();
  if (!root) {
    throw new Error("agentproof_state_root_required");
  }
  return path.resolve(root, "agentproof");
}

export function resolveAgentProofDatabasePath(explicitRoot?: string): string {
  return path.join(resolveAgentProofStateRoot(explicitRoot), "agentproof.sqlite");
}

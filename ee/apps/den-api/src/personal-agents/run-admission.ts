import { personalAgentToolPolicyBlocks } from "@openwork/automations"
import { agentToolLimitScopes } from "../mcp/workbot-turn-limits.js"
import { personalAgentRepository } from "./repository.js"

export type PersonalAgentRunAdmission =
  | { ok: true; agentName: string; brief: string; mcpScopes: string[] }
  | { ok: false; code: "execution_failed" | "execution_runtime_unavailable"; message: string }

/**
 * Decides whether a run of an agent's routine may start and what its
 * credential may reach. Called once per run, after it is claimed and before
 * anything is sent to the runner.
 */
export async function admitPersonalAgentRun(input: {
  agentRevisionId: string
  runId: string
  organizationId: string
  actingMemberId: string
  headless: boolean
}): Promise<PersonalAgentRunAdmission> {
  const pinned = await personalAgentRepository.runDefinition(input.agentRevisionId)
  if (!pinned || pinned.archived) {
    return { ok: false, code: "execution_failed", message: "This routine's agent no longer exists, so it did not run." }
  }
  const mcpScopes = agentToolLimitScopes(personalAgentToolPolicyBlocks(pinned.toolPolicy))
  if (mcpScopes.length > 0 && !input.headless) {
    return { ok: false, code: "execution_runtime_unavailable", message: "This agent limits which tools it may use, and only OpenWork Cloud's headless runtime can apply that. The run was not started." }
  }
  return { ok: true, agentName: pinned.agentName, brief: pinned.brief, mcpScopes }
}

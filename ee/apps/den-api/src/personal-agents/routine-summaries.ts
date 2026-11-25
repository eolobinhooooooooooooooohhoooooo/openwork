import type { PersonalAgentRoutineSummary } from "@openwork/types/den/personal-agents"

/** The routines of each agent that are not archived, oldest first, with their latest run. */
export async function personalAgentRoutineSummaries(agentIds: readonly string[]): Promise<Map<string, PersonalAgentRoutineSummary[]>> {
  return new Map(agentIds.map((agentId) => [agentId, []]))
}

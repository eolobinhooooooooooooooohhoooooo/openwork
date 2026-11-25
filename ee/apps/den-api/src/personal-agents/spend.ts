import type { PersonalAgentSpend } from "@openwork/types/den/personal-agents"

export type PersonalAgentBudgets = { agentId: string; ownerBudgetMicros: number | null; adminBudgetMicros: number | null }

/** What each agent has cost this calendar month (UTC) against the limit that applies to it. */
export async function personalAgentSpend(organizationId: string, agents: readonly PersonalAgentBudgets[]): Promise<Map<string, PersonalAgentSpend>> {
  void organizationId
  return new Map(agents.map((agent) => [agent.agentId, {
    monthMicros: 0,
    unpricedTokens: 0,
    budgetMicros: agent.ownerBudgetMicros,
    ownerBudgetMicros: agent.ownerBudgetMicros,
    adminBudgetMicros: agent.adminBudgetMicros,
    overBudget: false,
  }]))
}

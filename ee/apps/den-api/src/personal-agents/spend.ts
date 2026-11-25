import { and, eq, gte, inArray, lt } from "@openwork-ee/den-db/drizzle"
import { AutomationRunTable, AutomationTable } from "@openwork-ee/den-db/schema"
import { normalizeDenTypeId } from "@openwork-ee/utils/typeid"
import type { PersonalAgentSpend } from "@openwork/types/den/personal-agents"
import { db } from "../db.js"
import { getModelsDevProviders } from "../llm/models-dev.js"
import { personalAgentOrgPolicy } from "./permissions-policy.js"

export type PersonalAgentBudgets = { agentId: string; ownerBudgetMicros: number | null; adminBudgetMicros: number | null }

function rate(cost: unknown, key: "input" | "output"): number | null {
  if (!cost || typeof cost !== "object" || !(key in cost)) return null
  const value = key === "input" && "input" in cost ? cost.input : "output" in cost ? cost.output : null
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
}

export async function personalAgentSpend(organizationId: string, agents: readonly PersonalAgentBudgets[]): Promise<Map<string, PersonalAgentSpend>> {
  if (!agents.length) return new Map()
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  const [policy, runs] = await Promise.all([
    personalAgentOrgPolicy(organizationId),
    db.$primary.select({ agentId: AutomationTable.agent_id, usage: AutomationRunTable.usage, provider: AutomationRunTable.provider_id, model: AutomationRunTable.model_id })
      .from(AutomationTable).innerJoin(AutomationRunTable, eq(AutomationRunTable.automation_id, AutomationTable.id))
      .where(and(eq(AutomationTable.organization_id, normalizeDenTypeId("organization", organizationId)),
        inArray(AutomationTable.agent_id, agents.map(({ agentId }) => normalizeDenTypeId("personalAgent", agentId))),
        gte(AutomationRunTable.created_at, start), lt(AutomationRunTable.created_at, end))),
  ])
  const providerIds = [...new Set(runs.filter(({ usage }) => usage.costMicros === null && (usage.inputTokens || usage.outputTokens)).map(({ provider }) => provider))]
  const providers = providerIds.length ? await getModelsDevProviders(providerIds).catch(() => []) : []
  const catalog = new Map(providers.map((provider) => [provider.id, new Map(provider.models.map((model) => [model.id, model.config.cost]))]))
  const totals = new Map<string, { monthMicros: number; unpricedTokens: number }>()
  for (const run of runs) {
    if (!run.agentId) continue
    const total = totals.get(run.agentId) ?? { monthMicros: 0, unpricedTokens: 0 }
    const input = run.usage.inputTokens ?? 0
    const output = run.usage.outputTokens ?? 0
    if (run.usage.costMicros !== null) {
      total.monthMicros += run.usage.costMicros
    } else if (input || output) {
      const cost = catalog.get(run.provider)?.get(run.model)
      const inputRate = rate(cost, "input")
      const outputRate = rate(cost, "output")
      if ((input && inputRate === null) || (output && outputRate === null)) total.unpricedTokens += input + output
      else total.monthMicros += Math.round(input * (inputRate ?? 0) + output * (outputRate ?? 0))
    }
    totals.set(run.agentId, total)
  }
  return new Map(agents.map(({ agentId, ownerBudgetMicros, adminBudgetMicros }) => {
    const limits = [ownerBudgetMicros, adminBudgetMicros, policy?.monthly_budget_micros ?? null].filter((limit) => limit !== null)
    const budgetMicros = limits.length ? Math.min(...limits) : null
    const { monthMicros, unpricedTokens } = totals.get(agentId) ?? { monthMicros: 0, unpricedTokens: 0 }
    return [agentId, { monthMicros, unpricedTokens, budgetMicros, ownerBudgetMicros, adminBudgetMicros, overBudget: budgetMicros !== null && monthMicros >= budgetMicros }]
  }))
}

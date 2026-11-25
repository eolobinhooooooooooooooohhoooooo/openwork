import { and, eq, sql } from "@openwork-ee/den-db/drizzle"
import { AutomationRunTable, AutomationTable, PersonalAgentRequestTable, PersonalAgentTable } from "@openwork-ee/den-db/schema"
import { createDenTypeId, isDenTypeId, normalizeDenTypeId } from "@openwork-ee/utils/typeid"
import { db } from "../db.js"
import { AGENT_TOOL_WITHHELD_MESSAGE, connectionsWithheld, personalAgentRunId, personalAgentToolChoiceScope, toolsWithheld, WORKBOT_CONNECTION_WITHHELD_MESSAGE } from "../mcp/workbot-turn-limits.js"
import { personalAgentPeople, personOrUnknown } from "./access.js"
import { personalAgentRequestEventDetail, recordPersonalAgentEvent } from "./events.js"
import { personalAgentOrgPolicy, personalAgentPolicyBlocks, personalAgentToolIsReadOnly, personalAgentToolTitle } from "./permissions-policy.js"

export function personalAgentPolicyRefusal(message: string) {
  return { error: "policy_blocked", message, retryable: false, sameArgumentsRetryable: false } as const
}

export const PERSONAL_AGENT_UNAPPROVABLE_WRITE = "This tool cannot ask first yet, so an agent cannot use it to make changes."

async function personalAgentDispatchContext(runId: string, organizationId: string, actingMemberId?: string) {
  if (!isDenTypeId("automationRun", runId)) return null
  const [context] = await db.$primary.select({ agentId: PersonalAgentTable.id, paused: PersonalAgentTable.paused_at })
    .from(AutomationRunTable)
    .innerJoin(AutomationTable, eq(AutomationTable.id, AutomationRunTable.automation_id))
    .innerJoin(PersonalAgentTable, eq(PersonalAgentTable.id, AutomationTable.agent_id))
    .where(and(eq(AutomationRunTable.id, normalizeDenTypeId("automationRun", runId)),
      eq(AutomationTable.organization_id, normalizeDenTypeId("organization", organizationId)),
      actingMemberId ? eq(sql`coalesce(${AutomationRunTable.acting_member_id}, ${AutomationTable.owner_member_id})`, actingMemberId) : undefined)).limit(1)
  return context ?? null
}

export async function personalAgentRunDispatchRefusal(scopes: ReadonlySet<string>, organizationId: string) {
  const runId = personalAgentRunId(scopes)
  if (runId === undefined) return null
  const context = await personalAgentDispatchContext(runId, organizationId)
  if (!context) return personalAgentPolicyRefusal("This run could not be verified.")
  return context.paused ? personalAgentPolicyRefusal("An admin paused this agent.") : null
}

export async function personalAgentToolRefusal(input: {
  scopes: ReadonlySet<string>
  connection: { id: string; name: string; organizationId: string }
  tool: { name: string; title?: string; annotations?: { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean } }
  actingMemberId: string
}) {
  const runId = personalAgentRunId(input.scopes)
  if (runId === undefined) return null
  const { connection, tool, scopes } = input
  const orgMembershipId = normalizeDenTypeId("member", input.actingMemberId)
  const organizationId = normalizeDenTypeId("organization", connection.organizationId)
  const context = await personalAgentDispatchContext(runId, organizationId, orgMembershipId)
  if (!context) return { error: "forbidden", message: "This run could not be verified." } as const
  if (context.paused) return personalAgentPolicyRefusal("An admin paused this agent.")
  const orgPolicy = await personalAgentOrgPolicy(organizationId)
  if (orgPolicy && personalAgentPolicyBlocks(orgPolicy.tool_policy, connection.id, tool.name)) {
    return personalAgentPolicyRefusal(`${tool.name} ${AGENT_TOOL_WITHHELD_MESSAGE}`)
  }
  if (connectionsWithheld(scopes)?.has(connection.id)) {
    return { error: "forbidden", message: `"${connection.name}" ${WORKBOT_CONNECTION_WITHHELD_MESSAGE}` } as const
  }
  if (toolsWithheld(scopes)?.get(connection.id)?.has(tool.name)) {
    return { error: "policy_blocked", message: `${tool.name} ${AGENT_TOOL_WITHHELD_MESSAGE}`, sameArgumentsRetryable: false } as const
  }
  if (scopes.has(personalAgentToolChoiceScope("allow", connection.id, tool.name))) return null
  if (!scopes.has(personalAgentToolChoiceScope("ask", connection.id, tool.name)) && personalAgentToolIsReadOnly(tool.annotations)) return null

  const run = normalizeDenTypeId("automationRun", runId)
  const agentId = context.agentId
  const title = personalAgentToolTitle(tool)
  const created = await db.transaction(async (tx) => {
    await tx.select({ id: PersonalAgentTable.id }).from(PersonalAgentTable).where(eq(PersonalAgentTable.id, agentId)).for("update")
    const [existing] = await tx.select({ id: PersonalAgentRequestTable.id }).from(PersonalAgentRequestTable).where(and(
      eq(PersonalAgentRequestTable.agent_id, agentId), eq(PersonalAgentRequestTable.kind, "tool"), eq(PersonalAgentRequestTable.status, "pending"),
      eq(PersonalAgentRequestTable.requested_by_member_id, orgMembershipId), eq(PersonalAgentRequestTable.connection_id, connection.id),
      sql`binary ${PersonalAgentRequestTable.tool_name} = ${tool.name}`,
    )).limit(1)
    if (existing) return false
    await tx.insert(PersonalAgentRequestTable).values({
      id: createDenTypeId("personalAgentRequest"), organization_id: organizationId, agent_id: agentId, kind: "tool",
      run_id: run, requested_by_member_id: orgMembershipId, connection_id: connection.id, connection_name: connection.name.slice(0, 160),
      tool_name: tool.name, tool_title: title,
    })
    return true
  })
  if (created) {
    const people = await personalAgentPeople(organizationId, [orgMembershipId])
    await recordPersonalAgentEvent({ organizationId, agentId, actorMemberId: orgMembershipId, action: "request.asked",
      detail: personalAgentRequestEventDetail({ requester: personOrUnknown(people, orgMembershipId).name, kind: "tool", tool: title, connection: connection.name.slice(0, 160) }),
    })
  }
  return {
    error: "needs_approval",
    message: `${title} needs a yes from a person first. I asked in this agent's chat. Do not try it again in this run: finish what you can and say what is waiting.`,
    retryable: false, sameArgumentsRetryable: false,
  } as const
}

import { and, eq, sql } from "@openwork-ee/den-db/drizzle"
import { AutomationRunTable, AutomationTable, PersonalAgentRequestTable, PersonalAgentTable } from "@openwork-ee/den-db/schema"
import { createDenTypeId, isDenTypeId, normalizeDenTypeId } from "@openwork-ee/utils/typeid"
import { db } from "../db.js"
import { AGENT_TOOL_WITHHELD_MESSAGE, connectionsWithheld, personalAgentRunId, personalAgentToolChoiceScope, toolsWithheld, WORKBOT_CONNECTION_WITHHELD_MESSAGE } from "../mcp/workbot-turn-limits.js"
import { recordPersonalAgentEvent } from "./events.js"
import { personalAgentToolIsReadOnly, personalAgentToolTitle } from "./permissions-policy.js"

export async function personalAgentToolRefusal(input: {
  scopes: ReadonlySet<string>
  connection: { id: string; name: string; organizationId: string }
  tool: { name: string; title?: string; annotations?: { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean } }
  actingMemberId: string
}) {
  const runId = personalAgentRunId(input.scopes)
  if (runId === undefined) return null
  const { connection, tool, scopes } = input
  if (connectionsWithheld(scopes)?.has(connection.id)) {
    return { error: "forbidden", message: `"${connection.name}" ${WORKBOT_CONNECTION_WITHHELD_MESSAGE}` } as const
  }
  if (toolsWithheld(scopes)?.get(connection.id)?.has(tool.name)) {
    return { error: "policy_blocked", message: `${tool.name} ${AGENT_TOOL_WITHHELD_MESSAGE}`, sameArgumentsRetryable: false } as const
  }
  const orgMembershipId = normalizeDenTypeId("member", input.actingMemberId)
  if (!isDenTypeId("automationRun", runId)) return { error: "forbidden", message: "This run could not be verified." } as const
  if (scopes.has(personalAgentToolChoiceScope("allow", connection.id, tool.name))) return null
  if (!scopes.has(personalAgentToolChoiceScope("ask", connection.id, tool.name)) && personalAgentToolIsReadOnly(tool.annotations)) return null

  const organizationId = normalizeDenTypeId("organization", connection.organizationId)
  const run = normalizeDenTypeId("automationRun", runId)
  const [context] = await db.$primary.select({ agentId: AutomationTable.agent_id }).from(AutomationRunTable)
    .innerJoin(AutomationTable, eq(AutomationTable.id, AutomationRunTable.automation_id))
    .where(and(eq(AutomationRunTable.id, run), eq(AutomationTable.organization_id, organizationId),
      eq(sql`coalesce(${AutomationRunTable.acting_member_id}, ${AutomationTable.owner_member_id})`, orgMembershipId))).limit(1)
  if (!context?.agentId) return { error: "forbidden", message: "This run could not be verified." } as const
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
  if (created) await recordPersonalAgentEvent({ organizationId, agentId, actorMemberId: orgMembershipId, action: "request.asked", detail: { tool: title, connection: connection.name.slice(0, 160) } })
  return {
    error: "needs_approval",
    message: `${title} needs a yes from a person first. I asked in this agent's chat. Do not try it again in this run: finish what you can and say what is waiting.`,
    retryable: false, sameArgumentsRetryable: false,
  } as const
}

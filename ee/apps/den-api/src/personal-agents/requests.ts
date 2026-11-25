import { and, count, desc, eq, gte, inArray, ne, or } from "@openwork-ee/den-db/drizzle"
import { AutomationTable, PersonalAgentRequestTable, PersonalAgentShareTable, PersonalAgentTable } from "@openwork-ee/den-db/schema"
import { createDenTypeId, isDenTypeId, normalizeDenTypeId } from "@openwork-ee/utils/typeid"
import type { PersonalAgentChange, PersonalAgentRequest, PersonalAgentRequestDecision } from "@openwork/types/den/personal-agents"
import { automationService } from "../automations/service.js"
import { db } from "../db.js"
import { canManagePersonalAgent, personalAgentOwnerScope, personalAgentPeople, personOrUnknown, type PersonalAgentAccess, type PersonalAgentCaller } from "./access.js"
import { recordPersonalAgentEvent } from "./events.js"
import { personalAgentRepository } from "./repository.js"
import { personalAgentService } from "./service.js"

type RequestRow = typeof PersonalAgentRequestTable.$inferSelect

function decisions(access: PersonalAgentAccess, memberId: string, row: RequestRow): PersonalAgentRequestDecision[] {
  if (row.status !== "pending" || access.state !== "active") return []
  if (canManagePersonalAgent(access.role)) return row.kind === "tool" ? ["deny", "allow_once", "always_allow"] : ["deny", "approve"]
  return row.kind === "tool" && row.requested_by_member_id === memberId ? ["deny", "allow_once"] : []
}

async function requestViews(access: PersonalAgentAccess, memberId: string, rows: RequestRow[]): Promise<PersonalAgentRequest[]> {
  const people = await personalAgentPeople(access.organizationId, rows.flatMap((row) => [row.requested_by_member_id, ...(row.decided_by_member_id ? [row.decided_by_member_id] : [])]))
  return rows.map((row) => ({
    id: row.id, agentId: row.agent_id, kind: row.kind, status: row.status, requestedBy: personOrUnknown(people, row.requested_by_member_id),
    runId: row.run_id, connectionId: row.connection_id, connectionName: row.connection_name, toolName: row.tool_name, toolTitle: row.tool_title,
    summary: row.summary, change: row.change, decidedBy: row.decided_by_member_id ? personOrUnknown(people, row.decided_by_member_id) : null,
    decidedAt: row.decided_at?.getTime() ?? null, createdAt: row.created_at.getTime(), canDecide: decisions(access, memberId, row),
  }))
}

function requestOfAgent(access: PersonalAgentAccess) {
  return and(eq(PersonalAgentRequestTable.organization_id, normalizeDenTypeId("organization", access.organizationId)),
    eq(PersonalAgentRequestTable.agent_id, normalizeDenTypeId("personalAgent", access.agentId)))
}

export async function listPersonalAgentRequests(access: PersonalAgentAccess, caller: PersonalAgentCaller) {
  const memberId = normalizeDenTypeId("member", caller.memberId)
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const rows = await db.$primary.select().from(PersonalAgentRequestTable).where(and(requestOfAgent(access),
    or(eq(PersonalAgentRequestTable.status, "pending"), gte(PersonalAgentRequestTable.decided_at, cutoff)),
    canManagePersonalAgent(access.role) ? undefined : eq(PersonalAgentRequestTable.requested_by_member_id, memberId),
  )).orderBy(desc(PersonalAgentRequestTable.created_at), desc(PersonalAgentRequestTable.id)).limit(50)
  return { items: await requestViews(access, memberId, rows) }
}

async function changeRoutine(access: PersonalAgentAccess, change: PersonalAgentChange) {
  if (!change.schedule && !change.instructions) return null
  const scope = personalAgentOwnerScope(access)
  const routineId = change.routineId
  if (routineId) {
    const routine = await automationService.get(scope, routineId)
    if (routine?.automation.agentId !== access.agentId || routine.automation.state === "archived") throw new Error("personal_agent_routine_not_found")
    return routineId
  }
  const rows = await db.$primary.select({ id: AutomationTable.id }).from(AutomationTable).where(and(
    eq(AutomationTable.organization_id, normalizeDenTypeId("organization", access.organizationId)),
    eq(AutomationTable.agent_id, normalizeDenTypeId("personalAgent", access.agentId)), ne(AutomationTable.state, "archived"),
  )).limit(2)
  if (rows.length !== 1) throw new Error(rows.length ? "personal_agent_routine_ambiguous" : "personal_agent_routine_required")
  return rows[0].id
}

export async function createPersonalAgentChangeRequest(access: PersonalAgentAccess, caller: PersonalAgentCaller, input: { summary: string; change: PersonalAgentChange }) {
  if (access.state !== "active") throw new Error("personal_agent_forbidden")
  const memberId = normalizeDenTypeId("member", caller.memberId)
  const routineId = await changeRoutine(access, input.change)
  const id = createDenTypeId("personalAgentRequest")
  const changed = routineId ? { ...input.change, routineId } : input.change
  await db.insert(PersonalAgentRequestTable).values({
    id, organization_id: normalizeDenTypeId("organization", access.organizationId), agent_id: normalizeDenTypeId("personalAgent", access.agentId),
    kind: "change", requested_by_member_id: memberId, summary: input.summary, change: changed,
  })
  await recordPersonalAgentEvent({ organizationId: access.organizationId, agentId: access.agentId, actorMemberId: memberId, action: "request.asked", detail: { summary: input.summary.slice(0, 240) } })
  const [row] = await db.$primary.select().from(PersonalAgentRequestTable).where(eq(PersonalAgentRequestTable.id, id)).limit(1)
  return (await requestViews(access, memberId, [row]))[0]
}

const decisionsApplied = { deny: "denied", allow_once: "allowed_once", always_allow: "always_allowed", approve: "approved" } as const

export async function decidePersonalAgentRequest(access: PersonalAgentAccess, caller: PersonalAgentCaller, requestId: string, decision: PersonalAgentRequestDecision) {
  if (!isDenTypeId("personalAgentRequest", requestId)) return null
  const memberId = normalizeDenTypeId("member", caller.memberId)
  const scope = personalAgentOwnerScope(access)
  const row = await db.transaction(async (tx) => {
    const [request] = await tx.select().from(PersonalAgentRequestTable).where(and(requestOfAgent(access),
      eq(PersonalAgentRequestTable.id, normalizeDenTypeId("personalAgentRequest", requestId)),
    )).limit(1).for("update")
    if (!request) return null
    if (!canManagePersonalAgent(access.role) && memberId !== request.requested_by_member_id) throw new Error("personal_agent_forbidden")
    if (request.status !== "pending") throw new Error("personal_agent_request_decided")
    if (!decisions(access, memberId, request).includes(decision)) throw new Error("personal_agent_forbidden")
    if (decision === "always_allow" && request.connection_id && request.tool_name) {
      const current = await personalAgentRepository.get({ ...scope, agentId: access.agentId })
      if (!current) throw new Error("personal_agent_not_found")
      const policy = current.revision.toolPolicy
      const updated = await personalAgentService.update(scope, access.agentId, { toolPolicy: {
        connections: policy.connections,
        tools: { ...policy.tools, [request.connection_id]: { ...policy.tools[request.connection_id], [request.tool_name]: "allow" } },
      } }, memberId)
      if (!updated) throw new Error("personal_agent_not_found")
    }
    if (decision === "approve" && request.change) {
      const { schedule, instructions, brief } = request.change
      const routineId = await changeRoutine(access, request.change)
      if (routineId) {
        const updated = await automationService.update(scope, routineId, { schedule, instructions })
        if (!updated) throw new Error("personal_agent_routine_not_found")
      }
      if (brief && !await personalAgentService.update(scope, access.agentId, { brief }, memberId)) throw new Error("personal_agent_not_found")
    }
    const changes = { status: decisionsApplied[decision], decided_by_member_id: memberId, decided_at: new Date() }
    await tx.update(PersonalAgentRequestTable).set(changes).where(eq(PersonalAgentRequestTable.id, request.id))
    return { ...request, ...changes }
  })
  if (!row) return null
  const [view] = await requestViews(access, memberId, [row])
  await recordPersonalAgentEvent({ organizationId: access.organizationId, agentId: access.agentId, actorMemberId: memberId,
    action: `request.${decisionsApplied[decision]}`, detail: { requester: view.requestedBy.name.slice(0, 240), ...(row.kind === "tool" ? { tool: row.tool_title } : { summary: row.summary?.slice(0, 240) ?? null }) },
  })
  return view
}

export async function openPersonalAgentRequestCounts(caller: PersonalAgentCaller, agentIds: readonly string[]): Promise<Map<string, number>> {
  const ids = agentIds.filter((id) => isDenTypeId("personalAgent", id)).map((id) => normalizeDenTypeId("personalAgent", id))
  if (!ids.length) return new Map()
  const memberId = normalizeDenTypeId("member", caller.memberId)
  const rows = await db.$primary.select({ agentId: PersonalAgentRequestTable.agent_id, total: count() }).from(PersonalAgentRequestTable)
    .innerJoin(PersonalAgentTable, eq(PersonalAgentTable.id, PersonalAgentRequestTable.agent_id))
    .leftJoin(PersonalAgentShareTable, and(eq(PersonalAgentShareTable.agent_id, PersonalAgentTable.id), eq(PersonalAgentShareTable.member_id, memberId)))
    .where(and(
      eq(PersonalAgentRequestTable.organization_id, normalizeDenTypeId("organization", caller.organizationId)), inArray(PersonalAgentRequestTable.agent_id, ids),
      eq(PersonalAgentRequestTable.status, "pending"), eq(PersonalAgentTable.state, "active"),
      or(eq(PersonalAgentTable.owner_member_id, memberId), eq(PersonalAgentShareTable.role, "manager"), and(
        eq(PersonalAgentShareTable.role, "collaborator"), eq(PersonalAgentRequestTable.kind, "tool"), eq(PersonalAgentRequestTable.requested_by_member_id, memberId),
      )),
    )).groupBy(PersonalAgentRequestTable.agent_id)
  return new Map(rows.map(({ agentId, total }) => [agentId, total]))
}

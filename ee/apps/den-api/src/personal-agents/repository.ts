import { createHash } from "node:crypto"
import { and, asc, desc, eq, inArray, isNotNull, lt, or } from "@openwork-ee/den-db/drizzle"
import { AuthUserTable, MemberTable, PersonalAgentChatTable, PersonalAgentRevisionTable, PersonalAgentShareTable, PersonalAgentTable } from "@openwork-ee/den-db/schema"
import { createDenTypeId, isDenTypeId, normalizeDenTypeId } from "@openwork-ee/utils/typeid"
import type {
  CreatePersonalAgent,
  PersonalAgentChat,
  PersonalAgentShareRole,
  PersonalAgentShareList,
  SetPersonalAgentChat,
  PersonalAgent,
  PersonalAgentDetail,
  PersonalAgentRevision,
  PersonalAgentToolPolicy,
  UpdatePersonalAgent,
} from "@openwork/types/den/personal-agents"
import { archiveAgentRoutines, repinAgentRoutines } from "../automations/repository.js"
import { db } from "../db.js"
import { peopleMemberCondition } from "../setup-agent-members.js"
import { personalAgentAccess, personalAgentPeople, personOrUnknown, type PersonalAgentAccess, type PersonalAgentCaller } from "./access.js"
import { recordPersonalAgentEvent } from "./events.js"
import { openPersonalAgentRequestCounts } from "./requests.js"
import { personalAgentRoutineSummaries } from "./routine-summaries.js"
import { personalAgentSpend } from "./spend.js"

type AgentRow = typeof PersonalAgentTable.$inferSelect
type RevisionRow = typeof PersonalAgentRevisionTable.$inferSelect
type Scope = { organizationId: string; ownerMemberId: string }
type Definition = Pick<PersonalAgentRevision, "brief" | "toolPolicy" | "defaultExecutionTarget" | "monthlyBudgetMicros">

function mapAgent(row: AgentRow): PersonalAgent {
  return {
    id: row.id,
    organizationId: row.organization_id,
    ownerMemberId: row.owner_member_id,
    name: row.name,
    state: row.state,
    currentRevisionId: row.current_revision_id,
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
    archivedAt: row.archived_at?.getTime() ?? null,
    pausedAt: row.paused_at?.getTime() ?? null,
  }
}

function mapRevision(row: RevisionRow): PersonalAgentRevision {
  return {
    id: row.id,
    agentId: row.agent_id,
    version: row.version,
    brief: row.brief,
    toolPolicy: row.tool_policy,
    defaultExecutionTarget: row.default_execution_target,
    monthlyBudgetMicros: row.monthly_budget_micros,
    digest: row.digest.slice(0, 64),
    createdAt: row.created_at.getTime(),
  }
}

function sortedRecord<T>(record: Record<string, T>, value: (entry: T) => unknown): Array<[string, unknown]> {
  return Object.keys(record).sort().map((key) => [key, value(record[key])])
}

function definitionDigest(definition: Definition): string {
  return createHash("sha256").update(JSON.stringify([
    definition.brief,
    sortedRecord(definition.toolPolicy.connections, (access) => access),
    sortedRecord(definition.toolPolicy.tools, (tools) => sortedRecord(tools, (access) => access)),
    definition.defaultExecutionTarget,
    definition.monthlyBudgetMicros,
  ])).digest("hex")
}

function ownerFilter(scope: Scope, agentId: string) {
  return and(
    eq(PersonalAgentTable.id, normalizeDenTypeId("personalAgent", agentId)),
    eq(PersonalAgentTable.organization_id, normalizeDenTypeId("organization", scope.organizationId)),
    eq(PersonalAgentTable.owner_member_id, normalizeDenTypeId("member", scope.ownerMemberId)),
  )
}

async function sharesFor(organizationId: string, agentIds: AgentRow["id"][]) {
  return db.$primary.select().from(PersonalAgentShareTable).where(and(
    eq(PersonalAgentShareTable.organization_id, normalizeDenTypeId("organization", organizationId)),
    inArray(PersonalAgentShareTable.agent_id, agentIds),
  )).orderBy(asc(PersonalAgentShareTable.created_at), asc(PersonalAgentShareTable.id))
}

function creationFingerprint(definition: Pick<CreatePersonalAgent, "name" | "brief">) {
  return createHash("sha256").update(JSON.stringify([definition.name, definition.brief])).digest("hex")
}

function duplicateEntry(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (("code" in current && current.code === "ER_DUP_ENTRY") || ("errno" in current && current.errno === 1062) || /Duplicate entry|errno 1062/.test(current.message)) return true
  }
  return false
}

async function details(agents: AgentRow[], input: PersonalAgentCaller): Promise<PersonalAgentDetail[]> {
  if (agents.length === 0) return []
  const caller = { ...input, memberId: normalizeDenTypeId("member", input.memberId) }
  const ids = agents.map((agent) => agent.id)
  const [revisions, shares, routines, requests] = await Promise.all([
    db.$primary.select().from(PersonalAgentRevisionTable)
      .where(inArray(PersonalAgentRevisionTable.id, agents.map((agent) => agent.current_revision_id))),
    sharesFor(caller.organizationId, ids),
    personalAgentRoutineSummaries(ids, caller.memberId),
    openPersonalAgentRequestCounts(caller, ids),
  ])
  const revisionById = new Map(revisions.map((revision) => [revision.id, revision]))
  const [people, spend] = await Promise.all([
    personalAgentPeople(caller.organizationId, [...agents.map((agent) => agent.owner_member_id), ...shares.map((share) => share.member_id)]),
    personalAgentSpend(caller.organizationId, agents.map((agent) => ({
      agentId: agent.id,
      ownerBudgetMicros: revisionById.get(agent.current_revision_id)?.monthly_budget_micros ?? null,
      adminBudgetMicros: agent.admin_monthly_budget_micros,
    }))),
  ])
  return agents.flatMap((agent) => {
    const revision = revisionById.get(agent.current_revision_id)
    const usage = spend.get(agent.id)
    if (!revision || !usage) throw new Error("personal_agent_detail_not_found")
    const agentShares = shares.filter((share) => share.agent_id === agent.id)
    const role = agent.owner_member_id === caller.memberId ? "owner" : agentShares.find((share) => share.member_id === caller.memberId)?.role
    if (!role) return []
    const agentRoutines = routines.get(agent.id) ?? []
    return [{
      agent: mapAgent(agent), revision: mapRevision(revision), routineCount: agentRoutines.length,
      role, owner: personOrUnknown(people, agent.owner_member_id),
      sharedWith: agentShares.map((share) => ({ ...personOrUnknown(people, share.member_id), role: share.role, createdAt: share.created_at.getTime() })),
      routines: agentRoutines, spend: usage, openRequestCount: requests.get(agent.id) ?? 0,
    }]
  })
}

function chatFilter(caller: PersonalAgentCaller, agentId: string, workspaceId: string) {
  return and(
    eq(PersonalAgentChatTable.organization_id, normalizeDenTypeId("organization", caller.organizationId)),
    eq(PersonalAgentChatTable.agent_id, normalizeDenTypeId("personalAgent", agentId)),
    eq(PersonalAgentChatTable.member_id, normalizeDenTypeId("member", caller.memberId)),
    eq(PersonalAgentChatTable.workspace_id, workspaceId),
  )
}

export const personalAgentRepository = {
  async replayCreate(input: Scope & { definition: CreatePersonalAgent }): Promise<PersonalAgentDetail | null> {
    if (!input.definition.idempotencyKey) return null
    const [agent] = await db.$primary.select().from(PersonalAgentTable).where(and(
      eq(PersonalAgentTable.organization_id, normalizeDenTypeId("organization", input.organizationId)),
      eq(PersonalAgentTable.created_by_member_id, normalizeDenTypeId("member", input.ownerMemberId)),
      eq(PersonalAgentTable.idempotency_key, input.definition.idempotencyKey),
    )).limit(1)
    if (!agent) return null
    const [original] = await db.$primary.select({ digest: PersonalAgentRevisionTable.digest }).from(PersonalAgentRevisionTable).where(and(
      eq(PersonalAgentRevisionTable.agent_id, agent.id), eq(PersonalAgentRevisionTable.version, 1),
    )).limit(1)
    if (original?.digest.slice(64) !== creationFingerprint(input.definition)) throw new Error("personal_agent_idempotency_conflict")
    const caller = { organizationId: input.organizationId, memberId: input.ownerMemberId }
    if (!await personalAgentAccess(caller, agent.id)) throw new Error("personal_agent_not_found")
    const [detail] = await details([agent], caller)
    if (!detail) throw new Error("personal_agent_not_found")
    return detail
  },

  async create(input: Scope & { definition: CreatePersonalAgent; toolPolicy: PersonalAgentToolPolicy; now: number }): Promise<PersonalAgentDetail> {
    const agentId = createDenTypeId("personalAgent")
    const revisionId = createDenTypeId("personalAgentRevision")
    const now = new Date(input.now)
    const definition: Definition = {
      brief: input.definition.brief,
      toolPolicy: input.toolPolicy,
      defaultExecutionTarget: input.definition.defaultExecutionTarget ?? "cloud",
      monthlyBudgetMicros: input.definition.monthlyBudgetMicros ?? null,
    }
    try {
      await db.transaction(async (tx) => {
        await tx.insert(PersonalAgentRevisionTable).values({
          id: revisionId,
          agent_id: agentId,
          version: 1,
          brief: definition.brief,
          tool_policy: definition.toolPolicy,
          default_execution_target: definition.defaultExecutionTarget,
          monthly_budget_micros: definition.monthlyBudgetMicros,
          digest: definitionDigest(definition) + (input.definition.idempotencyKey ? creationFingerprint(input.definition) : ""),
          created_at: now,
        })
        await tx.insert(PersonalAgentTable).values({
          id: agentId,
          organization_id: normalizeDenTypeId("organization", input.organizationId),
          owner_member_id: normalizeDenTypeId("member", input.ownerMemberId),
          created_by_member_id: normalizeDenTypeId("member", input.ownerMemberId),
          idempotency_key: input.definition.idempotencyKey ?? null,
          name: input.definition.name,
          state: "active",
          current_revision_id: revisionId,
          archived_at: null,
          created_at: now,
          updated_at: now,
        })
      })
    } catch (error) {
      if (duplicateEntry(error)) {
        const replayed = await this.replayCreate(input)
        if (replayed) return replayed
      }
      throw error
    }
    await recordPersonalAgentEvent({ ...input, agentId, actorMemberId: input.ownerMemberId, action: "agent.created" })
    const created = await this.get({ ...input, agentId })
    if (!created) throw new Error("personal_agent_create_not_durable")
    return created
  },

  async update(input: Scope & {
    agentId: string
    changes: UpdatePersonalAgent
    actorMemberId?: string
    toolPolicy: PersonalAgentToolPolicy | undefined
    now: number
  }): Promise<PersonalAgentDetail | null> {
    if (!isDenTypeId("personalAgent", input.agentId)) return null
    const found = await db.transaction(async (tx) => {
      const [agent] = await tx.select().from(PersonalAgentTable).where(ownerFilter(input, input.agentId)).limit(1).for("update")
      if (!agent || agent.state === "archived") return null
      const [current] = await tx.select().from(PersonalAgentRevisionTable)
        .where(eq(PersonalAgentRevisionTable.id, agent.current_revision_id)).limit(1)
      if (!current) throw new Error("personal_agent_revision_not_found")
      const definition: Definition = {
        brief: input.changes.brief ?? current.brief,
        toolPolicy: input.toolPolicy ?? current.tool_policy,
        defaultExecutionTarget: input.changes.defaultExecutionTarget ?? current.default_execution_target,
        monthlyBudgetMicros: input.changes.monthlyBudgetMicros === undefined
          ? current.monthly_budget_micros
          : input.changes.monthlyBudgetMicros,
      }
      const digest = definitionDigest(definition)
      const now = new Date(input.now)
      const changed = {
        name: input.changes.name !== undefined && input.changes.name !== agent.name,
        brief: definition.brief !== current.brief,
        tools: definitionDigest({ ...definition, toolPolicy: current.tool_policy }) !== digest,
        budget: definition.monthlyBudgetMicros !== current.monthly_budget_micros,
      }
      if (digest === current.digest.slice(0, 64)) {
        await tx.update(PersonalAgentTable).set({ name: input.changes.name ?? agent.name, updated_at: now })
          .where(eq(PersonalAgentTable.id, agent.id))
        return changed
      }
      const revisionId = createDenTypeId("personalAgentRevision")
      await tx.insert(PersonalAgentRevisionTable).values({
        id: revisionId,
        agent_id: agent.id,
        version: current.version + 1,
        brief: definition.brief,
        tool_policy: definition.toolPolicy,
        default_execution_target: definition.defaultExecutionTarget,
        monthly_budget_micros: definition.monthlyBudgetMicros,
        digest,
        created_at: now,
      })
      await tx.update(PersonalAgentTable).set({
        name: input.changes.name ?? agent.name,
        current_revision_id: revisionId,
        updated_at: now,
      }).where(eq(PersonalAgentTable.id, agent.id))
      await repinAgentRoutines(tx, { agentId: agent.id, agentRevisionId: revisionId, now: input.now })
      return changed
    })
    if (!found) return null
    const memberId = input.actorMemberId ?? input.ownerMemberId
    await recordPersonalAgentEvent({ ...input, actorMemberId: memberId, action: "agent.updated", detail: found })
    return this.get({ ...input, memberId })
  },

  async list(input: Scope & { cursor?: string; limit: number }): Promise<{ items: PersonalAgentDetail[]; nextCursor: string | null }> {
    const limit = Math.max(1, Math.min(input.limit, 100))
    const organizationId = normalizeDenTypeId("organization", input.organizationId)
    const memberId = normalizeDenTypeId("member", input.ownerMemberId)
    const shares = db.$primary.select({ id: PersonalAgentShareTable.agent_id }).from(PersonalAgentShareTable).where(and(
      eq(PersonalAgentShareTable.organization_id, organizationId), eq(PersonalAgentShareTable.member_id, memberId),
    ))
    const conditions = [
      eq(PersonalAgentTable.organization_id, normalizeDenTypeId("organization", input.organizationId)),
      or(eq(PersonalAgentTable.owner_member_id, memberId), inArray(PersonalAgentTable.id, shares)),
      eq(PersonalAgentTable.state, "active"),
    ]
    if (input.cursor) {
      if (!isDenTypeId("personalAgent", input.cursor)) return { items: [], nextCursor: null }
      conditions.push(lt(PersonalAgentTable.id, normalizeDenTypeId("personalAgent", input.cursor)))
    }
    const rows = await db.$primary.select().from(PersonalAgentTable).where(and(...conditions))
      .orderBy(desc(PersonalAgentTable.id)).limit(limit + 1)
    const selected = rows.slice(0, limit)
    return { items: await details(selected, { organizationId, memberId }), nextCursor: rows.length > limit ? selected.at(-1)?.id ?? null : null }
  },

  async get(input: Scope & { agentId: string; memberId?: string }): Promise<PersonalAgentDetail | null> {
    if (!isDenTypeId("personalAgent", input.agentId)) return null
    const rows = await db.$primary.select().from(PersonalAgentTable).where(ownerFilter(input, input.agentId)).limit(1)
    return (await details(rows, { organizationId: input.organizationId, memberId: input.memberId ?? input.ownerMemberId }))[0] ?? null
  },

  async archive(input: Scope & { agentId: string; now: number; adminMemberId?: string }): Promise<PersonalAgentDetail | null> {
    if (!isDenTypeId("personalAgent", input.agentId)) return null
    const found = await db.transaction(async (tx) => {
      const [agent] = await tx.select().from(PersonalAgentTable).where(ownerFilter(input, input.agentId)).limit(1).for("update")
      if (!agent) return null
      if (agent.state === "archived") return false
      const now = new Date(input.now)
      await tx.update(PersonalAgentTable).set({ state: "archived", archived_at: now, updated_at: now })
        .where(eq(PersonalAgentTable.id, agent.id))
      await archiveAgentRoutines(tx, { agentId: agent.id, now: input.now })
      return true
    })
    if (found === null) return null
    if (found) {
      await recordPersonalAgentEvent({
        organizationId: input.organizationId,
        agentId: input.agentId,
        actorMemberId: input.adminMemberId ?? input.ownerMemberId,
        action: "agent.archived",
        detail: input.adminMemberId ? { byAdmin: true } : {},
      })
    }
    return this.get(input)
  },

  async shares(access: PersonalAgentAccess): Promise<PersonalAgentShareList> {
    const rows = await sharesFor(access.organizationId, [normalizeDenTypeId("personalAgent", access.agentId)])
    const people = await personalAgentPeople(access.organizationId, [access.ownerMemberId, ...rows.map((row) => row.member_id)])
    return {
      owner: personOrUnknown(people, access.ownerMemberId),
      items: rows.map((row) => ({ ...personOrUnknown(people, row.member_id), role: row.role, createdAt: row.created_at.getTime() })),
    }
  },

  async changeShare(access: PersonalAgentAccess, caller: PersonalAgentCaller, targetId: string, role: PersonalAgentShareRole | null) {
    const agentId = normalizeDenTypeId("personalAgent", access.agentId)
    const organizationId = normalizeDenTypeId("organization", caller.organizationId)
    const actorMemberId = normalizeDenTypeId("member", caller.memberId)
    if (!isDenTypeId("member", targetId)) return { status: "member_not_found" } as const
    const memberId = normalizeDenTypeId("member", targetId)
    const result = await db.transaction(async (tx) => {
      const [agent] = await tx.select().from(PersonalAgentTable).where(and(eq(PersonalAgentTable.id, agentId), eq(PersonalAgentTable.organization_id, organizationId))).limit(1).for("update")
      if (!agent) return { status: "agent_not_found" } as const
      const shareFilter = (id: typeof memberId) => and(eq(PersonalAgentShareTable.agent_id, agentId), eq(PersonalAgentShareTable.member_id, id))
      const [actor] = actorMemberId === agent.owner_member_id ? [] : await tx.select().from(PersonalAgentShareTable).where(shareFilter(actorMemberId)).limit(1).for("update")
      const actorRole = actorMemberId === agent.owner_member_id ? "owner" : actor?.role
      if (!actorRole) return { status: "agent_not_found" } as const
      const [current] = await tx.select().from(PersonalAgentShareTable).where(shareFilter(memberId)).limit(1).for("update")
      const selfRemoval = role === null && actorMemberId === memberId && !!actor
      const managesCollaborator = actorRole === "manager" && current?.role !== "manager" && role !== "manager"
      if (memberId === agent.owner_member_id || !(actorRole === "owner" || managesCollaborator || selfRemoval)) return { status: "forbidden" } as const
      const [person] = await tx.select({ name: AuthUserTable.name }).from(MemberTable)
        .innerJoin(AuthUserTable, eq(AuthUserTable.id, MemberTable.userId))
        .where(and(eq(MemberTable.id, memberId), eq(MemberTable.organizationId, organizationId), role ? peopleMemberCondition() : undefined, isNotNull(MemberTable.userId))).limit(1)
      if (role && !person) return { status: "member_not_found" } as const
      const eventRole = role ?? current?.role
      if (!eventRole || current?.role === role) return { status: "ok", ownerMemberId: agent.owner_member_id } as const
      if (role === null) await tx.delete(PersonalAgentShareTable).where(shareFilter(memberId))
      else if (current) await tx.update(PersonalAgentShareTable).set({ role }).where(shareFilter(memberId))
      else await tx.insert(PersonalAgentShareTable).values({ id: createDenTypeId("personalAgentShare"), organization_id: organizationId, agent_id: agentId, member_id: memberId, role, created_by_member_id: actorMemberId })
      const action = role === null ? "share.removed" : current ? "share.changed" : "share.added"
      return { status: "changed", ownerMemberId: agent.owner_member_id, action, detail: { memberName: person?.name ?? "Someone who left", role: eventRole } } as const
    })
    if (result.status === "changed") await recordPersonalAgentEvent({ organizationId, agentId, actorMemberId, action: result.action, detail: result.detail })
    if (result.status === "ok" || result.status === "changed") return { status: "ok", shares: await this.shares({ ...access, ownerMemberId: result.ownerMemberId }) } as const
    return result
  },

  async chat(caller: PersonalAgentCaller, agentId: string, workspaceId: string): Promise<PersonalAgentChat | null> {
    const [row] = await db.$primary.select().from(PersonalAgentChatTable).where(chatFilter(caller, agentId, workspaceId)).limit(1)
    return row ? { agentId: row.agent_id, workspaceId: row.workspace_id, sessionId: row.session_id, updatedAt: row.updated_at.getTime() } : null
  },

  async setChat(caller: PersonalAgentCaller, agentId: string, chat: SetPersonalAgentChat): Promise<PersonalAgentChat> {
    const updatedAt = new Date()
    await db.insert(PersonalAgentChatTable).values({
      id: createDenTypeId("personalAgentChat"),
      organization_id: normalizeDenTypeId("organization", caller.organizationId),
      agent_id: normalizeDenTypeId("personalAgent", agentId),
      member_id: normalizeDenTypeId("member", caller.memberId),
      workspace_id: chat.workspaceId,
      session_id: chat.sessionId,
      updated_at: updatedAt,
    }).onDuplicateKeyUpdate({ set: { session_id: chat.sessionId, updated_at: updatedAt } })
    return { ...chat, agentId, updatedAt: updatedAt.getTime() }
  },

  async runDefinition(agentRevisionId: string): Promise<{
    agentId: string
    agentName: string
    archived: boolean
    revisionId: string
    version: number
    brief: string
    toolPolicy: PersonalAgentToolPolicy
  } | null> {
    if (!isDenTypeId("personalAgentRevision", agentRevisionId)) return null
    const [row] = await db.$primary.select({ agent: PersonalAgentTable, revision: PersonalAgentRevisionTable })
      .from(PersonalAgentRevisionTable)
      .innerJoin(PersonalAgentTable, eq(PersonalAgentTable.id, PersonalAgentRevisionTable.agent_id))
      .where(eq(PersonalAgentRevisionTable.id, normalizeDenTypeId("personalAgentRevision", agentRevisionId)))
      .limit(1)
    if (!row) return null
    return {
      agentId: row.agent.id,
      agentName: row.agent.name,
      archived: row.agent.state === "archived",
      revisionId: row.revision.id,
      version: row.revision.version,
      brief: row.revision.brief,
      toolPolicy: row.revision.tool_policy,
    }
  },
}

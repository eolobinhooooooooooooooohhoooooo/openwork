import { createHash } from "node:crypto"
import { and, count, desc, eq, inArray, lt, ne } from "@openwork-ee/den-db/drizzle"
import { AutomationTable, PersonalAgentRevisionTable, PersonalAgentTable } from "@openwork-ee/den-db/schema"
import { createDenTypeId, isDenTypeId, normalizeDenTypeId } from "@openwork-ee/utils/typeid"
import type {
  CreatePersonalAgent,
  PersonalAgent,
  PersonalAgentDetail,
  PersonalAgentRevision,
  PersonalAgentToolPolicy,
  UpdatePersonalAgent,
} from "@openwork/types/den/personal-agents"
import { archiveAgentRoutines, repinAgentRoutines } from "../automations/repository.js"
import { db } from "../db.js"

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
    digest: row.digest,
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

async function routineCounts(agentIds: AgentRow["id"][]): Promise<Map<string, number>> {
  if (agentIds.length === 0) return new Map()
  const rows = await db.$primary.select({ agentId: AutomationTable.agent_id, routines: count() }).from(AutomationTable)
    .where(and(inArray(AutomationTable.agent_id, agentIds), ne(AutomationTable.state, "archived")))
    .groupBy(AutomationTable.agent_id)
  return new Map(rows.flatMap((row) => row.agentId ? [[row.agentId, row.routines]] : []))
}

async function details(agents: AgentRow[]): Promise<PersonalAgentDetail[]> {
  if (agents.length === 0) return []
  const [revisions, counts] = await Promise.all([
    db.$primary.select().from(PersonalAgentRevisionTable)
      .where(inArray(PersonalAgentRevisionTable.id, agents.map((agent) => agent.current_revision_id))),
    routineCounts(agents.map((agent) => agent.id)),
  ])
  const revisionById = new Map(revisions.map((revision) => [revision.id, revision]))
  return agents.map((agent) => {
    const revision = revisionById.get(agent.current_revision_id)
    if (!revision) throw new Error("personal_agent_revision_not_found")
    return { agent: mapAgent(agent), revision: mapRevision(revision), routineCount: counts.get(agent.id) ?? 0 }
  })
}

export const personalAgentRepository = {
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
    await db.transaction(async (tx) => {
      await tx.insert(PersonalAgentRevisionTable).values({
        id: revisionId,
        agent_id: agentId,
        version: 1,
        brief: definition.brief,
        tool_policy: definition.toolPolicy,
        default_execution_target: definition.defaultExecutionTarget,
        monthly_budget_micros: definition.monthlyBudgetMicros,
        digest: definitionDigest(definition),
        created_at: now,
      })
      await tx.insert(PersonalAgentTable).values({
        id: agentId,
        organization_id: normalizeDenTypeId("organization", input.organizationId),
        owner_member_id: normalizeDenTypeId("member", input.ownerMemberId),
        name: input.definition.name,
        state: "active",
        current_revision_id: revisionId,
        archived_at: null,
        created_at: now,
        updated_at: now,
      })
    })
    const created = await this.get({ ...input, agentId })
    if (!created) throw new Error("personal_agent_create_not_durable")
    return created
  },

  async update(input: Scope & {
    agentId: string
    changes: UpdatePersonalAgent
    toolPolicy: PersonalAgentToolPolicy | undefined
    now: number
  }): Promise<PersonalAgentDetail | null> {
    if (!isDenTypeId("personalAgent", input.agentId)) return null
    const found = await db.transaction(async (tx) => {
      const [agent] = await tx.select().from(PersonalAgentTable).where(ownerFilter(input, input.agentId)).limit(1).for("update")
      if (!agent || agent.state === "archived") return false
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
      if (digest === current.digest) {
        await tx.update(PersonalAgentTable).set({ name: input.changes.name ?? agent.name, updated_at: now })
          .where(eq(PersonalAgentTable.id, agent.id))
        return true
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
      return true
    })
    return found ? this.get(input) : null
  },

  async list(input: Scope & { cursor?: string; limit: number }): Promise<{ items: PersonalAgentDetail[]; nextCursor: string | null }> {
    const limit = Math.max(1, Math.min(input.limit, 100))
    const conditions = [
      eq(PersonalAgentTable.organization_id, normalizeDenTypeId("organization", input.organizationId)),
      eq(PersonalAgentTable.owner_member_id, normalizeDenTypeId("member", input.ownerMemberId)),
      eq(PersonalAgentTable.state, "active"),
    ]
    if (input.cursor) {
      if (!isDenTypeId("personalAgent", input.cursor)) return { items: [], nextCursor: null }
      conditions.push(lt(PersonalAgentTable.id, normalizeDenTypeId("personalAgent", input.cursor)))
    }
    const rows = await db.$primary.select().from(PersonalAgentTable).where(and(...conditions))
      .orderBy(desc(PersonalAgentTable.id)).limit(limit + 1)
    const selected = rows.slice(0, limit)
    return { items: await details(selected), nextCursor: rows.length > limit ? selected.at(-1)?.id ?? null : null }
  },

  async get(input: Scope & { agentId: string }): Promise<PersonalAgentDetail | null> {
    if (!isDenTypeId("personalAgent", input.agentId)) return null
    const rows = await db.$primary.select().from(PersonalAgentTable).where(ownerFilter(input, input.agentId)).limit(1)
    return (await details(rows))[0] ?? null
  },

  async archive(input: Scope & { agentId: string; now: number }): Promise<PersonalAgentDetail | null> {
    if (!isDenTypeId("personalAgent", input.agentId)) return null
    const found = await db.transaction(async (tx) => {
      const [agent] = await tx.select().from(PersonalAgentTable).where(ownerFilter(input, input.agentId)).limit(1).for("update")
      if (!agent) return false
      if (agent.state === "archived") return true
      const now = new Date(input.now)
      await tx.update(PersonalAgentTable).set({ state: "archived", archived_at: now, updated_at: now })
        .where(eq(PersonalAgentTable.id, agent.id))
      await archiveAgentRoutines(tx, { agentId: agent.id, now: input.now })
      return true
    })
    return found ? this.get(input) : null
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

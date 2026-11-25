import { and, eq, inArray } from "@openwork-ee/den-db/drizzle"
import { AuthUserTable, MemberTable, PersonalAgentShareTable, PersonalAgentTable } from "@openwork-ee/den-db/schema"
import { isDenTypeId, normalizeDenTypeId } from "@openwork-ee/utils/typeid"
import type { PersonalAgentPerson, PersonalAgentRole } from "@openwork/types/den/personal-agents"
import { db } from "../db.js"

export type PersonalAgentCaller = { organizationId: string; memberId: string }

export type PersonalAgentAccess = {
  agentId: string
  organizationId: string
  ownerMemberId: string
  role: PersonalAgentRole
  state: "active" | "archived"
  pausedAt: number | null
}

export async function personalAgentAccess(caller: PersonalAgentCaller, agentId: string): Promise<PersonalAgentAccess | null> {
  if (!isDenTypeId("personalAgent", agentId)) return null
  const organizationId = normalizeDenTypeId("organization", caller.organizationId)
  const memberId = normalizeDenTypeId("member", caller.memberId)
  const [agent] = await db.$primary.select().from(PersonalAgentTable).where(and(
    eq(PersonalAgentTable.id, normalizeDenTypeId("personalAgent", agentId)),
    eq(PersonalAgentTable.organization_id, organizationId),
  )).limit(1)
  if (!agent) return null
  const found = (role: PersonalAgentRole): PersonalAgentAccess => ({
    agentId: agent.id,
    organizationId: agent.organization_id,
    ownerMemberId: agent.owner_member_id,
    role,
    state: agent.state,
    pausedAt: agent.paused_at?.getTime() ?? null,
  })
  if (agent.owner_member_id === memberId) return found("owner")
  const [share] = await db.$primary.select({ role: PersonalAgentShareTable.role }).from(PersonalAgentShareTable).where(and(
    eq(PersonalAgentShareTable.agent_id, agent.id),
    eq(PersonalAgentShareTable.member_id, memberId),
  )).limit(1)
  return share ? found(share.role) : null
}

export function canManagePersonalAgent(role: PersonalAgentRole): boolean {
  return role === "owner" || role === "manager"
}

export function personalAgentOwnerScope(access: PersonalAgentAccess) {
  return { organizationId: access.organizationId, ownerMemberId: access.ownerMemberId, modelAttentionCapable: true }
}

export async function personalAgentPeople(organizationId: string, memberIds: readonly string[]): Promise<Map<string, PersonalAgentPerson>> {
  const ids = [...new Set(memberIds)].filter((id) => isDenTypeId("member", id)).map((id) => normalizeDenTypeId("member", id))
  if (ids.length === 0) return new Map()
  const rows = await db.$primary.select({ memberId: MemberTable.id, name: AuthUserTable.name }).from(MemberTable)
    .innerJoin(AuthUserTable, eq(AuthUserTable.id, MemberTable.userId))
    .where(and(eq(MemberTable.organizationId, normalizeDenTypeId("organization", organizationId)), inArray(MemberTable.id, ids)))
  return new Map(rows.map((row) => [row.memberId, { memberId: row.memberId, name: row.name }]))
}

export function personOrUnknown(people: Map<string, PersonalAgentPerson>, memberId: string): PersonalAgentPerson {
  return people.get(memberId) ?? { memberId, name: "Someone who left" }
}

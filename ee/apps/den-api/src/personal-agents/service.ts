import { AUTOMATION_CLOUD_DEFAULT_MODEL, type AutomationRun } from "@openwork/types/automations"
import { personalAgentToolPolicyBlocks, type AutomationListItem } from "@openwork/automations"
import {
  EMPTY_PERSONAL_AGENT_TOOL_POLICY,
  PERSONAL_AGENT_ROUTINE_LIST_LIMIT,
  PERSONAL_AGENT_TOOL_POLICY_MAX_SCOPE_CHARACTERS,
  type CreatePersonalAgent,
  type CreatePersonalAgentRoutine,
  type PersonalAgentAccess,
  type PersonalAgentDetail,
  type PersonalAgentToolPolicy,
  type RunPersonalAgentNow,
  type UpdatePersonalAgent,
} from "@openwork/types/den/personal-agents"
import { isDenTypeId, normalizeDenTypeId } from "@openwork-ee/utils/typeid"
import { listAgentRoutines } from "../automations/repository.js"
import { automationService, type AutomationPlacementOptions, type AutomationService } from "../automations/service.js"
import { getExternalMcpConnection } from "../capability-sources/external-mcp-connections.js"
import { agentToolLimitScopes } from "../mcp/workbot-turn-limits.js"
import { personalAgentRepository } from "./repository.js"

type OwnerScope = Parameters<AutomationService["create"]>[0]

async function toolPolicyOverOrganizationConnectors(organizationId: string, policy: PersonalAgentToolPolicy): Promise<PersonalAgentToolPolicy> {
  const canonicalIds = new Map<string, string>()
  for (const connectionId of new Set([...Object.keys(policy.connections), ...Object.keys(policy.tools)])) {
    if (!isDenTypeId("externalMcpConnection", connectionId)) throw new Error("personal_agent_tool_policy_connection_invalid")
    const connection = await getExternalMcpConnection({
      organizationId: normalizeDenTypeId("organization", organizationId),
      connectionId: normalizeDenTypeId("externalMcpConnection", connectionId),
    })
    if (!connection || connection.kind !== "external_mcp") throw new Error("personal_agent_tool_policy_connection_invalid")
    canonicalIds.set(connectionId, connection.id)
  }
  const canonical = (connectionId: string) => canonicalIds.get(connectionId) ?? connectionId
  const connections: Record<string, PersonalAgentAccess> = {}
  for (const [connectionId, access] of Object.entries(policy.connections)) connections[canonical(connectionId)] = access
  const tools: Record<string, Record<string, PersonalAgentAccess>> = {}
  for (const [connectionId, entries] of Object.entries(policy.tools)) tools[canonical(connectionId)] = { ...entries }
  const scopes = agentToolLimitScopes(personalAgentToolPolicyBlocks({ connections, tools }))
  if (JSON.stringify(scopes).length > PERSONAL_AGENT_TOOL_POLICY_MAX_SCOPE_CHARACTERS) throw new Error("personal_agent_tool_policy_too_large")
  return { connections, tools }
}

export class PersonalAgentService {
  constructor(private readonly automations: AutomationService = automationService) {}

  async create(scope: OwnerScope, definition: CreatePersonalAgent): Promise<PersonalAgentDetail> {
    const toolPolicy = await toolPolicyOverOrganizationConnectors(scope.organizationId, definition.toolPolicy ?? EMPTY_PERSONAL_AGENT_TOOL_POLICY)
    return personalAgentRepository.create({ ...scope, definition, toolPolicy, now: Date.now() })
  }

  async update(scope: OwnerScope, agentId: string, changes: UpdatePersonalAgent): Promise<PersonalAgentDetail | null> {
    const toolPolicy = changes.toolPolicy ? await toolPolicyOverOrganizationConnectors(scope.organizationId, changes.toolPolicy) : undefined
    return personalAgentRepository.update({ ...scope, agentId, changes, toolPolicy, now: Date.now() })
  }

  list(scope: OwnerScope, input: { cursor?: string; limit?: number }) {
    return personalAgentRepository.list({ ...scope, cursor: input.cursor, limit: input.limit ?? 50 })
  }

  get(scope: OwnerScope, agentId: string) {
    return personalAgentRepository.get({ ...scope, agentId })
  }

  archive(scope: OwnerScope, agentId: string) {
    return personalAgentRepository.archive({ ...scope, agentId, now: Date.now() })
  }

  private async routine(scope: OwnerScope, agentId: string, routineId: string): Promise<AutomationListItem> {
    const routine = isDenTypeId("automation", routineId) ? await this.automations.get(scope, routineId) : null
    if (routine?.automation.agentId !== agentId || routine.automation.state === "archived") throw new Error("personal_agent_routine_not_found")
    return routine
  }

  private async onlyRoutine(scope: OwnerScope, agentId: string): Promise<AutomationListItem> {
    const routines = await listAgentRoutines({ ...scope, agentId, limit: 2 })
    if (routines.length === 0) throw new Error("personal_agent_routine_required")
    if (routines.length > 1) throw new Error("personal_agent_routine_ambiguous")
    return routines[0]
  }

  private async active(scope: OwnerScope, agentId: string): Promise<PersonalAgentDetail | null> {
    const agent = await this.get(scope, agentId)
    return agent && agent.agent.state === "active" ? agent : null
  }

  async listRoutines(scope: OwnerScope, agentId: string): Promise<{ items: AutomationListItem[] } | null> {
    const agent = await this.get(scope, agentId)
    if (!agent) return null
    return { items: await listAgentRoutines({ ...scope, agentId: agent.agent.id, limit: PERSONAL_AGENT_ROUTINE_LIST_LIMIT }) }
  }

  async createRoutine(scope: OwnerScope, agentId: string, routine: CreatePersonalAgentRoutine): Promise<AutomationListItem | null> {
    const agent = await this.active(scope, agentId)
    if (!agent) return null
    return this.automations.create(scope, {
      name: routine.name,
      schedule: routine.schedule,
      action: {
        kind: "agent",
        instructions: routine.instructions,
        model: routine.model ?? {
          providerId: AUTOMATION_CLOUD_DEFAULT_MODEL.providerId,
          modelId: AUTOMATION_CLOUD_DEFAULT_MODEL.modelId,
          variant: null,
        },
      },
      executionTarget: "cloud",
    }, { agent: { agentId: agent.agent.id } })
  }

  async runNow(scope: OwnerScope, agentId: string, input: RunPersonalAgentNow, options: AutomationPlacementOptions = {}): Promise<{
    run: AutomationRun
    routine: AutomationListItem
    agentRevision: { id: string; version: number }
  } | null> {
    const agent = await this.active(scope, agentId)
    if (!agent) return null
    const chosen = input.routineId
      ? await this.routine(scope, agent.agent.id, input.routineId)
      : await this.onlyRoutine(scope, agent.agent.id)
    const run = await this.automations.runNow(scope, chosen.automation.id, options)
    const receipt = run ? await this.automations.getRun(scope, run.id) : null
    const pinned = receipt?.revision.agentRevisionId
      ? await personalAgentRepository.runDefinition(receipt.revision.agentRevisionId)
      : null
    if (!receipt || !pinned) throw new Error("personal_agent_routine_not_found")
    return {
      run: receipt.run,
      routine: { automation: receipt.automation, revision: receipt.revision, latestRun: receipt.run },
      agentRevision: { id: pinned.revisionId, version: pinned.version },
    }
  }
}

export const personalAgentService = new PersonalAgentService()

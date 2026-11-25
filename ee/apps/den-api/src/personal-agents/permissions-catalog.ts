import { normalizeDenTypeId } from "@openwork-ee/utils/typeid"
import { EMPTY_PERSONAL_AGENT_TOOL_POLICY, type PersonalAgentToolCatalog, type PersonalAgentToolPolicy } from "@openwork/types/den/personal-agents"
import { externalMcpConnectionReadyForMember, listUsableExternalMcpConnections, type ExternalMcpConnectionRow } from "../capability-sources/external-mcp-connections.js"
import { listExternalMcpTools } from "../capability-sources/external-mcp-client-runtime.js"
import { externalMcpCompatibleCallbackUrl } from "../capability-sources/external-mcp-oauth-contract.js"
import { getOrgOAuthClient } from "../capability-sources/oauth-credentials.js"
import { evaluateToolPolicy } from "../capability-sources/external-mcp-tool-policy.js"
import { listTeamsForMember } from "../orgs.js"
import type { PersonalAgentCaller } from "./access.js"
import { personalAgentOrgPolicy, personalAgentPolicyBlocks, personalAgentToolIsReadOnly, personalAgentToolTitle } from "./permissions-policy.js"

export async function personalAgentUsableConnections(caller: PersonalAgentCaller) {
  const organizationId = normalizeDenTypeId("organization", caller.organizationId)
  const orgMembershipId = normalizeDenTypeId("member", caller.memberId)
  const teams = await listTeamsForMember({ organizationId, memberId: orgMembershipId })
  return listUsableExternalMcpConnections({ organizationId, orgMembershipId, teamIds: teams.map((team) => team.id) })
}

export async function personalAgentConnectionTools(caller: PersonalAgentCaller, connection: ExternalMcpConnectionRow) {
  const orgMembershipId = normalizeDenTypeId("member", caller.memberId)
  if (!await externalMcpConnectionReadyForMember(connection, orgMembershipId)) return { available: false, tools: [] }
  try {
    const client = connection.authType === "oauth" ? await getOrgOAuthClient(connection.organizationId, connection.id) : null
    const registered = client?.extra?.registeredRedirectUri
    const redirect = connection.authType !== "oauth" ? "http://127.0.0.1/unused-mcp-oauth-callback" : externalMcpCompatibleCallbackUrl({
      connectionId: connection.id, callbackMode: connection.oauthConfiguration?.callbackMode ?? "legacy-v1", createdAt: connection.createdAt,
      registeredRedirectUri: typeof registered === "string" ? registered : null,
    })
    const tools = await listExternalMcpTools(connection, redirect, connection.credentialMode === "per_member" ? { orgMembershipId } : undefined)
    return { available: true, tools: tools.map((tool) => ({ name: tool.name, title: personalAgentToolTitle(tool), write: !personalAgentToolIsReadOnly(tool.annotations) })) }
  } catch {
    return { available: false, tools: [] }
  }
}

export async function personalAgentToolCatalog(caller: PersonalAgentCaller, policy: PersonalAgentToolPolicy): Promise<PersonalAgentToolCatalog> {
  const [connections, organization] = await Promise.all([personalAgentUsableConnections(caller), personalAgentOrgPolicy(caller.organizationId)])
  const orgPolicy = organization?.tool_policy ?? EMPTY_PERSONAL_AGENT_TOOL_POLICY
  const catalog: PersonalAgentToolCatalog["connections"] = []
  for (let index = 0; index < connections.length; index += 8) {
    catalog.push(...await Promise.all(connections.slice(index, index + 8).map(async (connection): Promise<PersonalAgentToolCatalog["connections"][number]> => {
      const { available, tools } = await personalAgentConnectionTools(caller, connection)
      return {
        connectionId: connection.id, name: connection.name.slice(0, 160), available,
        blocked: policy.connections[connection.id] === "block", lockedByOrganization: orgPolicy.connections[connection.id] === "block",
        tools: tools.map((tool) => {
          const chosen = Object.hasOwn(policy.tools[connection.id] ?? {}, tool.name) ? policy.tools[connection.id][tool.name] : null
          const lockedByOrganization = personalAgentPolicyBlocks(orgPolicy, connection.id, tool.name) || evaluateToolPolicy(connection.toolPolicy, tool.name).blocked
          const access = lockedByOrganization || personalAgentPolicyBlocks(policy, connection.id, tool.name) ? "block" : chosen ?? (tool.write ? "ask" : "allow")
          return { ...tool, chosen, lockedByOrganization, access }
        }),
      }
    })))
  }
  return { connections: catalog }
}

import type {
  PersonalAgentAccess,
  PersonalAgentDetail,
  PersonalAgentRequest,
  PersonalAgentRequestDecision,
  PersonalAgentToolCatalog,
  PersonalAgentToolPolicy,
} from "@openwork/types/den/personal-agents";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { t } from "@/i18n";

import type { AgentsRuntime } from "./agents-runtime";
import { agentListKey, agentRequestsKey, agentsQueryRoot } from "./use-agents";

type ToolChoice = { connectionId: string; toolName: string; access: PersonalAgentAccess };
type SettingsChange = { tool: ToolChoice } | { monthlyBudgetMicros: number | null };

export function nextAgentToolPolicy(policy: PersonalAgentToolPolicy, { connectionId, toolName, access }: ToolChoice): PersonalAgentToolPolicy {
  return {
    ...policy,
    tools: {
      ...policy.tools,
      [connectionId]: { ...policy.tools[connectionId], [toolName]: access },
    },
  };
}

function agentToolsKey(organizationId: string, agentId: string) {
  return [...agentsQueryRoot(organizationId), "tools", agentId] as const;
}

export function useAgentToolsQuery({ client, organizationId }: AgentsRuntime, agentId: string) {
  return useQuery({
    queryKey: agentToolsKey(organizationId, agentId),
    queryFn: () => client.getPersonalAgentTools(organizationId, agentId),
  });
}

export function useSaveAgentSettings({ client, organizationId }: AgentsRuntime, agent: PersonalAgentDetail) {
  const queryClient = useQueryClient();
  const agentId = agent.agent.id;
  const toolsKey = agentToolsKey(organizationId, agentId);
  const listKey = agentListKey(organizationId);
  return useMutation({
    mutationFn: (change: SettingsChange) => {
      if (!("tool" in change)) return client.updatePersonalAgent(organizationId, agentId, change);
      const latestAgent = queryClient.getQueryData<PersonalAgentDetail[]>(listKey)?.find((item) => item.agent.id === agentId);
      return client.updatePersonalAgent(organizationId, agentId, {
        toolPolicy: nextAgentToolPolicy((latestAgent ?? agent).revision.toolPolicy, change.tool),
      });
    },
    onMutate: async (change) => {
      if (!("tool" in change)) return;
      const { connectionId, toolName, access } = change.tool;
      await queryClient.cancelQueries({ queryKey: toolsKey });
      const previous = queryClient.getQueryData<PersonalAgentToolCatalog>(toolsKey);
      queryClient.setQueryData<PersonalAgentToolCatalog>(toolsKey, (catalog) => catalog && ({
        connections: catalog.connections.map((connection) => connection.connectionId !== connectionId ? connection : {
          ...connection,
          tools: connection.tools.map((tool) => tool.name === toolName ? { ...tool, access, chosen: access } : tool),
        }),
      }));
      return previous;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<PersonalAgentDetail[]>(listKey, (items) => items?.map((item) => item.agent.id === agentId ? updated : item));
    },
    onError: (_error, _change, previous) => {
      if (previous) queryClient.setQueryData(toolsKey, previous);
      toast.error(t("agents.permissions_save_failed"));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: agentsQueryRoot(organizationId) }),
  });
}

type ToolDecision = Exclude<PersonalAgentRequestDecision, "approve">;

export function useDecideAgentToolRequest({ client, organizationId }: AgentsRuntime, agentId: string, requestId: string, onAllowed: () => void) {
  const queryClient = useQueryClient();
  const requestsKey = agentRequestsKey(organizationId, agentId);
  return useMutation({
    mutationFn: (decision: ToolDecision) => client.decidePersonalAgentRequest(organizationId, agentId, requestId, decision),
    onSuccess: async (updated, decision) => {
      await queryClient.cancelQueries({ queryKey: requestsKey });
      queryClient.setQueryData<PersonalAgentRequest[]>(requestsKey, (items) => items?.map((item) => item.id === updated.id ? updated : item));
      if (decision === "allow_once" || decision === "always_allow") onAllowed();
    },
    onError: () => toast.error(t("agents.permission_ask_save_failed")),
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: agentsQueryRoot(organizationId) }); },
  });
}

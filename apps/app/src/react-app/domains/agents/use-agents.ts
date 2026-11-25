import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AutomationRun } from "@openwork/types/automations";

import { t } from "@/i18n";

import { agentChatFor, useAgentChatStore } from "./agent-chat-store";
import type { AgentScope, AgentsRuntime } from "./agents-runtime";

const ACTIVE_RUN_STATUSES: readonly AutomationRun["status"][] = ["queued", "claimed", "running"];
const ACTIVE_POLL_MS = 5_000;
const IDLE_POLL_MS = 60_000;

export function isActiveRun(run: Pick<AutomationRun, "status"> | null | undefined): boolean {
  return Boolean(run && ACTIVE_RUN_STATUSES.includes(run.status));
}

export function agentsQueryRoot(scope: AgentScope | null) {
  return [scope?.denBaseUrl || "den", "personal-agents", scope?.organizationId ?? null, scope?.principal ?? null] as const;
}

export function agentListKey(scope: AgentScope | null) {
  return [...agentsQueryRoot(scope), "list"] as const;
}

export function agentRequestsKey(scope: AgentScope | null, agentId: string | null) {
  return [...agentsQueryRoot(scope), "requests", agentId] as const;
}

export function useAgentListQuery(runtime: AgentsRuntime | null, poll = false) {
  const chat = useAgentChatStore((state) => agentChatFor(state.chats, runtime, runtime?.selectedSessionId ?? null));
  const requests = useAgentRequestsQuery(runtime, chat?.agentId ?? null, false, false).data;
  const pending = requests?.some((request) => request.status === "pending");
  return useQuery({
    queryKey: agentListKey(runtime),
    queryFn: async () => runtime ? (await runtime.client.listPersonalAgents(runtime.organizationId)).items : [],
    enabled: runtime !== null && poll,
    staleTime: IDLE_POLL_MS,
    refetchInterval: (query) => {
      if (!poll) return false;
      const fast = pending || query.state.data?.some((item) =>
        (item.agent.id === chat?.agentId && item.openRequestCount > 0) || item.routines.some((routine) => isActiveRun(routine.latestRun)),
      );
      return fast ? ACTIVE_POLL_MS : IDLE_POLL_MS;
    },
  });
}

export function useAgentDetail(runtime: AgentsRuntime | null, agentId: string | null | undefined) {
  return useAgentListQuery(runtime).data?.find((item) => item.agent.id === agentId);
}

export function useAgentNames(runtime: AgentsRuntime | null): ReadonlyMap<string, string> | undefined {
  const agents = useAgentListQuery(runtime).data;
  return useMemo(() => runtime && agents ? new Map(agents.map((item) => [item.agent.id, item.agent.name])) : undefined, [runtime, agents]);
}

export function useAgentRunQuery(runtime: AgentsRuntime, agentId: string, runId: string, active: boolean) {
  return useQuery({
    queryKey: [...agentsQueryRoot(runtime), "run", agentId, runId],
    queryFn: () => runtime.client.getPersonalAgentRun(runtime.organizationId, agentId, runId),
    retry: 1,
    staleTime: (query) => isActiveRun(query.state.data?.run) ? 0 : Infinity,
    refetchInterval: (query) => query.state.status !== "error" && (query.state.data ? isActiveRun(query.state.data.run) : active) ? ACTIVE_POLL_MS : false,
  });
}

export function useAgentRunsQuery(runtime: AgentsRuntime | null, agentId: string | null, active: boolean) {
  return useQuery({
    queryKey: agentRunsKey(runtime, agentId),
    queryFn: async () => runtime && agentId ? (await runtime.client.listPersonalAgentRuns(runtime.organizationId, agentId)).items : [],
    enabled: runtime !== null && agentId !== null,
    refetchInterval: (query) => active || query.state.data?.some(isActiveRun) ? ACTIVE_POLL_MS : IDLE_POLL_MS,
  });
}

function agentRunsKey(scope: AgentScope | null, agentId: string | null) {
  return [...agentsQueryRoot(scope), "runs", agentId] as const;
}

export function useAgentRequestsQuery(runtime: AgentsRuntime | null, agentId: string | null, pending: boolean, enabled = true) {
  return useQuery({
    queryKey: agentRequestsKey(runtime, agentId),
    queryFn: async () => runtime && agentId ? (await runtime.client.listPersonalAgentRequests(runtime.organizationId, agentId)).items : [],
    enabled: enabled && runtime !== null && agentId !== null,
    refetchInterval: (query) => !enabled ? false : pending || query.state.data?.some((request) => request.status === "pending") ? ACTIVE_POLL_MS : IDLE_POLL_MS,
  });
}

export function useAgentActions(runtime: AgentsRuntime | null) {
  const queryClient = useQueryClient();
  const runNow = useMutation({
    mutationKey: [...agentsQueryRoot(runtime), "run-now"],
    mutationFn: async (input: { agentId: string; routineId: string | undefined }) => {
      if (!runtime) throw new Error(t("agents.start_sign_in"));
      return runtime.client.runPersonalAgentNow(runtime.organizationId, input.agentId, { routineId: input.routineId });
    },
    onSettled: async (_data, _error, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: agentListKey(runtime) }),
        queryClient.invalidateQueries({ queryKey: agentRunsKey(runtime, input.agentId) }),
        queryClient.invalidateQueries({ queryKey: agentRequestsKey(runtime, input.agentId) }),
      ]);
    },
  });
  const setActive = useMutation({
    mutationKey: [...agentsQueryRoot(runtime), "set-active"],
    mutationFn: async (input: { agentId: string; routineIds: string[]; active: boolean }) => {
      if (!runtime) throw new Error(t("agents.start_sign_in"));
      for (const routineId of input.routineIds) {
        await runtime.client.updatePersonalAgentRoutine(runtime.organizationId, input.agentId, routineId, { active: input.active });
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: agentListKey(runtime) }),
  });
  return { runNow, setActive };
}

import { toast } from "sonner";

import { t } from "@/i18n";

import { AgentAskCard } from "./agent-ask-card";
import { AgentChangeRequest } from "./agent-change-request";
import { agentChatFor, agentChatKey, isStandingChat, useAgentChatStore } from "./agent-chat-store";
import { AgentRunResult } from "./agent-run-result";
import { useAgentsRuntime } from "./agents-runtime";
import { isActiveRun, useAgentActions, useAgentDetail, useAgentRequestsQuery, useAgentRunsQuery } from "./use-agents";

export function AgentTranscriptFooter(props: { sessionId: string }) {
  const runtime = useAgentsRuntime();
  const chat = useAgentChatStore((state) => agentChatFor(state.chats, runtime, props.sessionId));
  const agent = useAgentDetail(runtime, chat?.agentId);
  const agentId = chat && isStandingChat(chat) && agent ? agent.agent.id : null;
  const active = agent?.routines.some((routine) => isActiveRun(routine.latestRun)) ?? false;
  const runsQuery = useAgentRunsQuery(runtime, agentId, active);
  const requestsQuery = useAgentRequestsQuery(runtime, agentId, Boolean(agent?.openRequestCount));
  const actions = useAgentActions(runtime);
  if (!runtime || !chat || !agent || !agentId) return null;
  const runs = runsQuery.data ?? [];
  const routines = agent.routines.filter((routine) => routine.state !== "archived");
  const visibleRuns = runs.filter((run) => run.id !== chat.firstRunId && run.createdAt >= chat.createdAt).sort((a, b) => a.createdAt - b.createdAt);
  const requests = [...requestsQuery.data ?? []].sort((a, b) => a.createdAt - b.createdAt);
  if (!visibleRuns.length && !requests.length && !runsQuery.isError && !requestsQuery.isError) return null;

  return (
    <div data-agent-runs className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-2 pb-4 md:px-10">
      {visibleRuns.map((run) => (
        <AgentRunResult key={run.id} runtime={runtime} agentId={agentId} runId={run.id} active={isActiveRun(run)}
          routineName={agent.routines.find((routine) => routine.id === run.automationId)?.name ?? agent.agent.name} />
      ))}
      {runsQuery.isError && <p className="text-xs text-dls-secondary">{t("agents.runs_unavailable")}</p>}
      {requests.map((request) => request.kind === "tool" ? (
        <AgentAskCard key={agentChatKey(runtime, request.id)} runtime={runtime} agent={agent} request={request} onAllowed={() => {
          if (!request.requestedByCaller) return;
          const previousRun = runs.find((run) => run.id === request.runId);
          const routineId = previousRun?.automationId ?? (request.runId && request.runId === chat.firstRunId ? chat.routineId : null) ?? routines[0]?.id;
          actions.runNow.mutate({ agentId, routineId }, { onError: () => toast.error(t("agents.panel_run_failed")) });
        }} />
      ) : <AgentChangeRequest key={agentChatKey(runtime, request.id)} runtime={runtime} agent={agent} request={request} />)}
      {requestsQuery.isError && <p className="text-xs text-dls-secondary">{t("agents.requests_unavailable")}</p>}
    </div>
  );
}

import { agentChatFor, useAgentChatStore } from "./agent-chat-store";
import { AgentRunResult } from "./agent-run-result";
import { useAgentsRuntime, type AgentsRuntime } from "./agents-runtime";
import { useAgentRoutinesQuery, useRoutineRunsQuery } from "./use-agents";

function RoutineRuns(props: { runtime: AgentsRuntime; routineId: string; routineName: string; skipRunId: string | null; since: number }) {
  const runs = useRoutineRunsQuery(props.runtime, props.routineId).data ?? [];
  return [...runs]
    .filter((run) => run.id !== props.skipRunId && run.createdAt >= props.since)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((run) => <AgentRunResult key={run.id} runtime={props.runtime} runId={run.id} routineName={props.routineName} />);
}

export function AgentTranscriptFooter(props: { sessionId: string }) {
  const runtime = useAgentsRuntime();
  const chat = useAgentChatStore((state) => agentChatFor(state.chats, runtime?.organizationId ?? null, props.sessionId));
  const routinesByAgent = useAgentRoutinesQuery(runtime).data;
  const agentId = chat?.agentId;
  if (!runtime || !chat || !agentId) return null;
  const routines = routinesByAgent?.get(agentId) ?? [];
  if (routines.length === 0) return null;
  return (
    <div data-agent-runs className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-2 pb-4 md:px-10">
      {routines.map((routine) => (
        <RoutineRuns
          key={routine.automation.id}
          runtime={runtime}
          routineId={routine.automation.id}
          routineName={routine.automation.name}
          skipRunId={chat.firstRunId}
          since={chat.createdAt}
        />
      ))}
    </div>
  );
}

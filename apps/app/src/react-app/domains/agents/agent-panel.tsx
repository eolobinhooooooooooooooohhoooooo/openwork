import { Clock, Play, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { t } from "@/i18n";

import { agentChatFor, useAgentChatStore } from "./agent-chat-store";
import { AgentFace } from "./agent-face";
import { scheduleInWords, whenInWords } from "./agent-words";
import { useAgentsRuntime } from "./agents-runtime";
import { useAgentActions, useAgentRoutinesQuery } from "./use-agents";

export function AgentPanel(props: { sessionId: string | null }) {
  const runtime = useAgentsRuntime();
  const chat = useAgentChatStore((state) => agentChatFor(state.chats, runtime?.organizationId ?? null, props.sessionId));
  const open = useAgentChatStore((state) => state.panelSessionId !== null && state.panelSessionId === props.sessionId);
  const routinesByAgent = useAgentRoutinesQuery(runtime).data;
  const actions = useAgentActions(runtime);
  const agentId = chat?.agentId;
  if (!runtime || !chat || !agentId || !open) return null;

  const routines = routinesByAgent?.get(agentId) ?? [];
  const on = routines.some((routine) => routine.automation.state === "active");
  const nextDueAt = routines.flatMap((routine) => routine.automation.state === "active" && routine.automation.nextDueAt ? [routine.automation.nextDueAt] : []).sort((a, b) => a - b)[0];
  const name = chat.agentName ?? t("agents.new");
  const firstRoutine = routines[0];

  return (
    <aside data-agent-panel={agentId} aria-label={name} className="hidden w-[300px] shrink-0 flex-col gap-5 overflow-y-auto border-l border-dls-border bg-dls-surface px-4 pb-4 pt-2 lg:flex">
      <div className="flex h-8 items-center justify-end">
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("agents.panel_close")} onClick={() => useAgentChatStore.getState().setPanel(null)}>
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex flex-col items-center gap-3">
        <AgentFace name={name} size="lg" />
        <p className="text-[15px] font-medium text-dls-text">{name}</p>
      </div>
      <label className="flex items-center justify-between gap-3 rounded-xl border border-dls-border px-3.5 py-2.5">
        <span className="min-w-0">
          <span className="block text-sm font-medium text-dls-text">{on ? t("agents.panel_on") : t("agents.panel_off")}</span>
          <span className="block text-xs text-dls-secondary">
            {!on ? t("agents.panel_paused") : nextDueAt ? t("agents.panel_next_run", { when: whenInWords(nextDueAt, Date.now()) }) : t("agents.panel_no_next_run")}
          </span>
        </span>
        <Switch
          size="sm"
          checked={on}
          disabled={routines.length === 0 || actions.setActive.isPending}
          onCheckedChange={(active) => actions.setActive.mutate(
            { routineIds: routines.map((routine) => routine.automation.id), active },
            { onError: (error) => toast.error(error instanceof Error ? error.message : String(error)) },
          )}
        />
      </label>
      <section className="flex flex-col gap-2">
        <h2 className="px-1 text-xs text-dls-secondary">{t("agents.panel_routines")}</h2>
        {routines.length === 0 ? <p className="px-1 text-sm text-dls-secondary">{t("agents.panel_no_routines")}</p> : null}
        {routines.map((routine) => (
          <div key={routine.automation.id} data-agent-routine={routine.automation.id} className="flex items-center gap-3 rounded-xl border border-dls-border px-3.5 py-2.5">
            <Clock aria-hidden="true" className="size-4 shrink-0 text-dls-secondary" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-dls-text">{routine.automation.name}</span>
              <span className="block truncate text-xs text-dls-secondary">{scheduleInWords(routine.revision.schedule)}</span>
            </span>
          </div>
        ))}
      </section>
      {firstRoutine ? (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-agent-run-now
            disabled={actions.runNow.isPending}
            onClick={() => actions.runNow.mutate(
              { agentId, routineId: firstRoutine.automation.id },
              {
                onSuccess: () => toast.success(t("agents.panel_run_started")),
                onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
              },
            )}
          >
            <Play className="size-3.5" />
            {t("agents.panel_run_now")}
          </Button>
        </div>
      ) : null}
    </aside>
  );
}

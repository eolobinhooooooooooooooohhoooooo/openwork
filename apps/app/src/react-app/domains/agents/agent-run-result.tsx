import type { AutomationRun } from "@openwork/types/automations";

import { t } from "@/i18n";

import type { AgentsRuntime } from "./agents-runtime";
import { runStepCount, timeOfDay } from "./agent-words";
import { isActiveRun, useAgentRunQuery } from "./use-agents";

function resultText(run: AutomationRun, routineName: string): string {
  if (run.status === "succeeded") return run.resultSummary?.trim() || t("agents.run_empty", { name: routineName });
  return t("agents.run_failed", { name: routineName, reason: run.error?.message.trim() || run.status });
}

export function AgentRunResult(props: { runtime: AgentsRuntime; agentId: string; runId: string; routineName: string; active?: boolean }) {
  const query = useAgentRunQuery(props.runtime, props.agentId, props.runId, props.active ?? true);
  const receipt = query.data;
  if (query.isError && !receipt) {
    return <p data-agent-run={props.runId} data-agent-run-state="unavailable" data-agent-line className="text-[13px] leading-relaxed text-dls-secondary">{t("agents.run_unavailable", { name: props.routineName })}</p>;
  }
  if (!receipt || isActiveRun(receipt.run)) {
    return (
      <p data-agent-run={props.runId} data-agent-run-state="working" data-agent-line className="animate-pulse text-[13px] leading-relaxed text-dls-secondary">
        {t("agents.run_working", { name: props.routineName })}
      </p>
    );
  }
  const steps = runStepCount(receipt);
  const finishedAt = receipt.run.finishedAt ?? receipt.run.updatedAt;
  return (
    <div data-agent-run={props.runId} data-agent-run-state={receipt.run.status} className="flex flex-col gap-1.5">
      <p data-agent-line className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">{resultText(receipt.run, props.routineName)}</p>
      <p className="text-xs text-dls-secondary">
        {[props.routineName, timeOfDay(finishedAt), steps > 0 ? t("agents.run_steps", { count: steps }) : null].filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}

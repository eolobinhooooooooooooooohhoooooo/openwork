import type { AutomationRun } from "@openwork/types/automations";

import { t } from "@/i18n";

import type { AgentsRuntime } from "./agents-runtime";
import { runStepCount, timeOfDay } from "./agent-words";
import { isActiveRun, useAgentRunQuery } from "./use-agents";

function resultText(run: AutomationRun, routineName: string): string {
  if (run.status === "succeeded") return run.resultSummary?.trim() || t("agents.run_empty", { name: routineName });
  return t("agents.run_failed", { name: routineName, reason: run.error?.message.trim() || run.status });
}

export function AgentRunResult(props: { runtime: AgentsRuntime; runId: string; routineName: string }) {
  const receipt = useAgentRunQuery(props.runtime, props.runId).data;
  if (!receipt || isActiveRun(receipt.run)) {
    return (
      <p data-agent-run={props.runId} data-agent-run-state="working" className="flex items-center gap-2 text-sm text-dls-secondary">
        <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-blue-9" />
        <span className="animate-pulse">{t("agents.run_working", { name: props.routineName })}</span>
      </p>
    );
  }
  const steps = runStepCount(receipt);
  const finishedAt = receipt.run.finishedAt ?? receipt.run.updatedAt;
  return (
    <div data-agent-run={props.runId} data-agent-run-state={receipt.run.status} className="flex flex-col gap-1.5">
      <p className="whitespace-pre-wrap text-[15px] leading-6 text-dls-text">{resultText(receipt.run, props.routineName)}</p>
      <p className="text-xs text-dls-secondary">
        {[props.routineName, timeOfDay(finishedAt), steps > 0 ? t("agents.run_steps", { count: steps }) : null].filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}

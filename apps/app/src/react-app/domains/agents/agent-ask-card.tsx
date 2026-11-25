import type { PersonalAgentDetail, PersonalAgentRequest } from "@openwork/types/den/personal-agents";
import { ShieldCheck, ShieldX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

import { agentOwnerFirstName, requestConnectionName, requestToolTitle, toolRequestReceipt } from "./agent-permission-words";
import type { AgentsRuntime } from "./agents-runtime";
import { useDecideAgentToolRequest } from "./use-agent-permissions";

export function AgentAskCard({ runtime, agent, request, onAllowed }: {
  runtime: AgentsRuntime;
  agent: PersonalAgentDetail;
  request: PersonalAgentRequest;
  onAllowed: () => void;
}) {
  const decision = useDecideAgentToolRequest(runtime, agent.agent.id, request.id, onAllowed);
  if (request.kind !== "tool") return null;
  const name = agent.agent.name;
  const current = request.status === "pending" && decision.data?.id === request.id ? decision.data : request;
  const tool = requestToolTitle(current);
  const connection = requestConnectionName(current);

  if (current.status !== "pending") {
    const deniedByYou = decision.data?.id === current.id && decision.data.status === "denied"
      || agent.role === "owner" && current.decidedBy?.memberId === agent.agent.ownerMemberId;
    const receipt = toolRequestReceipt(current, name, deniedByYou);
    if (!receipt) return null;
    const Shield = current.status === "denied" ? ShieldX : ShieldCheck;
    return (
      <p data-agent-ask={current.id} data-agent-ask-receipt={current.status} className="flex items-baseline gap-1.5 text-xs leading-relaxed text-dls-secondary">
        <Shield aria-hidden="true" className="relative top-0.5 size-3.5 shrink-0" />
        {receipt}
      </p>
    );
  }
  if (current.canDecide.length === 0) {
    return (
      <p data-agent-ask={current.id} className="text-xs leading-relaxed text-dls-secondary">
        {t("agents.permission_ask_waiting", { owner: agentOwnerFirstName(agent.owner), tool, connection })}
      </p>
    );
  }

  return (
    <div data-agent-ask={current.id} aria-busy={decision.isPending} className="w-full max-w-[560px] rounded-2xl border border-dls-border bg-dls-surface p-4">
      <p className="wrap-anywhere text-[13px] font-medium text-dls-text">{t("agents.permission_ask_title", { agent: name, tool, connection })}</p>
      <p className="mt-1 text-xs text-dls-secondary">{t("agents.permission_ask_accounts")}</p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {current.canDecide.includes("deny") ? (
          <Button type="button" size="sm" variant="ghost" data-agent-ask-decision="deny" disabled={decision.isPending} onClick={() => decision.mutate("deny")}>
            {t("agents.permission_ask_deny")}
          </Button>
        ) : null}
        {current.canDecide.includes("always_allow") ? (
          <Button type="button" size="sm" variant="outline" data-agent-ask-decision="always_allow" disabled={decision.isPending} onClick={() => decision.mutate("always_allow")}>
            {t("agents.permission_ask_always")}
          </Button>
        ) : null}
        {current.canDecide.includes("allow_once") ? (
          <Button type="button" size="sm" data-agent-ask-decision="allow_once" disabled={decision.isPending} onClick={() => decision.mutate("allow_once")}>
            {t("agents.permission_ask_once")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

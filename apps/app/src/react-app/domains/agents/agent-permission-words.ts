import type { PersonalAgentConnectionTools, PersonalAgentPerson, PersonalAgentRequest, PersonalAgentSpend } from "@openwork/types/den/personal-agents";

import { currentLocale, t } from "@/i18n";

export function toolAccessSummary(connection: Pick<PersonalAgentConnectionTools, "available" | "lockedByOrganization" | "tools">): string {
  if (connection.lockedByOrganization) return t("agents.permissions_admin_blocked");
  if (!connection.available) return t("agents.permissions_not_connected");
  const counts = { allow: 0, ask: 0, block: 0 };
  for (const tool of connection.tools) counts[tool.access] += 1;
  return t("agents.permissions_counts", counts);
}

export function agentOwnerFirstName(owner: PersonalAgentPerson | null): string {
  return owner?.name.trim().split(/\s+/)[0] || t("agents.permissions_owner");
}

export function requestToolTitle(request: Pick<PersonalAgentRequest, "toolTitle" | "toolName">): string {
  return request.toolTitle?.trim() || request.toolName?.trim() || t("agents.permission_ask_tool");
}

export function requestConnectionName(request: Pick<PersonalAgentRequest, "connectionName">): string {
  return request.connectionName?.trim() || t("agents.permission_ask_connection");
}

export function toolRequestReceipt(
  request: Pick<PersonalAgentRequest, "status" | "toolTitle" | "toolName" | "decidedBy">,
  agentName: string,
  decidedByYou = false,
): string | null {
  const tool = requestToolTitle(request);
  switch (request.status) {
    case "denied":
      return t("agents.permission_ask_denied", {
        decider: (!decidedByYou && request.decidedBy?.name.trim()) || t("agents.permission_ask_you"),
        agent: agentName,
        tool,
      });
    case "allowed_once":
    case "used":
      return t("agents.permission_ask_once_receipt", { agent: agentName, tool });
    case "always_allowed":
      return t("agents.permission_ask_always_receipt", { agent: agentName, tool });
    default:
      return null;
  }
}

export function formatAgentMoney(micros: number, fractionDigits = 2): string {
  return new Intl.NumberFormat(currentLocale(), {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(micros / 1_000_000);
}

export function agentSpendLine(spend: Pick<PersonalAgentSpend, "monthMicros" | "budgetMicros">): string {
  const amount = formatAgentMoney(spend.monthMicros);
  return spend.budgetMicros === null
    ? t("agents.permissions_spend_month", { amount })
    : t("agents.permissions_spend_limit", { amount, limit: formatAgentMoney(spend.budgetMicros) });
}

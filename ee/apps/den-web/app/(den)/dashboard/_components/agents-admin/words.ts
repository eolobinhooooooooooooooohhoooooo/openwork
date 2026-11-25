import type { AutomationRunStatus } from "@openwork/types/automations";
import type { PersonalAgentAdminItem, PersonalAgentEventDetail } from "@openwork/types/den/personal-agents";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatAgentMoney(micros: number) {
  return usd.format(micros / 1_000_000);
}

function roleLabel(role: string) {
  return role === "manager" ? "Manager" : role === "collaborator" ? "Collaborator" : "Member";
}

export function sharedWithText(people: readonly Pick<PersonalAgentAdminItem["sharedWith"][number], "name" | "role">[]) {
  if (people.length === 0) return "Only the owner";
  if (people.length > 3) return `${people.length} people`;
  return people.map(({ name, role }) => `${name || "Unnamed member"} (${roleLabel(role)})`).join(", ");
}

export function writeAccessText({ allowed, ask, blocked }: PersonalAgentAdminItem["writeAccess"]) {
  return allowed || ask || blocked ? `${allowed} allowed · ${ask} ask · ${blocked} blocked` : "Asks first";
}

export function agentEventSentence(action: string, detail: PersonalAgentEventDetail, agentName: string | null) {
  const text = (key: string) => {
    const value = detail[key];
    return typeof value === "string" ? value.trim() : "";
  };
  const agent = agentName || "an agent";
  const member = text("member") || text("memberName") || "a member";
  const role = roleLabel(text("role"));
  const tool = text("tool") || "a tool";
  const routine = text("routineName");
  const budget = typeof detail.monthlyBudgetMicros === "number" ? formatAgentMoney(detail.monthlyBudgetMicros) : null;
  switch (action) {
    case "agent.created": return `created ${agent}`;
    case "agent.updated": return `updated ${agent}`;
    case "agent.archived": return `archived ${agent}`;
    case "agent.paused": return `paused ${agent}`;
    case "agent.resumed": return `resumed ${agent}`;
    case "agent.transferred": return `moved ${agent} from ${text("from") || "the previous owner"} to ${text("to") || "another owner"}`;
    case "agent.budget_set": return budget ? `set ${agent}'s budget to ${budget} a month` : `removed ${agent}'s budget`;
    case "agent.tools_changed": return `changed the tools ${agent} may use`;
    case "share.added": return `shared ${agent} with ${member} as ${role}`;
    case "share.changed": return `changed ${member}'s role on ${agent} to ${role}`;
    case "share.removed": return `removed ${member}'s access to ${agent}`;
    case "routine.created": return `added ${routine || "a routine"} to ${agent}`;
    case "routine.changed": return `changed ${routine || "a routine"} on ${agent}`;
    case "request.asked": return text("tool") ? `asked to let ${agent} use ${tool}` : `asked to change ${agent}`;
    case "request.denied": return text("tool") ? `denied ${agent} access to ${tool}` : `denied a request to change ${agent}`;
    case "request.allowed_once": return `let ${agent} use ${tool} once`;
    case "request.always_allowed": return `let ${agent} always use ${tool}`;
    case "request.approved": return `approved a change to ${agent}`;
    case "organization.tools_changed": return "changed the tools no agent may use";
    case "organization.budget_set": return budget ? `set the spending limit for every agent to ${budget} a month` : "removed the spending limit for every agent";
    default: return `recorded ${action.replace(/[._-]+/g, " ").trim() || "a change"}`;
  }
}

export const runStatusText: Record<AutomationRunStatus, string> = {
  queued: "Waiting",
  claimed: "Starting",
  running: "Running",
  succeeded: "Finished",
  failed: "Failed",
  cancelled: "Canceled",
  skipped: "Skipped",
};

export function latestAgentRun(routines: PersonalAgentAdminItem["routines"]) {
  return routines.reduce<PersonalAgentAdminItem["routines"][number]["latestRun"]>((latest, routine) => {
    const run = routine.latestRun;
    return run && (!latest || run.createdAt > latest.createdAt) ? run : latest;
  }, null);
}

const facePalette = [
  "bg-sky-100 text-sky-900", "bg-teal-100 text-teal-900", "bg-amber-100 text-amber-900",
  "bg-rose-100 text-rose-900", "bg-indigo-100 text-indigo-900",
];

export function agentFaceColor(name: string) {
  let hash = 0;
  for (const char of name) hash = (Math.imul(hash, 31) + (char.codePointAt(0) ?? 0)) >>> 0;
  return facePalette[hash % facePalette.length];
}

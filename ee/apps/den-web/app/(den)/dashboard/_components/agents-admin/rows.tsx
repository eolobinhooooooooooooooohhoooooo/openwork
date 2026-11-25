import { Menu } from "@base-ui/react/menu";
import type { PersonalAgentAdminItem, PersonalAgentSpend } from "@openwork/types/den/personal-agents";
import { Ellipsis } from "lucide-react";
import { useRef, useState } from "react";
import { DenBadge } from "../../../_components/ui/badge";
import { buttonVariants } from "../../../_components/ui/button";
import { denDropdownMenuBaseClass } from "../../../_components/ui/dropdown-styles";
import { DenUsageMeter } from "../../../_components/ui/usage-meter";
import type { DenOrgMember } from "../../../_lib/den-org";
import { formatRelativeTime } from "../config-blobs/config-blobs-model";
import { useEditAdminAgent, type AgentEdit } from "./data";
import { AgentChangeDialog, type AgentDialogKind } from "./dialogs";
import { agentFaceColor, formatAgentMoney, latestAgentRun, runStatusText, sharedWithText, writeAccessText } from "./words";

const cells = "px-3 py-2.5 align-middle";
const headings = ["Agent", "Owner", "Shared with", "Can change things", "This month", "Last run", "Actions"];

function SpendCell({ spend }: { spend: PersonalAgentSpend }) {
  const { monthMicros, budgetMicros, overBudget } = spend;
  const amount = formatAgentMoney(monthMicros);
  const segments = 10;
  const used = budgetMicros && !overBudget ? Math.ceil(monthMicros / budgetMicros * segments) : segments;
  return <div className="grid justify-items-start gap-1 whitespace-nowrap tabular-nums">
    {budgetMicros === null ? <span>{amount}</span> : <DenUsageMeter label="" used={used} total={segments}
      readout={`${amount} of ${formatAgentMoney(budgetMicros)}`} className="w-full" />}
    {overBudget ? <DenBadge tone="danger" size="sm">Over budget</DenBadge> : null}
  </div>;
}

function AgentRow({ orgId, item, members, now }: {
  orgId: string;
  item: PersonalAgentAdminItem;
  members: readonly DenOrgMember[];
  now: number;
}) {
  const [dialog, setDialog] = useState<AgentDialogKind | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const edit = useEditAdminAgent(orgId, item.agent.id);
  const { name, pausedAt } = item.agent;
  const lastRun = latestAgentRun(item.routines);
  const pauseAction = pausedAt === null ? "pause" : "resume";
  const actions = [
    { action: pauseAction, label: pauseAction === "pause" ? "Pause" : "Resume", select: () => edit.mutate({ action: pauseAction }) },
    { action: "budget", label: "Set budget…", select: () => open("budget") },
    { action: "transfer", label: "Move to another owner…", select: () => open("transfer") },
    { action: "archive", label: "Archive…", select: () => open("archive") },
  ];

  function open(kind: AgentDialogKind) {
    edit.reset();
    setDialog(kind);
  }

  function save(change: AgentEdit) {
    edit.mutate(change, { onSuccess: () => setDialog(null) });
  }

  return <tr data-agent-row={name}>
    <th scope="row" className={`${cells} font-medium`}>
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className={`grid size-7 shrink-0 place-items-center rounded-full ${agentFaceColor(name)}`}>{Array.from(name)[0]?.toLocaleUpperCase()}</span>
        <div className="min-w-0">
          <div className="break-words">{name}</div>
          {pausedAt !== null ? <DenBadge size="sm">Paused</DenBadge> : null}
        </div>
      </div>
    </th>
    <td className={cells}>{item.owner.name || "Unnamed member"}</td>
    <td className={cells}>{sharedWithText(item.sharedWith)}</td>
    <td className={cells}>{writeAccessText(item.writeAccess)}</td>
    <td className={cells}><SpendCell spend={item.spend} /></td>
    <td className={cells}>{lastRun ? <>
      <time dateTime={new Date(lastRun.createdAt).toISOString()} className="whitespace-nowrap">{formatRelativeTime(new Date(lastRun.createdAt).toISOString(), now)}</time>
      <div className="text-[var(--dls-text-secondary)]">{runStatusText[lastRun.status]}</div>
    </> : "Not yet"}</td>
    <td className={`${cells} text-right`}>
      <Menu.Root>
        <Menu.Trigger ref={trigger} data-agent-menu="" aria-label={`Actions for ${name}`} disabled={edit.isPending}
          className={buttonVariants({ variant: "ghost", size: "inline", className: "w-8" })}>
          <Ellipsis size={16} aria-hidden="true" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="end" sideOffset={6} className="z-50">
            <Menu.Popup className={`${denDropdownMenuBaseClass} w-max overflow-y-auto p-1 text-[13px]`}>
              {actions.map(({ action, label, select }) => <Menu.Item key={action} data-agent-action={action} onClick={select}
                className={`cursor-pointer rounded-md px-3 py-2 outline-hidden data-highlighted:bg-gray-100 ${action === "archive" ? "text-red-600" : ""}`}>
                {label}
              </Menu.Item>)}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      {!dialog && edit.isError ? <p role="alert" className="text-xs text-red-600">Could not {pauseAction}. Try again.</p> : null}
      {dialog ? <AgentChangeDialog kind={dialog} item={item} members={members} finalFocus={trigger}
        busy={edit.isPending} error={edit.isError ? "Could not save this change. Try again." : null}
        onClose={() => { edit.reset(); setDialog(null); }} onSave={save} /> : null}
    </td>
  </tr>;
}

export function AgentTable({ orgId, items, members }: {
  orgId: string;
  items: readonly PersonalAgentAdminItem[];
  members: readonly DenOrgMember[];
}) {
  const now = Date.now();
  if (!items.length) return <p className="border-y border-[var(--dls-border)] py-5 text-[13px] text-[var(--dls-text-secondary)]">
    No agents yet. Members make them from the + beside Agents in the OpenWork app.
  </p>;
  return <div className="overflow-x-auto">
    <table aria-label="Personal agents" className="w-full text-left text-[13px]">
      <thead className="border-b border-[var(--dls-border)] text-xs text-[var(--dls-text-secondary)]">
        <tr>{headings.map((label) => <th key={label} scope="col" className={`${cells} font-medium`}>
          <span className={label === "Actions" ? "sr-only" : undefined}>{label}</span>
        </th>)}</tr>
      </thead>
      <tbody className="divide-y divide-[var(--dls-border)] border-b border-[var(--dls-border)]">
        {items.map((item) => <AgentRow key={item.agent.id} orgId={orgId} item={item} members={members} now={now} />)}
      </tbody>
    </table>
  </div>;
}

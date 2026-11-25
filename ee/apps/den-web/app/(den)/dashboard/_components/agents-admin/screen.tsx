"use client";

import type { PersonalAgentOrgPolicy } from "@openwork/types/den/personal-agents";
import { notFound } from "next/navigation";
import { useRef, useState } from "react";
import { DenButton, buttonVariants } from "../../../_components/ui/button";
import { DashboardPageTemplate } from "../../../_components/ui/dashboard-page-template";
import { DenNotice } from "../../../_components/ui/notice";
import { DenSkeleton } from "../../../_components/ui/skeleton";
import { getOrgAccessFlags, orgFeatureEnabled, type DenOrgContext } from "../../../_lib/den-org";
import { useOrgDashboard } from "../../_providers/org-dashboard-provider";
import { formatRelativeTime } from "../config-blobs/config-blobs-model";
import { isNativeProviderConnectionId, useMcpConnections, useMcpConnectionTools } from "../mcp-connections-data";
import { useAdminAgentEvents, useAdminAgents, useEditAgentPolicy, type PolicyEdit } from "./data";
import { agentToolTitle, BlockAgentToolsDialog, BudgetSelect, orgBudgets } from "./dialogs";
import { AgentTable } from "./rows";
import { agentEventSentence, formatAgentMoney } from "./words";

const muted = "text-[13px] text-[var(--dls-text-secondary)]";
const divider = "border-[var(--dls-border)]";

function LoadError({ message, retry }: { message: string; retry: () => void }) {
  return <div className="space-y-2">
    <DenNotice tone="error" message={message} />
    <DenButton variant="secondary" size="sm" onClick={retry}>Try again</DenButton>
  </div>;
}

function BlockedToolRows({ connectionId, name, toolNames, busy, onUnblock }: {
  connectionId: string;
  name: string;
  toolNames: readonly string[];
  busy: boolean;
  onUnblock: (toolName: string) => void;
}) {
  const { data } = useMcpConnectionTools(connectionId, false);
  return toolNames.map((toolName) => {
    const tool = data?.tools.find((entry) => entry.name === toolName);
    const label = `${name} · ${tool ? agentToolTitle(tool) : toolName}`;
    return <li key={toolName} className="flex min-h-10 items-center justify-between gap-3 py-1 text-[13px]">
      <span className="min-w-0 break-words">{label}</span>
      <DenButton variant="ghost" size="sm" disabled={busy} aria-label={`Unblock ${label}`} onClick={() => onUnblock(toolName)}>Unblock</DenButton>
    </li>;
  });
}

function OrgAgentPolicy({ orgId, policy }: { orgId: string; policy: PersonalAgentOrgPolicy }) {
  const [blocking, setBlocking] = useState(false);
  const blockTrigger = useRef<HTMLButtonElement>(null);
  const connections = useMcpConnections("manageable");
  const edit = useEditAgentPolicy(orgId);
  const blocked = Object.entries(policy.toolPolicy.tools).flatMap(([connectionId, tools]) => {
    const names = Object.keys(tools).filter((name) => tools[name] === "block");
    return names.length ? [{ connectionId, names }] : [];
  });
  const candidates = connections.data?.filter(({ id, nativeProviderKey }) => !isNativeProviderConnectionId(id, nativeProviderKey)) ?? [];

  function saveBlock(change: PolicyEdit) {
    edit.mutate(change, { onSuccess: () => setBlocking(false) });
  }

  return <section aria-labelledby="agents-policy-title" className="space-y-3">
    <h2 id="agents-policy-title" className="text-base font-semibold">For every agent</h2>
    <div className={`divide-y divide-[var(--dls-border)] border-y ${divider}`}>
      <div className="py-2">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h3 className="text-[13px] font-medium">Tools no agent may use</h3>
          <button type="button" data-agents-block-tool="" ref={blockTrigger}
            className={buttonVariants({ variant: "secondary", size: "sm", className: "disabled:opacity-60" })}
            disabled={edit.isPending || !connections.data} onClick={() => { edit.reset(); setBlocking(true); }}>Block a tool…</button>
        </div>
        {connections.isError ? <LoadError message="Could not load connections." retry={() => void connections.refetch()} /> : null}
        {blocked.length ? <ul className="mt-2 divide-y divide-[var(--dls-border)]">
          {blocked.map(({ connectionId, names }) => <BlockedToolRows key={connectionId} connectionId={connectionId}
            name={connections.data?.find(({ id }) => id === connectionId)?.name ?? "Unavailable connection"} toolNames={names}
            busy={edit.isPending} onUnblock={(name) => edit.mutate({ action: "unblock", connectionId, toolNames: [name] })} />)}
        </ul> : <p className={`py-2 ${muted}`}>No tools are blocked for every agent.</p>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2">
        <h3 id="agents-org-budget" className="text-[13px] font-medium">Most an agent may spend in a month</h3>
        <BudgetSelect label="Most an agent may spend in a month" value={policy.monthlyBudgetMicros} limits={orgBudgets}
          disabled={edit.isPending} onChange={(monthlyBudgetMicros) => edit.mutate({ action: "budget", monthlyBudgetMicros })} />
      </div>
    </div>
    {!blocking && edit.isError ? <DenNotice tone="error" message="Could not save this change. Try again." /> : null}
    {blocking ? <BlockAgentToolsDialog connections={candidates} policy={policy} finalFocus={blockTrigger} busy={edit.isPending}
      error={edit.isError ? "Could not block these tools. Try again." : null} onSave={saveBlock}
      onClose={() => { edit.reset(); setBlocking(false); }} /> : null}
  </section>;
}

function AgentEvents({ orgId }: { orgId: string }) {
  const events = useAdminAgentEvents(orgId);
  const items = events.data?.items;
  const now = Date.now();
  return <section data-agents-events="" aria-labelledby="agents-events-title" aria-busy={events.isPending} className="space-y-3">
    <h2 id="agents-events-title" className="text-base font-semibold">Who changed what</h2>
    {events.isError ? <LoadError message="Could not refresh changes to agents." retry={() => void events.refetch()} /> : null}
    {events.isPending ? <DenSkeleton className="h-24 w-full" /> : null}
    {items?.length === 0 ? <p className={muted}>No changes yet.</p> : null}
    {items?.length ? <ol className={`divide-y divide-[var(--dls-border)] border-y ${divider}`}>
      {items.map((event) => {
        const stamp = new Date(event.createdAt);
        const iso = stamp.toISOString();
        return <li key={event.id} data-agents-event="" className="py-2 text-[13px] leading-5">
          <time dateTime={iso} title={stamp.toLocaleString()} className="text-[var(--dls-text-secondary)]">{formatRelativeTime(iso, now)}</time>
          <span className="text-[var(--dls-text-secondary)]"> · </span>
          <span className="font-medium">{event.actor.name || "A member"}</span>{" "}{agentEventSentence(event.action, event.detail, event.agentName)}
        </li>;
      })}
    </ol> : null}
  </section>;
}

function AgentsAdmin({ org }: { org: DenOrgContext }) {
  const orgId = org.organization.id;
  const agents = useAdminAgents(orgId);
  const list = agents.data;
  return <div data-agents-admin="">
    <DashboardPageTemplate title="Agents" description={`Every personal agent in ${org.organization.name}. Members set them up in the OpenWork app.`}
      action={list ? <p className="text-[13px] font-medium tabular-nums">{formatAgentMoney(list.monthMicros)} this month</p> : null}>
      <div className="space-y-8">
        {agents.isError ? <LoadError message="Could not refresh the list of agents." retry={() => void agents.refetch()} /> : null}
        {agents.isPending ? <div aria-busy="true"><DenSkeleton className="h-32 w-full" /></div> : null}
        {list ? <>
          <AgentTable orgId={orgId} items={list.items} members={org.members} />
          <OrgAgentPolicy orgId={orgId} policy={list.policy} />
        </> : null}
        <AgentEvents orgId={orgId} />
      </div>
    </DashboardPageTemplate>
  </div>;
}

export function AgentsAdminRoute() {
  const { orgBusy, orgContext } = useOrgDashboard();
  if (orgBusy || !orgContext) return null;
  if (!orgFeatureEnabled(orgContext, "personalAgents")) notFound();
  const { role, isOwner, permissions } = orgContext.currentMember;
  if (!getOrgAccessFlags(role, isOwner, permissions).isAdmin) notFound();
  return <AgentsAdmin key={orgContext.organization.id} org={orgContext} />;
}

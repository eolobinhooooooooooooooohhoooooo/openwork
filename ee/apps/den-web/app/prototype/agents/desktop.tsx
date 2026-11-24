"use client";

import { Menu } from "@base-ui/react/menu";
import {
  Bookmark,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  LayoutGrid,
  Lock,
  Play,
  Plug,
  Plus,
  Repeat,
  ShieldCheck,
  SlidersHorizontal,
  SquarePen,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { type AccessDraft, peopleLabel } from "../../(den)/dashboard/_components/access-summary";
import { ConnectorLogo } from "../../(den)/dashboard/_components/item-logo";
import { formatWorkbotCost } from "../../(den)/dashboard/_features/workbot-usage/workbot-usage-data";
import { AppButton, AppSwitch, CardDetails, CardRow, CardShell, Composer, PaneHeader, ToolList, UserBubble, Working, accessWord } from "./app-parts";
import {
  type Access,
  type Agent,
  type AgentNote,
  type AgentRun,
  type ChatCard,
  type ChatStep,
  type ChatTurn,
  type ConnectorId,
  type RunStep,
  type SetupStepId,
  CHAT_EXTRAS,
  CONNECTORS,
  MEMBER,
  NOT_SHARED,
  PEOPLE,
  ROLE_LABEL,
  STORY,
  TEAMS,
  agentFilePath,
  agentSlug,
  agentStateLine,
  agentThread,
  budgetLine,
  canChange,
  canSee,
  connectorById,
  draftUses,
  effectiveTools,
  firstNameOf,
  inMyList,
  isMine,
  isShared,
  isWriteTool,
  listWords,
  lowerFirst,
  nextRunLine,
  nextRunText,
  overBudget,
  personName,
  presetOf,
  roleOf,
  routinesLine,
  sampleAgents,
  scheduleLine,
  shareTargets,
  sharedPeople,
  sharedStateLine,
  sharedWithMe,
  toolLabel,
  toolsLine,
  usedByLine,
  usedByMe,
} from "./model";
import { AgentSettings, MonthSpend, SharedAgentSettings } from "./settings";
import { DraftThread, NewAgentDialog } from "./setup";
import { BrowseDialog, ShareDialog } from "./share";

// ---------------------------------------------------------------------------
// The OpenWork desktop app: an agent starts from the + beside Agents, keeps
// its own thread in the sidebar, and its settings open beside that thread.
// ---------------------------------------------------------------------------

export type DesktopView =
  | { kind: "chat" }
  | { kind: "agents" }
  | { kind: "agent"; agentId: string; settings: boolean; share?: boolean };

export type DesktopAppProps = {
  view: DesktopView;
  onView: (view: DesktopView) => void;
  agents: Agent[];
  access: Access;
  connected: Record<ConnectorId, boolean>;
  turns: ChatTurn[];
  unreadIds: string[];
  runningId: string | null;
  // A question someone just asked an agent, until its answer arrives.
  asking: { agentId: string; question: string } | null;
  onAsk: (prompt: string) => void;
  onCard: (turnId: string, accept: boolean) => void;
  // Without a routine it runs the agent once, on its instructions alone.
  onRun: (agentId: string, routineId?: string) => void;
  onNote: (agentId: string, text: string) => void;
  // A note on a shared agent waits for this: keep it for everyone, or not.
  onAnswerNote: (agentId: string, noteId: string, keep: boolean) => void;
  onQuestion: (agentId: string, question: string) => void;
  onPatch: (agentId: string, patch: Partial<Agent>) => void;
  removed: Agent | null;
  onRemove: (agent: Agent) => void;
  onUndoRemove: () => void;
  onCopy: (agent: Agent) => void;
  onShare: (agentId: string, share: AccessDraft, managers: string[]) => void;
  onRemoveNote: (agentId: string, noteId: string) => void;
  onConnect: (id: ConnectorId) => void;
  // A new agent starts as a named draft. Its first message is its job, then a few cards finish it.
  onCreate: (name: string) => void;
  onJob: (agentId: string, text: string) => void;
  onSetup: (agentId: string, step: SetupStepId, answer: "done" | "skipped", patch?: Partial<Agent>) => void;
};

const APP_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const SAMPLE_NAMES = sampleAgents().map((agent) => agent.name);

export function DesktopApp({
  view, onView, agents, access, connected, turns, unreadIds, runningId, asking, onAsk, onCard, onRun, onNote, onAnswerNote, onQuestion, onPatch,
  removed, onRemove, onUndoRemove, onCopy, onShare, onRemoveNote, onConnect, onCreate, onJob, onSetup,
}: DesktopAppProps) {
  const [dialog, setDialog] = useState<"new" | "browse" | null>(null);
  const found = view.kind === "agent" ? agents.find((agent) => agent.id === view.agentId) ?? null : null;
  const threadAgent = found && canSee(found, access) ? found : null;
  const showAgents = view.kind === "agents" || (view.kind === "agent" && !threadAgent);
  const settingsOpen = view.kind === "agent" && view.settings;
  const shareAgent = view.kind === "agent" && view.share === true && threadAgent && isMine(threadAgent) ? threadAgent : null;
  const listed = agents.filter((agent) => inMyList(agent, access));
  const atAgentLimit = agents.filter(isMine).length >= access.maxAgents;

  const openThread = (agentId: string) => onView({ kind: "agent", agentId, settings: false });
  const openSettings = (agentId: string) => onView({ kind: "agent", agentId, settings: true });
  // Sharing opens over whatever is showing, so the thread and its settings stay where they were.
  const openShare = (agentId: string) => onView({ kind: "agent", agentId, settings: view.kind === "agent" && view.agentId === agentId && view.settings, share: true });
  const leave = (agentId: string) => {
    onPatch(agentId, { added: false, on: false });
    onView({ kind: "agents" });
  };

  return (
    <div className="flex min-h-0 flex-1 bg-[#f9f9fb] text-[13px] text-[#1c2024]" style={{ fontFamily: APP_FONT }} data-testid="desktop-app">
      <aside className="hidden w-[260px] shrink-0 flex-col md:flex" aria-label="OpenWork sidebar">
        <div className="flex h-11 shrink-0 items-center gap-2 px-4" aria-hidden>
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        </div>
        <nav className="flex flex-col gap-0.5 px-2" aria-label="OpenWork">
          <NavItem icon={SquarePen} label="New session" hint="⌘N" />
          <NavItem icon={Clock3} label="Automations" />
          <NavItem icon={Repeat} label="Agents" badge="Test" selected={showAgents} onClick={() => onView({ kind: "agents" })} testId="desktop-nav-agents" />
          <NavItem icon={LayoutGrid} label="Library" />
        </nav>
        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-3">
          <div className="flex flex-col gap-0.5">
            <GroupLabel>Sessions</GroupLabel>
            <SessionRow label="Set up my agents" selected={view.kind === "chat"} onClick={() => onView({ kind: "chat" })} testId="desktop-session-setup" />
            <SessionRow label="Plan the Q4 offsite" />
            <SessionRow label="Tidy the release checklist" />
          </div>
          <div className="flex flex-col gap-0.5" data-testid="desktop-agent-threads">
            <GroupLabel action={<AgentsPlus onNew={() => setDialog("new")} onBrowse={() => setDialog("browse")} />}>Agents</GroupLabel>
            {listed.map((agent) => (
              <SessionRow
                key={agent.id}
                label={agent.name}
                sub={agent.setup ? "Draft" : isMine(agent) ? (agent.on ? undefined : "Paused") : `from ${firstNameOf(agent.owner)}`}
                dot={unreadIds.includes(agent.id) ? "unread" : agent.on && overBudget(agent, access) ? "attention" : undefined}
                selected={view.kind === "agent" && view.agentId === agent.id}
                onClick={() => openThread(agent.id)}
                testId={`desktop-thread-${agent.id}`}
              />
            ))}
            {listed.length === 0 ? <p className="px-2.5 py-1.5 text-[12px] leading-4 text-[#8b8d98]">Each agent keeps a thread here. Start one from the +.</p> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2.5 border-t border-[#e0e1e6] px-3 py-2.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#011627] text-[10px] font-semibold tracking-wider text-white">{MEMBER.initials}</span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] font-medium leading-4">{MEMBER.name}</span>
            <span className="truncate text-[11px] leading-4 text-[#8b8d98]">OpenWork Cloud · Sample org</span>
          </span>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 p-2 md:pl-0">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-[#e0e1e6] bg-[#fcfcfd] shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
          {view.kind === "chat" ? (
            <SetupChat
              turns={turns}
              agents={agents}
              access={access}
              onAsk={onAsk}
              onCard={onCard}
              onOpenThread={openThread}
              onOpenShare={openShare}
              onOpenAgents={() => onView({ kind: "agents" })}
            />
          ) : null}
          {showAgents ? (
            <AgentsPage
              agents={agents}
              access={access}
              connected={connected}
              unreadIds={unreadIds}
              atAgentLimit={atAgentLimit}
              removed={removed}
              onUndoRemove={onUndoRemove}
              onNew={() => setDialog("new")}
              onBrowse={() => setDialog("browse")}
              onOpenThread={openThread}
              onOpenSettings={openSettings}
              onPatch={onPatch}
            />
          ) : null}
          {threadAgent ? (
            <div className="flex min-h-0 min-w-0 flex-1">
              {/* Wide windows show the thread and its settings side by side. Narrow ones show one at a time. */}
              <div className={`min-w-0 flex-1 flex-col ${settingsOpen ? "hidden xl:flex" : "flex"}`}>
                {threadAgent.setup ? (
                  <DraftThread
                    key={threadAgent.id}
                    agent={threadAgent}
                    setup={threadAgent.setup}
                    access={access}
                    connected={connected}
                    settingsOpen={settingsOpen}
                    onJob={(text) => onJob(threadAgent.id, text)}
                    onSetup={(step, answer, patch) => onSetup(threadAgent.id, step, answer, patch)}
                    onTurnOn={() => onPatch(threadAgent.id, { on: true, setup: null })}
                    onSettings={() => onView({ kind: "agent", agentId: threadAgent.id, settings: !settingsOpen })}
                  />
                ) : (
                  <AgentThread
                    key={threadAgent.id}
                    agent={threadAgent}
                    access={access}
                    running={runningId === threadAgent.id}
                    pending={asking?.agentId === threadAgent.id ? asking.question : null}
                    settingsOpen={settingsOpen}
                    onRun={() => onRun(threadAgent.id)}
                    onNote={(text) => onNote(threadAgent.id, text)}
                    onAnswerNote={(noteId, keep) => onAnswerNote(threadAgent.id, noteId, keep)}
                    onQuestion={(question) => onQuestion(threadAgent.id, question)}
                    onTurnOn={() => onPatch(threadAgent.id, { on: true })}
                    onShare={() => openShare(threadAgent.id)}
                    onSettings={() => onView({ kind: "agent", agentId: threadAgent.id, settings: !settingsOpen })}
                  />
                )}
              </div>
              {settingsOpen ? (
                <SettingsPanel key={threadAgent.id} agent={threadAgent} onClose={() => openThread(threadAgent.id)}>
                  {canChange(threadAgent) ? (
                    <AgentSettings
                      agent={threadAgent}
                      access={access}
                      connected={connected}
                      running={runningId === threadAgent.id}
                      onPatch={(patch) => onPatch(threadAgent.id, patch)}
                      onRemove={() => onRemove(threadAgent)}
                      onLeave={() => leave(threadAgent.id)}
                      onConnect={onConnect}
                      onOpenShare={() => openShare(threadAgent.id)}
                      onStopSharing={() => onShare(threadAgent.id, NOT_SHARED, [])}
                      onRun={(routineId) => onRun(threadAgent.id, routineId)}
                      onRemoveNote={(noteId) => onRemoveNote(threadAgent.id, noteId)}
                    />
                  ) : (
                    <SharedAgentSettings
                      agent={threadAgent}
                      access={access}
                      connected={connected}
                      atAgentLimit={atAgentLimit}
                      onPatch={(patch) => onPatch(threadAgent.id, patch)}
                      onCopy={() => onCopy(threadAgent)}
                      onLeave={() => leave(threadAgent.id)}
                      onConnect={onConnect}
                    />
                  )}
                </SettingsPanel>
              ) : null}
            </div>
          ) : null}
        </div>
      </main>

      {dialog === "new" ? (
        <NewAgentDialog
          taken={agents.filter(isMine).map((agent) => agent.name)}
          atLimit={atAgentLimit}
          maxAgents={access.maxAgents}
          onCreate={(name) => {
            setDialog(null);
            onCreate(name);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "browse" ? (
        <BrowseDialog
          agents={agents}
          access={access}
          onAdd={(agentId) => onPatch(agentId, { added: true })}
          onOpen={(agentId) => {
            setDialog(null);
            openThread(agentId);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {shareAgent ? (
        <ShareDialog
          key={shareAgent.id}
          agent={shareAgent}
          access={access}
          onShare={(share, managers) => onShare(shareAgent.id, share, managers)}
          onClose={() => onView({ kind: "agent", agentId: shareAgent.id, settings: settingsOpen })}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar and shared parts
// ---------------------------------------------------------------------------

function NavItem({ icon: Icon, label, hint, badge, selected = false, onClick, testId }: {
  icon: typeof SquarePen;
  label: string;
  hint?: string;
  badge?: string;
  selected?: boolean;
  onClick?: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-current={selected ? "page" : undefined}
      className={`flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[13px] transition-colors ${selected ? "bg-[#f0f0f3] font-medium text-[#1c2024]" : "text-[#60646c] hover:bg-[#f0f0f3] hover:text-[#1c2024]"}`}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? <span className="rounded-full border border-[#e0e1e6] px-1.5 text-[10px] font-medium leading-4 text-[#60646c]">{badge}</span> : null}
      {hint ? <span className="text-[11px] text-[#8b8d98]">{hint}</span> : null}
    </button>
  );
}

function GroupLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-6 items-center justify-between gap-2 pl-2.5 pr-1">
      <p className="text-[11px] font-medium text-[#8b8d98]">{children}</p>
      {action}
    </div>
  );
}

// Where an agent starts: name a new one, or add one a teammate shared.
function AgentsPlus({ onNew, onBrowse }: { onNew: () => void; onBrowse: () => void }) {
  const item = "flex h-8 cursor-default select-none items-center gap-2 rounded-lg px-2.5 text-[13px] text-[#1c2024] outline-none data-[highlighted]:bg-[#f0f0f3]";
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="Add an agent"
        data-testid="desktop-agents-plus"
        className="grid size-6 shrink-0 place-items-center rounded-md text-[#60646c] outline-none transition-colors hover:bg-[#f0f0f3] hover:text-[#1c2024] focus-visible:bg-[#f0f0f3] data-[popup-open]:bg-[#f0f0f3] data-[popup-open]:text-[#1c2024]"
      >
        <Plus className="size-3.5" aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={6} className="z-50">
          <Menu.Popup className="min-w-[208px] rounded-xl border border-[#e0e1e6] bg-white p-1 shadow-[0_8px_24px_rgba(15,23,42,0.08)] outline-none" style={{ fontFamily: APP_FONT }}>
            <Menu.Item onClick={onNew} data-testid="desktop-plus-new" className={item}>
              <Plus className="size-4 shrink-0 text-[#60646c]" aria-hidden />
              New agent
            </Menu.Item>
            <Menu.Item onClick={onBrowse} data-testid="desktop-plus-browse" className={item}>
              <Users className="size-4 shrink-0 text-[#60646c]" aria-hidden />
              Browse shared agents
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function SessionRow({ label, sub, dot, selected = false, onClick, testId }: {
  label: string;
  sub?: string;
  dot?: "unread" | "attention";
  selected?: boolean;
  onClick?: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      data-dot={dot ?? "none"}
      aria-current={selected ? "page" : undefined}
      className={`flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[13px] transition-colors ${selected ? "bg-[#f0f0f3] font-medium text-[#1c2024]" : "text-[#60646c] hover:bg-[#f0f0f3] hover:text-[#1c2024]"}`}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {sub ? <span className="shrink-0 text-[11px] font-normal text-[#8b8d98]">{sub}</span> : null}
      {dot ? (
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot === "unread" ? "bg-[#2FBE54]" : "bg-[#E8933A]"}`}>
          <span className="sr-only">{dot === "unread" ? "New run" : "Over budget"}</span>
        </span>
      ) : null}
    </button>
  );
}

// An agent's settings, beside its thread. On a narrow window it takes the thread's place.
function SettingsPanel({ agent, onClose, children }: { agent: Agent; onClose: () => void; children: ReactNode }) {
  return (
    <aside
      className="flex min-h-0 w-full min-w-0 flex-col xl:w-[500px] xl:shrink-0 xl:border-l xl:border-[#e0e1e6]"
      aria-label={`${agent.name} settings`}
      data-testid="settings-panel"
      data-agent={agent.id}
    >
      <header className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-[#f3f4f6] py-2 pl-5 pr-3">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h2 className="text-[13px] font-medium text-[#1c2024]">Settings</h2>
          <span className="truncate text-[12px] text-[#8b8d98]">{agent.name}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          data-testid="settings-close"
          className="grid size-8 shrink-0 place-items-center rounded-lg text-[#60646c] transition-colors hover:bg-[#f0f0f3] hover:text-[#1c2024]"
        >
          <X className="size-4" aria-hidden />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="settings-scroll">
        <div className="mx-auto w-full max-w-[640px] px-5 py-5">{children}</div>
      </div>
    </aside>
  );
}

function StepLogo({ connector }: { connector: RunStep["connector"] }) {
  if (connector === "workbot") return <ConnectorLogo name="Slack" url="https://slack.com" size="xs" />;
  const entry = connectorById(connector);
  return <ConnectorLogo name={entry.name} url={entry.url} size="xs" />;
}

function RunSteps({ steps }: { steps: RunStep[] }) {
  if (steps.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {steps.map((step) => (
        <li key={step.key} className="flex items-center gap-2.5 text-[14px] leading-5 text-[#60646c]" data-blocked={step.blocked ? "true" : "false"}>
          <StepLogo connector={step.connector} />
          <span className="min-w-0 flex-1">{step.label}</span>
          {step.blocked ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-[12px] text-[#8b8d98]">
              <Lock className="size-3" aria-hidden />
              {`${toolLabel(step.tool)}: ${step.blocked.toLowerCase()}`}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

// What lands in the person's Slack, from the Workbot app.
function SlackMessage({ when, text }: { when: string; text: string }) {
  return (
    <div className="flex gap-2.5 rounded-xl border border-[#e0e1e6] bg-white p-3" data-testid="slack-message">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-[#e0e1e6] bg-white">
        <img src="/openwork-mark.svg" alt="" className="size-5" />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="flex items-center gap-1.5 text-[13px] leading-5">
          <span className="font-semibold text-[#1c2024]">Workbot</span>
          <span className="rounded bg-[#f0f0f3] px-1 text-[10px] font-medium leading-4 text-[#60646c]">APP</span>
          <span className="text-[12px] text-[#8b8d98]">{when}</span>
        </p>
        <p className="text-[14px] leading-5 text-[#1c2024]">{text}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Setting agents up by asking
// ---------------------------------------------------------------------------

function stagesOf(turn: ChatTurn): number {
  return turn.steps.length + 1 + (turn.card ? 1 : 0);
}

function awaitsAnswer(card: ChatCard | null): boolean {
  if (!card) return false;
  if (card.kind === "proposal") return card.state === "draft";
  if (card.kind === "permission" || card.kind === "share") return card.state === "ask";
  return false;
}

function SetupChat({ turns, agents, access, onAsk, onCard, onOpenThread, onOpenShare, onOpenAgents }: {
  turns: ChatTurn[];
  agents: Agent[];
  access: Access;
  onAsk: (prompt: string) => void;
  onCard: (turnId: string, accept: boolean) => void;
  onOpenThread: (agentId: string) => void;
  onOpenShare: (agentId: string) => void;
  onOpenAgents: () => void;
}) {
  const [text, setText] = useState("");
  const last = turns[turns.length - 1] ?? null;
  const lastId = last?.id ?? null;
  const total = last ? stagesOf(last) : 0;
  // A turn that was already here when the chat opened is shown whole; a new one plays out step by step.
  const [reveal, setReveal] = useState(() => (last ? { id: last.id, count: stagesOf(last) } : null));
  const shown = reveal !== null && reveal.id === lastId ? reveal.count : 0;
  const working = lastId !== null && shown < total;
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (lastId === null || shown >= total) return;
    const timer = window.setTimeout(() => setReveal({ id: lastId, count: shown + 1 }), shown === 0 ? 420 : 520);
    return () => window.clearTimeout(timer);
  }, [lastId, shown, total]);

  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTo({ top: node.scrollHeight });
  }, [turns.length, shown]);

  const asked = new Set(turns.map((turn) => turn.prompt));
  const usable = (prompt: string) => SAMPLE_NAMES.every((name) => !prompt.includes(name) || agents.some((agent) => agent.name === name));
  const next = STORY.find((prompt) => !asked.has(prompt) && usable(prompt)) ?? null;
  const extras = CHAT_EXTRAS.filter((prompt) => !asked.has(prompt) && usable(prompt)).slice(0, next ? 2 : 3);
  const waiting = awaitsAnswer(last?.card ?? null);

  const send = (prompt: string) => {
    if (working) return;
    setText("");
    onAsk(prompt.trim());
  };

  return (
    <>
      <PaneHeader title="Set up my agents">
        <span className="inline-flex items-center gap-1.5 text-[12px] text-[#8b8d98]">
          <Plug className="size-3.5" aria-hidden />
          OpenWork Cloud connected
        </span>
      </PaneHeader>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto" data-testid="chat-scroll">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 py-6">
          {turns.length === 0 ? (
            <div className="flex flex-col gap-2 pt-10" data-testid="chat-empty">
              <h2 className="text-[20px] font-semibold leading-7 tracking-[-0.2px] text-[#1c2024]">Ask for an agent</h2>
              <p className="max-w-[560px] text-[14px] leading-6 text-[#60646c]">
                Say what it should watch and how often. It runs in OpenWork Cloud, uses only the tools you allow, and messages you in Slack when there is something to tell you. You can also start one from the + beside Agents.
              </p>
            </div>
          ) : null}
          {turns.map((turn, index) => (
            <Turn
              key={turn.id}
              turn={turn}
              count={index === turns.length - 1 ? shown : stagesOf(turn)}
              agents={agents}
              access={access}
              onCard={(accept) => onCard(turn.id, accept)}
              onOpenThread={onOpenThread}
              onOpenShare={onOpenShare}
              onOpenAgents={onOpenAgents}
            />
          ))}
        </div>
      </div>
      <div className="shrink-0 px-5 pb-4 pt-2">
        <div className="mx-auto flex w-full max-w-[800px] flex-col gap-2.5">
          {working ? null : waiting ? (
            <p className="px-2 text-[12px] leading-4 text-[#8b8d98]" data-testid="chat-waiting">Answer the card above to go on, or ask for something else.</p>
          ) : (
            <div className="flex flex-wrap gap-2" data-testid="chat-suggestions">
              {next ? (
                <button
                  type="button"
                  onClick={() => send(next)}
                  data-testid="chat-next"
                  className="max-w-full truncate rounded-full border border-[#1c2024] bg-[#fcfcfd] px-3 py-1.5 text-left text-[13px] font-medium text-[#1c2024] transition-colors hover:bg-[#f0f0f3]"
                >
                  {next}
                </button>
              ) : null}
              {extras.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => send(prompt)}
                  data-testid="chat-extra"
                  className="max-w-full truncate rounded-full border border-[#e0e1e6] bg-[#fcfcfd] px-3 py-1.5 text-left text-[13px] text-[#60646c] transition-colors hover:bg-[#f0f0f3] hover:text-[#1c2024]"
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}
          <Composer value={text} onChange={setText} onSubmit={() => send(text)} placeholder="Describe your task..." disabled={working} />
        </div>
      </div>
    </>
  );
}

function Turn({ turn, count, agents, access, onCard, onOpenThread, onOpenShare, onOpenAgents }: {
  turn: ChatTurn;
  count: number;
  agents: Agent[];
  access: Access;
  onCard: (accept: boolean) => void;
  onOpenThread: (agentId: string) => void;
  onOpenShare: (agentId: string) => void;
  onOpenAgents: () => void;
}) {
  const steps = turn.steps.slice(0, count);
  const replied = count > turn.steps.length;
  const done = count >= stagesOf(turn);
  return (
    <div className="flex flex-col gap-3" data-testid="chat-turn" data-stage={done ? "done" : "working"}>
      <UserBubble>{turn.prompt}</UserBubble>
      {steps.length > 0 ? (
        <div className="flex flex-col">
          {steps.map((step) => <ActivityLine key={step.key} step={step} />)}
        </div>
      ) : null}
      {replied ? <p className="text-[14px] leading-6 text-[#1c2024]" data-testid="chat-reply">{turn.reply}</p> : <Working label={steps.length === 0 ? "Thinking" : "Working"} />}
      {done && turn.card ? (
        <ChatCardView card={turn.card} agents={agents} access={access} onCard={onCard} onOpenThread={onOpenThread} onOpenShare={onOpenShare} onOpenAgents={onOpenAgents} />
      ) : null}
    </div>
  );
}

// One thing the assistant did. The tool call behind it is there for anyone who wants it.
function ActivityLine({ step }: { step: ChatStep }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col" data-testid="chat-step">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="group/line flex w-fit max-w-full items-center gap-1.5 rounded-md py-1 text-left text-[14px] leading-5 text-[#60646c] transition-colors hover:text-[#1c2024]"
      >
        <span className="shrink-0">{step.label}</span>
        {step.detail ? <span className="truncate text-[#8b8d98]">{step.detail}</span> : null}
        <ChevronRight className={`size-3.5 shrink-0 text-[#8b8d98] transition-[transform,opacity] duration-150 motion-reduce:transition-none ${open ? "rotate-90 opacity-100" : "opacity-0 group-hover/line:opacity-100 group-focus-visible/line:opacity-100"}`} aria-hidden />
      </button>
      {open ? (
        <dl className="mb-2 mt-1 grid gap-x-4 gap-y-2 rounded-xl border border-[#e0e1e6] bg-[#f9f9fb] p-3 text-[12px] leading-5 sm:grid-cols-[64px_minmax(0,1fr)]" data-testid="chat-step-detail">
          <dt className="text-[#8b8d98]">Tool</dt>
          <dd className="font-mono text-[#1c2024]">{step.tool}</dd>
          <dt className="text-[#8b8d98]">Sent</dt>
          <dd><pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[#60646c]">{step.input}</pre></dd>
          <dt className="text-[#8b8d98]">Got back</dt>
          <dd><pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[#60646c]">{step.result}</pre></dd>
        </dl>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cards. Anything that gives an agent more reach waits for a click here.
// ---------------------------------------------------------------------------

// One agent, used by several people. A manager is a person or a whole team.
// People and teams, by the name a card shows.
function namesOf(ids: string[], short = false): string[] {
  return ids.flatMap((id) => {
    const person = PEOPLE.find((entry) => entry.id === id);
    if (person) return [short ? firstNameOf(id) : person.name];
    const team = TEAMS.find((entry) => entry.id === id);
    return team ? [team.name] : [];
  });
}

function managerLines(agent: Agent | null): string[] {
  return [
    "A manager can change what it does, its routines and which tools it uses. That changes it for everyone who uses it.",
    "They use it with their own accounts, like everyone else.",
    "Only you can share it or remove it.",
    agent?.paidBy === "org" ? "The org's agent budget still pays for everyone's use." : "Each person's use still counts toward their own limit.",
  ];
}

function shareLines(agent: Agent | null, managers: string[]): string[] {
  const named = namesOf(managers);
  return [
    "They get the same agent. They can ask it things, or turn on its routines for themselves.",
    "It works with each person's own accounts. Never yours.",
    named.length > 0
      ? `${listWords(named)} can change what it does, as ${named.length === 1 ? "a manager" : "managers"}. Everyone else only uses it.`
      : "Everyone joins as a collaborator: they use it, and only you can change what it does.",
    "They never see your runs. Only you can share it or remove it.",
    agent?.paidBy === "org" ? "The org's agent budget pays for everyone's use." : "Each person's use counts toward their own limit.",
  ];
}

function ChatCardView({ card, agents, access, onCard, onOpenThread, onOpenShare, onOpenAgents }: {
  card: ChatCard;
  agents: Agent[];
  access: Access;
  onCard: (accept: boolean) => void;
  onOpenThread: (agentId: string) => void;
  onOpenShare: (agentId: string) => void;
  onOpenAgents: () => void;
}) {
  if (card.kind === "proposal") {
    const { draft } = card;
    const uses = draftUses(draft);
    const made = card.agentId !== null && agents.some((agent) => agent.id === card.agentId) ? card.agentId : null;
    return (
      <CardShell
        icon={Repeat}
        title={draft.name}
        testId="chat-card-proposal"
        dataState={card.state}
        state={card.state === "draft" ? "Draft" : card.state === "on" ? "On" : "Not created"}
        footer={card.state === "draft" ? (
          <>
            <AppButton onClick={() => onCard(true)} testId="chat-card-accept">Create and turn on</AppButton>
            <AppButton variant="quiet" onClick={() => onCard(false)} testId="chat-card-decline">Not now</AppButton>
          </>
        ) : card.state === "on" ? (
          <>
            <span className="min-w-0 flex-1 text-[13px] text-[#60646c]">{`${nextRunLine(draft.schedule)}.`}</span>
            {made ? <AppButton variant="secondary" onClick={() => onOpenThread(made)} testId="chat-card-thread">Open its thread</AppButton> : null}
          </>
        ) : undefined}
      >
        <div className="space-y-1 text-[14px] leading-5 text-[#60646c]">
          <p className="text-[#1c2024]">{scheduleLine(draft.schedule)}</p>
          <p>Runs in OpenWork Cloud, also when this computer is off. Messages you in Slack.</p>
          <p className="whitespace-pre-wrap pt-1">{draft.instructions}</p>
        </div>
        <div className="flex flex-col gap-2 border-t border-[#f3f4f6] pt-3">
          {uses.length === 0 ? <p className="text-[14px] leading-5 text-[#60646c]">It uses no apps yet. You can add them after you create it.</p> : null}
          {uses.map(({ connector, tools }) => (
            <div key={connector.id} className="flex items-center gap-2.5 text-[14px] leading-5" data-testid={`chat-card-uses-${connector.id}`} data-level={presetOf(connector, tools)} data-tools={tools.join(",")}>
              <ConnectorLogo name={connector.name} url={connector.url} size="xs" />
              <span className="font-medium text-[#1c2024]">{connector.name}</span>
              <span className="shrink-0 text-[#1c2024]">{accessWord(connector, tools)}</span>
              <span className="min-w-0 flex-1 truncate text-[#8b8d98]">{toolsLine(connector, tools)}</span>
            </div>
          ))}
          <p className="text-[14px] leading-5 text-[#60646c]">{`Can spend up to ${formatWorkbotCost(draft.budgetMicro)} a month, from your own limit.`}</p>
        </div>
        <CardDetails>
          <p>Model: Auto.</p>
          <p>Stays quiet when there is nothing to tell you.</p>
          <p>Saved as <code className="font-mono text-[12px] text-[#1c2024]">{`agents/${agentSlug(draft.name)}.md`}</code>.</p>
          {draft.capped.map((name) => <p key={name}>{`Your admin blocks some ${name} tools for every agent. Those are left out.`}</p>)}
          {uses.map(({ connector, tools }) => <ToolList key={connector.id} label={`${connector.name} tools`} tools={tools} />)}
        </CardDetails>
      </CardShell>
    );
  }

  if (card.kind === "permission") {
    const agent = agents.find((entry) => entry.id === card.agentId) ?? null;
    const connector = connectorById(card.connector);
    const name = agent?.name ?? "This agent";
    const before = (agent?.tools[card.connector] ?? []).filter((tool) => !card.tools.includes(tool));
    const one = card.tools.length === 1 ? card.tools[0] ?? "" : null;
    const stopped = access.blocked[card.connector];
    return (
      <CardShell
        icon={ShieldCheck}
        title={one !== null ? `Let ${name} use “${toolLabel(one)}” in ${connector.name}` : `Let ${name} use ${card.tools.length} more ${connector.name} tools`}
        testId="chat-card-permission"
        dataState={card.state}
        state={card.state === "ask" ? "Needs your OK" : card.state === "allowed" ? "Allowed" : "Not allowed"}
        footer={card.state === "ask" ? (
          <>
            <AppButton onClick={() => onCard(true)} testId="chat-card-accept">{one !== null ? "Allow this tool" : `Allow ${card.tools.length} tools`}</AppButton>
            <AppButton variant="quiet" onClick={() => onCard(false)} testId="chat-card-decline">Not now</AppButton>
          </>
        ) : card.state === "allowed" ? (
          <span className="text-[13px] text-[#60646c]">It applies from the next run.</span>
        ) : undefined}
      >
        <div className="flex flex-col gap-2">
          <CardRow label="Today">{before.length === 0 ? `Off. It does not use ${connector.name}.` : `${accessWord(connector, before)}. ${toolsLine(connector, before)}`}</CardRow>
          <CardRow label="Adds">
            <span className="flex flex-col gap-0.5" data-testid="chat-card-tools" data-tools={card.tools.join(",")}>
              {card.tools.map((tool) => (
                <span key={tool} className="flex items-baseline gap-2">
                  <span>{toolLabel(tool)}</span>
                  <span className="text-[12px] text-[#8b8d98]">{isWriteTool(connector, tool) ? "Writes" : "Reads"}</span>
                </span>
              ))}
            </span>
          </CardRow>
          <CardRow label="Stays blocked">{`Everything else in ${connector.name} it doesn't have today.`}</CardRow>
          {card.addInstructions ? <CardRow label="Also adds">{`To its instructions: “${card.addInstructions}”`}</CardRow> : null}
        </div>
        <CardDetails>
          <ToolList label="Tools it gains" tools={card.tools} />
          {stopped.length > 0 ? <ToolList label="Blocked by your admin" tools={stopped} /> : null}
          <ToolList label="Never allowed" tools={connector.neverTools} />
        </CardDetails>
      </CardShell>
    );
  }

  if (card.kind === "share") {
    const agent = agents.find((entry) => entry.id === card.agentId) ?? null;
    const owner = agent?.owner ?? "dana";
    const count = sharedPeople(card.share, owner).length;
    const who = card.share.orgWide ? "Everyone in the organization" : shareTargets(card.share, owner);
    // Giving someone the manager role is its own card: it changes who can change the agent, not who has it.
    const promoted = card.promote.length > 0;
    const role = card.promote.length === 1 && PEOPLE.some((person) => person.id === card.promote[0]) ? "a manager" : "managers";
    const done = promoted ? "Role changed" : "Shared";
    const kept = promoted ? "Role not changed" : "Not shared";
    return (
      <CardShell
        icon={Users}
        title={promoted ? `Make ${listWords(namesOf(card.promote))} ${role}` : `Share ${agent?.name ?? "this agent"}`}
        testId="chat-card-share"
        dataState={card.state}
        state={card.state === "ask" ? "Needs your OK" : card.state === "shared" ? done : kept}
        footer={card.state === "ask" ? (
          <>
            <AppButton onClick={() => onCard(true)} testId="chat-card-accept">
              {promoted ? `Make ${listWords(namesOf(card.promote, true))} ${role}` : `Share with ${peopleLabel(count)}`}
            </AppButton>
            <AppButton variant="quiet" onClick={() => onCard(false)} testId="chat-card-decline">Not now</AppButton>
          </>
        ) : card.state === "shared" ? (
          <>
            <span className="min-w-0 flex-1 text-[13px] text-[#60646c]">
              {promoted ? "They change it from their own thread with it, or its settings." : "Its routines are off for them until they turn them on."}
            </span>
            {agent && isMine(agent) ? <AppButton variant="secondary" onClick={() => onOpenShare(card.agentId)} testId="chat-card-sharing">Who has access</AppButton> : null}
          </>
        ) : undefined}
      >
        <div className="flex flex-col gap-2">
          {promoted ? <CardRow label="Agent">{agent?.name ?? "This agent"}</CardRow> : null}
          <CardRow label={promoted ? "Shared with" : "With"}>{`${who} (${peopleLabel(count)})`}</CardRow>
          <CardRow label="What it means">
            <span className="flex flex-col gap-1">
              {(promoted ? managerLines(agent) : shareLines(agent, card.managers)).map((line) => <span key={line}>{line}</span>)}
            </span>
          </CardRow>
        </div>
      </CardShell>
    );
  }

  if (card.kind === "run") {
    const exists = agents.some((agent) => agent.id === card.agentId);
    return (
      <CardShell
        icon={Play}
        title={`${card.agentName} ran`}
        testId="chat-card-run"
        dataState={card.run.outcome}
        state={card.run.when}
        footer={(
          <>
            <span className="min-w-0 flex-1 text-[13px] text-[#60646c]">{card.run.costMicro > 0 ? `This run cost ${formatWorkbotCost(card.run.costMicro)}.` : "This run cost nothing."}</span>
            {exists ? <AppButton variant="secondary" onClick={() => onOpenThread(card.agentId)} testId="chat-card-thread">Open its thread</AppButton> : null}
          </>
        )}
      >
        <RunSteps steps={card.run.steps} />
        <RunMessage run={card.run} />
      </CardShell>
    );
  }

  return (
    <CardShell
      icon={CircleDollarSign}
      title="Agent spend this month"
      testId="chat-card-spend"
      dataState="shown"
      state={formatWorkbotCost(card.totalMicro + card.orgMicro)}
      footer={(
        <>
          <span className="min-w-0 flex-1 text-[13px] text-[#60646c]" data-testid="chat-card-paid">
            {card.orgMicro > 0
              ? `${formatWorkbotCost(card.totalMicro)} from your own limit, ${formatWorkbotCost(card.orgMicro)} from the org's agent budget.`
              : "All of it counts toward your own limit."}
          </span>
          <AppButton variant="secondary" onClick={onOpenAgents} testId="chat-card-agents">Open Agents</AppButton>
        </>
      )}
    >
      <ul className="flex flex-col divide-y divide-[#f3f4f6]">
        {card.rows.map((row) => (
          <li key={row.id} className="flex items-center gap-3 py-2 text-[14px] leading-5" data-paid-by={row.paidBy}>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium text-[#1c2024]">{row.name}</span>
              <span className="truncate text-[12px] leading-4 text-[#8b8d98]">{row.note}</span>
            </span>
            {row.over ? <span className="shrink-0 rounded-full bg-[#fff1e0] px-2 text-[12px] leading-5 text-[#9a4a00]">Over budget</span> : null}
            <span className="shrink-0 font-mono text-[13px] tabular-nums text-[#1c2024]">
              {row.budgetMicro === null ? formatWorkbotCost(row.spentMicro) : `${formatWorkbotCost(row.spentMicro)} of ${formatWorkbotCost(row.budgetMicro)}`}
            </span>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}

function RunMessage({ run }: { run: AgentRun }) {
  if (run.outcome === "sent") return <SlackMessage when={run.when} text={run.summary} />;
  if (run.outcome === "quiet") return <p className="text-[14px] leading-5 text-[#60646c]">{`Nothing to tell you, so no message. ${run.summary}`}</p>;
  return <p className="text-[14px] leading-5 text-[#9a4a00]">{run.summary}</p>;
}

// ---------------------------------------------------------------------------
// One agent's thread: every run lands here, and what you reply is remembered.
// ---------------------------------------------------------------------------

function AgentThread({ agent, access, running, pending, settingsOpen, onRun, onNote, onAnswerNote, onQuestion, onTurnOn, onShare, onSettings }: {
  agent: Agent;
  access: Access;
  running: boolean;
  pending: string | null;
  settingsOpen: boolean;
  onRun: () => void;
  onNote: (text: string) => void;
  onAnswerNote: (noteId: string, keep: boolean) => void;
  onQuestion: (question: string) => void;
  onTurnOn: () => void;
  onShare: () => void;
  onSettings: () => void;
}) {
  const [text, setText] = useState("");
  const mine = isMine(agent);
  const steers = canChange(agent);
  const role = roleOf(agent) ?? "collaborator";
  const owner = firstNameOf(agent.owner);
  const items = agentThread(agent);
  const sharedWith = sharedPeople(agent.share, agent.owner).length;
  const shared = isShared(agent.share, agent.owner);
  // Its routines never run for a teammate until that teammate turns the agent on.
  const offForMe = !mine && !agent.on && agent.routines.length > 0;
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTo({ top: node.scrollHeight });
  }, [items.length, running]);

  // Whoever can change it steers it: a question is answered, anything else is remembered. Once it is shared,
  // remembering changes it for other people, so it asks first. Everyone else can only ask.
  const send = () => {
    const message = text.trim();
    setText("");
    if (/\brun\b|\bcheck now\b/i.test(message)) onRun();
    else if (!steers || message.endsWith("?")) onQuestion(message);
    else onNote(message);
  };

  const state = mine
    ? !agent.on ? "Paused" : overBudget(agent, access) ? "Over budget" : routinesLine(agent)
    : `Shared by ${personName(agent.owner)} · ${ROLE_LABEL[role]} · ${agent.on || agent.routines.length === 0 ? routinesLine(agent) : "Off for you"}`;
  const pays = agent.paidBy === "org" ? "the org's agent budget pays" : "it counts toward your own limit";
  const asksFirst = "A question is answered only for you. Anything else it can remember for everyone who uses it, and it asks you first.";
  const note = !steers
    ? `Only you see its answers. Only ${owner} and the managers ${owner} picks can change what it does.`
    : !shared
      ? "A question is answered here. Anything else is remembered for every run after."
      : mine ? asksFirst : `You are a manager. ${asksFirst}`;

  return (
    <>
      <PaneHeader title={agent.name} sub={state}>
        <AppButton variant="secondary" icon={Play} disabled={running} onClick={onRun} testId="thread-run-now">Run now</AppButton>
        {mine && (access.sharing || shared) ? (
          <AppButton variant="quiet" icon={UserPlus} onClick={onShare} testId="thread-share">{shared ? (agent.share.orgWide ? "Shared with everyone" : `Shared with ${sharedWith}`) : "Share"}</AppButton>
        ) : null}
        <AppButton variant={settingsOpen ? "secondary" : "quiet"} icon={SlidersHorizontal} pressed={settingsOpen} onClick={onSettings} testId="thread-settings">Settings</AppButton>
      </PaneHeader>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto" data-testid="agent-thread" data-agent={agent.id} data-role={role}>
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 py-6">
          <div className="flex flex-col gap-1.5 border-b border-[#f3f4f6] pb-5">
            <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-[12px] font-medium text-[#8b8d98]">
              What it does
              <code className="font-mono font-normal" data-testid="thread-file">{agentFilePath(agent)}</code>
            </p>
            <p className="whitespace-pre-line text-[14px] leading-6 text-[#1c2024]" data-testid="thread-instructions">{agent.instructions || "Not set up yet."}</p>
            <p className="text-[13px] leading-5 text-[#60646c]" data-testid="thread-terms">
              {mine
                ? `${budgetLine(agent, access)} spent this month, and ${pays}. Every run lands in this thread.`
                : `Your own thread with it. ${owner} never sees it. It uses your own accounts, and ${pays}.`}
            </p>
          </div>

          {offForMe ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e0e1e6] px-4 py-3" data-testid="thread-off">
              <p className="min-w-0 flex-1 text-[14px] leading-5 text-[#60646c]">Its routines are off for you. You can still ask it things here.</p>
              <AppButton variant="secondary" onClick={onTurnOn} testId="thread-turn-on">Run its routines for me</AppButton>
            </div>
          ) : null}

          {!offForMe && items.length === 0 && !running ? (
            <p className="text-[14px] leading-6 text-[#60646c]" data-testid="thread-empty">
              {`No runs yet. ${agent.on || agent.routines.length === 0 ? nextRunText(agent) : "It is paused, so it works only when asked"}.`}
            </p>
          ) : null}

          {items.map((item) => item.kind === "run" ? (
            <ThreadRun key={item.key} run={item.run} privately={!mine} />
          ) : (
            <div key={item.key} className="flex flex-col gap-3" data-testid="thread-note" data-state={item.note.state}>
              <UserBubble>{item.note.text}</UserBubble>
              {item.note.forEveryone ? (
                <NoteCard agent={agent} note={item.note} onAnswer={(keep) => onAnswerNote(item.note.id, keep)} onSettings={settingsOpen ? null : onSettings} />
              ) : (
                <p className="text-[14px] leading-6 text-[#1c2024]">Got it. I will keep that in mind on every run.</p>
              )}
            </div>
          ))}
          {running && pending ? <UserBubble>{pending}</UserBubble> : null}
          {running ? <Working label={pending ? "Looking" : "Running"} /> : null}
        </div>
      </div>
      <div className="shrink-0 px-5 pb-4 pt-2">
        <Composer
          value={text}
          onChange={setText}
          onSubmit={send}
          placeholder={steers ? `Ask ${agent.name}, or tell it something to remember...` : `Ask ${agent.name}...`}
          disabled={running}
          note={note}
        />
      </div>
    </>
  );
}

// A shared agent never changes for other people on a typed message alone. It says what would change, and waits.
function NoteCard({ agent, note, onAnswer, onSettings }: { agent: Agent; note: AgentNote; onAnswer: (keep: boolean) => void; onSettings: (() => void) | null }) {
  const owner = firstNameOf(agent.owner);
  // Whoever else can change it sees the note in its settings, with who added it.
  const others = !isMine(agent)
    ? `${owner} and the other managers see that you added it, and can forget it.`
    : agent.managers.length > 0
      ? "Your managers see that you added it, and can forget it."
      : "Only you can forget it, in its settings.";
  const reply = note.state === "ask"
    ? `${agent.name} is shared, so remembering this changes it for everyone who uses it.`
    : note.state === "kept"
      ? "Got it. I will keep that in mind on every run, for everyone."
      : "Okay, I won't remember that. Nothing changed.";
  return (
    <>
      <p className="text-[14px] leading-6 text-[#1c2024]" data-testid="thread-note-reply">{reply}</p>
      <CardShell
        icon={Bookmark}
        title={note.state === "ask" ? "Remember this for everyone?" : "Remember this for everyone"}
        testId="thread-note-card"
        dataState={note.state}
        state={note.state === "ask" ? "Needs your OK" : note.state === "kept" ? "Remembered" : "Not remembered"}
        footer={note.state === "ask" ? (
          <>
            <AppButton onClick={() => onAnswer(true)} testId="thread-note-accept">Remember for everyone</AppButton>
            <AppButton variant="quiet" onClick={() => onAnswer(false)} testId="thread-note-decline">Not now</AppButton>
          </>
        ) : note.state === "kept" ? (
          <>
            <span className="min-w-0 flex-1 text-[13px] text-[#60646c]">To forget it, open its settings, under What it remembers.</span>
            {onSettings ? <AppButton variant="secondary" onClick={onSettings} testId="thread-note-settings">Settings</AppButton> : null}
          </>
        ) : undefined}
      >
        <div className="flex flex-col gap-2">
          <CardRow label="Remember">{`“${note.text}”`}</CardRow>
          {note.state === "dropped" ? null : <CardRow label="Changes it for">{usedByLine(agent)}</CardRow>}
          {note.state === "ask" ? (
            <CardRow label="What it means">
              <span className="flex flex-col gap-1">
                <span>It keeps this in mind on every run, for everyone who uses it.</span>
                <span>{others}</span>
              </span>
            </CardRow>
          ) : null}
        </div>
      </CardShell>
    </>
  );
}

function ThreadRun({ run, privately }: { run: AgentRun; privately: boolean }) {
  const at = run.today ? `at ${run.when}` : run.when;
  return (
    <div className="flex flex-col gap-3" data-testid="thread-run" data-outcome={run.outcome} data-asked={run.asked ? "true" : "false"} data-routine={run.routine ?? ""}>
      {run.asked ? <UserBubble>{run.asked}</UserBubble> : null}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] leading-4 text-[#8b8d98]">
        {run.asked ? <Lock className="size-3.5" aria-hidden /> : <Repeat className="size-3.5" aria-hidden />}
        {run.asked ? `Answered ${at}${privately ? ", only to you" : ""}` : `Ran ${at}`}
        {run.routine ? <span className="text-[#60646c]" data-testid="thread-run-routine">{run.routine}</span> : null}
        {run.costMicro > 0 ? <span className="font-mono tabular-nums">{formatWorkbotCost(run.costMicro)}</span> : null}
      </p>
      <RunSteps steps={run.steps} />
      {run.outcome === "sent" ? (
        <p className="text-[14px] leading-6 text-[#1c2024]">{run.summary}</p>
      ) : run.outcome === "quiet" ? (
        <p className="text-[14px] leading-6 text-[#60646c]">{`Nothing to tell you, so it stayed quiet. ${run.summary}`}</p>
      ) : (
        <p className="text-[14px] leading-6 text-[#9a4a00]">{run.summary}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The Agents page inside the app
// ---------------------------------------------------------------------------

function AgentsPage({ agents, access, connected, unreadIds, atAgentLimit, removed, onUndoRemove, onNew, onBrowse, onOpenThread, onOpenSettings, onPatch }: {
  agents: Agent[];
  access: Access;
  connected: Record<ConnectorId, boolean>;
  unreadIds: string[];
  atAgentLimit: boolean;
  removed: Agent | null;
  onUndoRemove: () => void;
  onNew: () => void;
  onBrowse: () => void;
  onOpenThread: (agentId: string) => void;
  onOpenSettings: (agentId: string) => void;
  onPatch: (agentId: string, patch: Partial<Agent>) => void;
}) {
  const mine = agents.filter(isMine);
  const added = agents.filter((agent) => !isMine(agent) && inMyList(agent, access));
  // Shared with you, and not in your list yet.
  const toAdd = sharedWithMe(agents, access).filter((agent) => !agent.added).length;
  const card = (agent: Agent) => (
    <AgentCard
      key={agent.id}
      agent={agent}
      access={access}
      connected={connected}
      unread={unreadIds.includes(agent.id)}
      onOpenThread={() => onOpenThread(agent.id)}
      onToggle={(on) => onPatch(agent.id, { on })}
      onOpenSettings={() => onOpenSettings(agent.id)}
    />
  );
  return (
    <>
      <PaneHeader title="Agents" sub={`${mine.length} of ${access.maxAgents}`}>
        <AppButton variant="secondary" icon={Users} onClick={onBrowse} testId="desktop-browse">Browse shared agents</AppButton>
        <AppButton icon={Plus} onClick={onNew} testId="desktop-new-agent">New agent</AppButton>
      </PaneHeader>
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="desktop-agents">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-5 py-6">
          <p className="max-w-[640px] text-[14px] leading-6 text-[#60646c]">
            Agents work in OpenWork Cloud, also when this computer is off. Give one routines to run on its own, or just ask it. Each one uses only the tools you allow and messages you in Slack.
          </p>
          {atAgentLimit ? <p className="-mt-3 text-[13px] leading-5 text-[#60646c]">{`Your admin allows ${access.maxAgents} agents.`}</p> : null}
          {removed ? (
            <p className="-mt-2 flex items-center gap-2 text-[13px] leading-5 text-[#60646c]" role="status" data-testid="agents-removed">
              {`Removed ${removed.name}.`}
              <button type="button" onClick={onUndoRemove} className="rounded font-medium text-[#1c2024] underline-offset-2 hover:underline" data-testid="agents-undo">Undo</button>
            </p>
          ) : null}

          {mine.length === 0 ? (
            <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-[#e0e1e6] p-5" data-testid="desktop-agents-empty">
              <p className="text-[14px] font-medium text-[#1c2024]">You have no agents yet</p>
              <p className="max-w-[520px] text-[14px] leading-6 text-[#60646c]">Name one, then tell it its job in its own thread. Nothing runs until you turn it on.</p>
              <AppButton icon={Plus} onClick={onNew} testId="desktop-first-agent">New agent</AppButton>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">{mine.map(card)}</div>
          )}

          {added.length > 0 || toAdd > 0 ? (
            <section className="flex flex-col gap-3" data-testid="desktop-agents-shared">
              <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <h2 className="text-[13px] font-medium text-[#1c2024]">Shared with you</h2>
                  <p className="text-[13px] leading-5 text-[#60646c]">
                    {added.length > 0
                      ? "Ask one a question, or turn on its routines for yourself. It uses your own accounts."
                      : "Add one to ask it things, or to run its routines for yourself."}
                  </p>
                </div>
                {toAdd > 0 ? <AppButton variant="quiet" onClick={onBrowse} testId="desktop-browse-more">{`${toAdd} more to add`}</AppButton> : null}
              </div>
              {added.length > 0 ? <div className="grid gap-3 md:grid-cols-2">{added.map(card)}</div> : null}
            </section>
          ) : null}

          {agents.some(usedByMe) ? <MonthSpend agents={agents} access={access} /> : null}
        </div>
      </div>
    </>
  );
}

function AgentCard({ agent, access, connected, unread, onOpenThread, onToggle, onOpenSettings }: {
  agent: Agent;
  access: Access;
  connected: Record<ConnectorId, boolean>;
  unread: boolean;
  onOpenThread: () => void;
  onToggle: (on: boolean) => void;
  onOpenSettings: () => void;
}) {
  const mine = isMine(agent);
  const draft = agent.setup !== null;
  const role = roleOf(agent) ?? "collaborator";
  const uses = CONNECTORS.filter((connector) => agent.tools[connector.id].length > 0);
  const shared = mine ? sharedPeople(agent.share, agent.owner).length : 0;
  const sub = draft
    ? "Only you can see it"
    : mine
      ? `${routinesLine(agent)}${agent.share.orgWide ? " · Shared with everyone" : shared > 0 ? ` · Shared with ${peopleLabel(shared)}` : ""}`
      : `From ${personName(agent.owner)} · ${ROLE_LABEL[role]} · ${routinesLine(agent)}`;
  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-[#e0e1e6] bg-[#fcfcfd] p-4" data-testid={`desktop-agent-${agent.id}`} data-on={agent.on ? "true" : "false"} data-draft={draft ? "true" : "false"}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="flex min-w-0 items-center gap-2 text-[14px] font-medium leading-5 text-[#1c2024]">
            <span className="truncate">{agent.name}</span>
            {unread ? <span className="h-2 w-2 shrink-0 rounded-full bg-[#2FBE54]"><span className="sr-only">New run</span></span> : null}
          </h3>
          <p className="truncate text-[12px] leading-4 text-[#8b8d98]">{sub}</p>
        </div>
        {draft ? (
          <span className="shrink-0 rounded-full border border-[#e0e1e6] px-2 text-[12px] leading-5 text-[#60646c]">Draft</span>
        ) : (
          <AppSwitch
            checked={agent.on}
            onChange={onToggle}
            label={mine ? agent.name : `Run ${agent.name}'s routines for you`}
            testId={`desktop-agent-on-${agent.id}`}
          />
        )}
      </div>
      <p className="line-clamp-2 min-h-10 text-[13px] leading-5 text-[#60646c]">{mine ? agentStateLine(agent, access) : sharedStateLine(agent, access).replace(`From ${personName(agent.owner)}. `, "")}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {uses.length === 0 ? <span className="text-[12px] text-[#8b8d98]">Uses no apps yet</span> : null}
        {uses.map((connector) => {
          const allowed = effectiveTools(agent, access, connected, connector.id);
          return (
            <span key={connector.id} className="inline-flex items-center gap-1.5 text-[12px] text-[#60646c]" data-testid={`desktop-agent-uses-${connector.id}`} data-level={presetOf(connector, allowed)} title={allowed.length > 0 ? listWords(allowed.map((tool) => lowerFirst(toolLabel(tool)))) : undefined}>
              <ConnectorLogo name={connector.name} url={connector.url} size="xs" />
              {!connected[connector.id] ? "Not connected" : allowed.length === 0 ? "Blocked by your admin" : accessWord(connector, allowed)}
            </span>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-[#f3f4f6] pt-3">
        <span className="min-w-0 truncate text-[12px] text-[#8b8d98]">
          {usedByMe(agent) ? <span className="font-mono tabular-nums">{budgetLine(agent, access)}</span> : "Not used by you yet"}
          {agent.paidBy === "org" ? " · Org pays" : ""}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <AppButton variant="quiet" onClick={onOpenSettings} testId={`desktop-agent-settings-${agent.id}`}>Settings</AppButton>
          <AppButton variant="secondary" onClick={onOpenThread} testId={`desktop-agent-thread-${agent.id}`}>{draft ? "Finish setup" : mine ? "Open thread" : "Ask it"}</AppButton>
        </span>
      </div>
    </article>
  );
}

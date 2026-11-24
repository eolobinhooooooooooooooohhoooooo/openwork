"use client";

import { ChevronDown, ChevronRight, CornerDownRight, Lock, MessageSquare, Play, ShieldCheck, Square, UserPlus, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { peopleLabel } from "../../(den)/dashboard/_components/access-summary";
import { ConnectorLogo } from "../../(den)/dashboard/_components/item-logo";
import { formatWorkbotCost } from "../../(den)/dashboard/_features/workbot-usage/workbot-usage-data";
import { AppButton, AppSwitch, CardRow, CardShell, Composer, UserBubble } from "./app-parts";
import {
  type Access,
  type Agent,
  type AgentColor,
  type AgentNote,
  type AgentRun,
  type AgentSession,
  type RunAsk,
  type RunStep,
  AGENT_COLORS,
  ASK_EXPIRES_MS,
  MY_COMPUTERS,
  ROLE_LABEL,
  agentFilePath,
  agentThread,
  budgetLine,
  canChange,
  connectorById,
  effectiveBudget,
  firstNameOf,
  isMine,
  isShared,
  keptNotes,
  lowerFirst,
  nextRunText,
  overBudget,
  personName,
  roleOf,
  routineWhen,
  routinesLine,
  sharedPeople,
  toolLabel,
  usedByLine,
} from "./model";

// ---------------------------------------------------------------------------
// One agent, one conversation. Every routine reports back here, background work
// shows inline while it runs, and each run is a thread you can reply in.
// ---------------------------------------------------------------------------

export function colorOf(color: AgentColor): string {
  return AGENT_COLORS.find((entry) => entry.id === color)?.fill ?? "#60646c";
}

export function AgentAvatar({ agent, size = 20 }: { agent: Pick<Agent, "name" | "color">; size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, backgroundColor: colorOf(agent.color), fontSize: Math.round(size * 0.45) }}
      aria-hidden
    >
      {agent.name.trim().charAt(0).toUpperCase() || "A"}
    </span>
  );
}

function clockAt(ms: number): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(ms));
}

export function sessionStateLabel(session: AgentSession, access: Access): string {
  if (session.state === "needs_you") return "Waiting for you";
  if (session.state === "waiting") return `Waiting · starts when one of ${access.atOnce} finishes`;
  const step = session.run.steps[Math.min(session.shown, session.run.steps.length - 1)];
  return step && session.shown < session.run.steps.length ? `Working · ${step.label}` : "Working · Writing it up";
}

// ---------------------------------------------------------------------------
// Header: the agent's name opens its details beside the conversation.
// ---------------------------------------------------------------------------

export function ConversationHeader({ agent, access, panelOpen, sub, onPanel, onShare }: {
  agent: Agent;
  access: Access;
  panelOpen: boolean;
  sub?: string;
  onPanel: () => void;
  onShare: () => void;
}) {
  const mine = isMine(agent);
  const shared = isShared(agent.share, agent.owner);
  const count = sharedPeople(agent.share, agent.owner).length;
  return (
    <header className="grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-[#f3f4f6] px-3">
      <span className="min-w-0 truncate text-[12px] text-[#8b8d98]" data-testid="conversation-sub">{sub}</span>
      <button
        type="button"
        onClick={onPanel}
        aria-pressed={panelOpen}
        aria-label={`${agent.name} details`}
        data-testid="conversation-name"
        className={`flex h-8 min-w-0 max-w-[260px] items-center gap-2 rounded-full pl-1.5 pr-2.5 text-[13px] font-medium text-[#1c2024] transition-colors hover:bg-[#f0f0f3] ${panelOpen ? "bg-[#f0f0f3]" : ""}`}
      >
        <AgentAvatar agent={agent} size={22} />
        <span className="truncate">{agent.name}</span>
        <ChevronDown className="size-3.5 shrink-0 text-[#8b8d98]" aria-hidden />
      </button>
      <span className="flex justify-end">
        {mine && !agent.setup && (access.sharing || shared) ? (
          <AppButton variant="secondary" icon={UserPlus} onClick={onShare} testId="thread-share">
            {shared ? (agent.share.orgWide ? "Shared with everyone" : `Shared with ${count}`) : "Share"}
          </AppButton>
        ) : null}
      </span>
    </header>
  );
}

// ---------------------------------------------------------------------------
// The conversation
// ---------------------------------------------------------------------------

export type ConversationProps = {
  agent: Agent;
  access: Access;
  sessions: AgentSession[];
  nowMs: number;
  header: ReactNode;
  onSend: (text: string) => void;
  onStop: (sessionId: string) => void;
  onAnswerAsk: (sessionId: string, answer: RunAsk["state"]) => void;
  onAnswerNote: (noteId: string, keep: boolean) => void;
  onForget: (noteId: string) => void;
  onOpenThread: (id: string) => void;
  onTurnOn: () => void;
  onRun: () => void;
};

export function AgentConversation({ agent, access, sessions, nowMs, header, onSend, onStop, onAnswerAsk, onAnswerNote, onForget, onOpenThread, onTurnOn, onRun }: ConversationProps) {
  const [text, setText] = useState("");
  const mine = isMine(agent);
  const steers = canChange(agent);
  const items = agentThread(agent);
  const asking = sessions.find((session) => session.kind === "ask") ?? null;
  const background = sessions.filter((session) => session.kind !== "ask");
  const offForMe = !mine && !agent.on && agent.routines.length > 0;
  const scroller = useRef<HTMLDivElement>(null);
  const progress = sessions.map((session) => `${session.id}:${session.shown}:${session.state}:${session.heard.length}`).join("|");

  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTo({ top: node.scrollHeight });
  }, [items.length, progress]);

  const send = (message: string) => {
    const clean = message.trim();
    if (!clean) return;
    setText("");
    onSend(clean);
  };

  const owner = firstNameOf(agent.owner);
  const note = asking
    ? "It reads your message before it goes on."
    : !steers
      ? `Only you see its answers. Only ${owner} and the managers ${owner} picks can change it.`
      : isShared(agent.share, agent.owner)
        ? "Ask it anything. Anything you tell it to keep, it checks with you first, because it changes it for everyone."
        : undefined;

  return (
    <>
      {header}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto" data-testid="agent-thread" data-agent={agent.id} data-role={roleOf(agent) ?? "collaborator"}>
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-5 py-6">
          <AgentIntro agent={agent} access={access} />

          {offForMe ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e0e1e6] px-4 py-3" data-testid="thread-off">
              <p className="min-w-0 flex-1 text-[14px] leading-5 text-[#60646c]">Its routines are off for you. You can still ask it things here.</p>
              <AppButton variant="secondary" onClick={onTurnOn} testId="thread-turn-on">Run its routines for me</AppButton>
            </div>
          ) : null}

          {items.map((item) => {
            if (item.kind === "run") {
              return <RunMessage key={item.key} agent={agent} run={item.run} privately={!mine} replies={agent.replies.filter((reply) => reply.runId === item.run.id).length} onThread={() => onOpenThread(item.run.id)} />;
            }
            if (item.kind === "memory") {
              return <MemoryAnswer key={item.key} agent={agent} onForget={onForget} />;
            }
            return <NoteExchange key={item.key} agent={agent} note={item.note} onAnswer={(keep) => onAnswerNote(item.note.id, keep)} />;
          })}

          {background.map((session) => (
            session.state === "needs_you" && session.ask ? (
              <AskCard key={session.id} agent={agent} session={session} nowMs={nowMs} onAnswer={(answer) => onAnswerAsk(session.id, answer)} onThread={() => onOpenThread(session.id)} />
            ) : (
              <SessionLine key={session.id} agent={agent} session={session} access={access} onOpen={() => onOpenThread(session.id)} onStop={() => onStop(session.id)} />
            )
          ))}

          {asking ? (
            <div className="flex flex-col gap-3" data-testid="conversation-asking">
              {asking.asked ? <UserBubble>{asking.asked}</UserBubble> : null}
              {asking.state === "needs_you" && asking.ask ? (
                <AskCard agent={agent} session={asking} nowMs={nowMs} onAnswer={(answer) => onAnswerAsk(asking.id, answer)} onThread={null} />
              ) : (
                <WorkingLine agent={agent} label={sessionStateLabel(asking, access).replace("Working · ", "")} />
              )}
              {asking.heard.map((heard) => (
                <div key={heard} className="flex flex-col items-end gap-1">
                  <UserBubble>{heard}</UserBubble>
                  <span className="pr-2 text-[12px] text-[#8b8d98]">Read before it goes on</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="shrink-0 px-5 pb-4 pt-2">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-2">
          {asking ? null : (
            <div className="flex flex-wrap gap-2" data-testid="conversation-suggestions">
              <Suggestion onClick={() => send("What do you remember?")} testId="suggest-memory">What do you remember?</Suggestion>
              {agent.on || mine ? <Suggestion onClick={onRun} testId="suggest-run" icon={<Play className="size-3" aria-hidden />}>Run now</Suggestion> : null}
            </div>
          )}
          <Composer
            value={text}
            onChange={setText}
            onSubmit={() => send(text)}
            placeholder={`Message ${agent.name}`}
            working={asking !== null}
            onStop={asking ? () => onStop(asking.id) : undefined}
            note={note}
          />
        </div>
      </div>
    </>
  );
}

function Suggestion({ children, onClick, testId, icon }: { children: string; onClick: () => void; testId: string; icon?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[#e0e1e6] bg-[#fcfcfd] px-3 text-[12px] text-[#60646c] transition-colors hover:bg-[#f0f0f3] hover:text-[#1c2024]"
    >
      {icon}
      {children}
    </button>
  );
}

// The agent introduces itself: its job, where it lives as a file, and who pays.
function AgentIntro({ agent, access }: { agent: Agent; access: Access }) {
  const mine = isMine(agent);
  const pays = agent.paidBy === "org" ? "The org's agent budget pays" : mine ? "It counts toward your own limit" : "Your use counts toward your own limit";
  return (
    <div className="flex flex-col gap-2 border-b border-[#f3f4f6] pb-5" data-testid="thread-intro">
      <div className="flex items-center gap-2.5">
        <AgentAvatar agent={agent} size={28} />
        <span className="flex min-w-0 flex-col">
          <span className="text-[14px] font-medium leading-5 text-[#1c2024]">{agent.name}</span>
          <code className="truncate font-mono text-[12px] leading-4 text-[#8b8d98]" data-testid="thread-file">{agentFilePath(agent)}</code>
        </span>
      </div>
      <p className="whitespace-pre-line text-[14px] leading-6 text-[#1c2024]" data-testid="thread-instructions">{agent.instructions || "Not set up yet."}</p>
      <p className="text-[12px] leading-4 text-[#8b8d98]" data-testid="thread-terms">
        {mine
          ? `${routinesLine(agent)} · ${budgetLine(agent, access)} this month · ${pays}`
          : `Your own conversation with it. ${firstNameOf(agent.owner)} never sees it. It uses your accounts · ${pays}`}
      </p>
    </div>
  );
}

function WorkingLine({ agent, label }: { agent: Agent; label: string }) {
  return (
    <p className="flex items-center gap-2 text-[14px] leading-5 text-[#8b8d98]" role="status" data-testid="working-line">
      <span className="animate-pulse motion-reduce:animate-none"><AgentAvatar agent={agent} size={18} /></span>
      {label}
    </p>
  );
}

function StepLogo({ connector }: { connector: RunStep["connector"] }) {
  if (connector === "workbot") return <ConnectorLogo name="Slack" url="https://slack.com" size="xs" />;
  const entry = connectorById(connector);
  return <ConnectorLogo name={entry.name} url={entry.url} size="xs" />;
}

export function RunSteps({ steps }: { steps: RunStep[] }) {
  if (steps.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {steps.map((step) => (
        <li key={step.key} className="flex items-center gap-2.5 text-[13px] leading-5 text-[#60646c]" data-blocked={step.blocked ? "true" : "false"}>
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

// Steps fold into one line once a run is done.
function StepsFold({ steps }: { steps: RunStep[] }) {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-fit items-center gap-1 text-[12px] text-[#8b8d98] transition-colors hover:text-[#1c2024]"
        data-testid="run-steps-toggle"
      >
        <ChevronRight className={`size-3.5 transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-90" : ""}`} aria-hidden />
        {`${steps.length} ${steps.length === 1 ? "step" : "steps"}`}
      </button>
      {open ? <RunSteps steps={steps} /> : null}
    </div>
  );
}

function askEnding(wanted: RunAsk): string {
  const action = lowerFirst(wanted.action);
  if (wanted.state === "expired") return `It wanted to ${action}. Nobody answered within 30 minutes, so it didn't.`;
  if (wanted.state === "denied") return `It wanted to ${action}. You said no, so it didn't.`;
  if (wanted.state === "always") return `You let it ${action}, from now on.`;
  return `You let it ${action}, this once.`;
}

// One result in the conversation. A routine's result can be talked about in its own thread.
export function RunMessage({ agent, run, privately, replies, onThread, inThread = false }: {
  agent: Agent;
  run: AgentRun;
  privately: boolean;
  replies: number;
  onThread: (() => void) | null;
  inThread?: boolean;
}) {
  const at = run.when;
  const source = run.asked ? `Answered at ${at}${privately ? ", only to you" : ""}` : run.routine ? `${run.routine} · ${at}` : `Run now · ${at}`;
  const tone = run.outcome === "failed" || run.outcome === "over_budget" ? "text-[#9a4a00]" : run.outcome === "quiet" ? "text-[#60646c]" : "text-[#1c2024]";
  return (
    <div className="flex flex-col gap-3" data-testid="thread-run" data-outcome={run.outcome} data-asked={run.asked ? "true" : "false"} data-routine={run.routine ?? ""}>
      {run.asked && !inThread ? <UserBubble>{run.asked}</UserBubble> : null}
      {run.heard && !inThread ? <UserBubble>{run.heard}</UserBubble> : null}
      <div className="flex gap-2.5">
        <span className="pt-0.5"><AgentAvatar agent={agent} size={20} /></span>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="flex flex-wrap items-center gap-x-2 text-[12px] leading-5 text-[#8b8d98]">
            <span className="font-medium text-[#60646c]" data-testid="thread-run-routine">{source}</span>
            {run.costMicro > 0 ? <span className="font-mono tabular-nums">{formatWorkbotCost(run.costMicro)}</span> : null}
          </p>
          {inThread ? <RunSteps steps={run.steps} /> : <StepsFold steps={run.steps} />}
          <p className={`text-[14px] leading-6 ${tone}`} data-testid="thread-run-summary">
            {run.outcome === "quiet" && !run.stopped ? `Nothing to tell you. ${run.summary}` : run.summary}
          </p>
          {run.wanted ? (
            <p className="flex items-start gap-1.5 text-[13px] leading-5 text-[#60646c]" data-testid="thread-run-ask" data-state={run.wanted.state}>
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {askEnding(run.wanted)}
            </p>
          ) : null}
          {onThread ? (
            <button
              type="button"
              onClick={onThread}
              data-testid="thread-reply"
              className="flex w-fit items-center gap-1.5 rounded-md text-[12px] font-medium text-[#60646c] transition-colors hover:text-[#1c2024]"
            >
              {replies > 0 ? <MessageSquare className="size-3.5" aria-hidden /> : <CornerDownRight className="size-3.5" aria-hidden />}
              {replies > 0 ? `${replies} ${replies === 1 ? "reply" : "replies"}` : "Reply in thread"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// Background work, inline, until it reports back.
function SessionLine({ agent, session, access, onOpen, onStop }: { agent: Agent; session: AgentSession; access: Access; onOpen: () => void; onStop: () => void }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-[#e0e1e6] px-3 py-2" data-testid="session-line" data-state={session.state}>
      <span className={session.state === "working" ? "animate-pulse motion-reduce:animate-none" : "opacity-50"}><AgentAvatar agent={agent} size={18} /></span>
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 flex-col text-left">
        <span className="truncate text-[13px] font-medium leading-5 text-[#1c2024]">{session.label}</span>
        <span className="truncate text-[12px] leading-4 text-[#8b8d98]">{sessionStateLabel(session, access)}</span>
      </button>
      <AppButton variant="quiet" icon={Square} onClick={onStop} testId="session-stop">{session.state === "waiting" ? "Cancel" : "Stop"}</AppButton>
    </div>
  );
}

// It wants a tool it isn't allowed. Asked from the background, the question expires after 30 minutes.
export function AskCard({ agent, session, nowMs, onAnswer, onThread }: {
  agent: Agent;
  session: AgentSession;
  nowMs: number;
  onAnswer: (answer: RunAsk["state"]) => void;
  onThread: (() => void) | null;
}) {
  const ask = session.ask;
  if (!ask) return null;
  const connector = connectorById(ask.connector);
  const left = Math.max(0, Math.ceil((ask.raisedMs + ASK_EXPIRES_MS - nowMs) / 60000));
  return (
    <CardShell
      icon={ShieldCheck}
      title={`${agent.name} wants to ${lowerFirst(ask.action)}`}
      testId="ask-card"
      dataState="ask"
      state="Needs your OK"
      footer={(
        <>
          <AppButton onClick={() => onAnswer("allowed")} testId="ask-allow-once">Allow once</AppButton>
          <AppButton variant="secondary" onClick={() => onAnswer("always")} testId="ask-always">Always allow</AppButton>
          <AppButton variant="quiet" onClick={() => onAnswer("denied")} testId="ask-deny">Deny</AppButton>
          {onThread ? <span className="ml-auto"><AppButton variant="quiet" onClick={onThread} testId="ask-thread">Open thread</AppButton></span> : null}
        </>
      )}
    >
      <div className="flex flex-col gap-2">
        <CardRow label="For">{session.kind === "ask" ? "Your message" : session.label}</CardRow>
        <CardRow label="Does">
          <span className="inline-flex items-center gap-2">
            <ConnectorLogo name={connector.name} url={connector.url} size="xs" />
            {`Writes in ${connector.name}, as you. It isn't allowed this today.`}
          </span>
        </CardRow>
        <CardRow label="Always allow">{`Adds “${toolLabel(ask.tool)}” to what it can use. You can block it again in its settings.`}</CardRow>
        {ask.background ? (
          <CardRow label="No answer">{`Expires at ${clockAt(ask.raisedMs + ASK_EXPIRES_MS)}${left > 0 ? `, in ${left} min` : ""}. Then it skips this and nothing is written.`}</CardRow>
        ) : null}
      </div>
    </CardShell>
  );
}

// "What do you remember?" is answered in the conversation. There is no memory screen.
function MemoryAnswer({ agent, onForget }: { agent: Agent; onForget: (noteId: string) => void }) {
  const kept = keptNotes(agent);
  const steers = canChange(agent);
  const shared = isShared(agent.share, agent.owner);
  return (
    <div className="flex flex-col gap-3" data-testid="memory-answer">
      <UserBubble>What do you remember?</UserBubble>
      <div className="flex gap-2.5">
        <span className="pt-0.5"><AgentAvatar agent={agent} size={20} /></span>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-[14px] leading-6 text-[#1c2024]">
            {kept.length === 0
              ? "Nothing beyond my job yet. Tell me something here and I'll keep it in mind on every run."
              : `Besides my job, I keep ${kept.length === 1 ? "this" : `these ${kept.length} things`} in mind on every run${shared ? ", for everyone who uses me" : ""}:`}
          </p>
          {kept.length > 0 ? (
            <ul className="flex flex-col divide-y divide-[#f3f4f6] rounded-xl border border-[#e0e1e6]">
              {kept.map((note) => (
                <li key={note.id} className="flex min-h-10 items-center gap-3 px-3 py-1.5" data-testid="memory-item">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[13px] leading-5 text-[#1c2024]">{note.text}</span>
                    {shared ? <span className="text-[12px] leading-4 text-[#8b8d98]">{note.by === agent.owner && isMine(agent) ? "You told me" : `${personName(note.by)} told me`}</span> : null}
                  </span>
                  {steers ? <AppButton variant="quiet" onClick={() => onForget(note.id)} testId="memory-forget">Forget</AppButton> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// Something you told it to keep. A shared agent asks first, on the same card.
function NoteExchange({ agent, note, onAnswer }: { agent: Agent; note: AgentNote; onAnswer: (keep: boolean) => void }) {
  return (
    <div className="flex flex-col gap-3" data-testid="thread-note" data-state={note.state}>
      <UserBubble>{note.text}</UserBubble>
      <div className="flex gap-2.5">
        <span className="pt-0.5"><AgentAvatar agent={agent} size={20} /></span>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {note.forEveryone ? (
            <NoteCard agent={agent} note={note} onAnswer={onAnswer} />
          ) : (
            <p className="text-[14px] leading-6 text-[#1c2024]">Got it. I'll keep that in mind on every run.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function NoteCard({ agent, note, onAnswer }: { agent: Agent; note: AgentNote; onAnswer: (keep: boolean) => void }) {
  const owner = firstNameOf(agent.owner);
  const others = !isMine(agent)
    ? `${owner} and the other managers see that you added it, and can ask me to forget it.`
    : agent.managers.length > 0 ? "Your managers see that you added it, and can ask me to forget it." : "Ask me to forget it any time.";
  return (
    <CardShell
      icon={ShieldCheck}
      title={note.state === "ask" ? "Keep this for everyone?" : note.state === "kept" ? "Kept for everyone" : "Not kept"}
      testId="thread-note-card"
      dataState={note.state}
      state={note.state === "ask" ? "Needs your OK" : note.state === "kept" ? "Remembered" : "Nothing changed"}
      footer={note.state === "ask" ? (
        <>
          <AppButton onClick={() => onAnswer(true)} testId="thread-note-accept">Keep for everyone</AppButton>
          <AppButton variant="quiet" onClick={() => onAnswer(false)} testId="thread-note-decline">Not now</AppButton>
        </>
      ) : undefined}
    >
      <div className="flex flex-col gap-2">
        <CardRow label="Keep">{`“${note.text}”`}</CardRow>
        {note.state === "dropped" ? null : <CardRow label="Changes it for">{usedByLine(agent)}</CardRow>}
        {note.state === "ask" ? <CardRow label="Who sees it">{others}</CardRow> : null}
      </div>
    </CardShell>
  );
}

// ---------------------------------------------------------------------------
// Beside the conversation: a thread about one run, or the agent's details.
// ---------------------------------------------------------------------------

export function SidePanel({ label, title, onClose, children, footer, testId, wide = false }: {
  label: string;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  testId: string;
  wide?: boolean;
}) {
  return (
    <aside
      className={`flex min-h-0 w-full min-w-0 flex-col lg:shrink-0 lg:border-l lg:border-[#e0e1e6] ${wide ? "lg:w-[440px]" : "lg:w-[380px]"}`}
      aria-label={label}
      data-testid={testId}
    >
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-[#f3f4f6] pl-4 pr-2">
        <div className="flex min-w-0 items-center gap-2">{title}</div>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${label.toLowerCase()}`}
          data-testid="panel-close"
          className="grid size-8 shrink-0 place-items-center rounded-lg text-[#60646c] transition-colors hover:bg-[#f0f0f3] hover:text-[#1c2024]"
        >
          <X className="size-4" aria-hidden />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid={`${testId}-scroll`}>{children}</div>
      {footer ? <div className="shrink-0 px-4 pb-4 pt-2">{footer}</div> : null}
    </aside>
  );
}

// A thread keeps the follow-up about one run. It can't change the agent: that happens in the conversation.
export function ThreadPanel({ agent, access, run, session, nowMs, onReply, onMove, onStop, onAnswerAsk, onClose }: {
  agent: Agent;
  access: Access;
  run: AgentRun | null;
  session: AgentSession | null;
  nowMs: number;
  onReply: (text: string) => void;
  onMove: (replyId: string) => void;
  onStop: () => void;
  onAnswerAsk: (answer: RunAsk["state"]) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const runId = run?.id ?? session?.id ?? "";
  const replies = agent.replies.filter((reply) => reply.runId === runId);
  const label = run ? (run.routine ?? (run.asked ? "Your question" : "Run now")) : session?.label ?? "";
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = scroller.current?.parentElement;
    if (node) node.scrollTo({ top: node.scrollHeight });
  }, [replies.length, session?.shown]);
  return (
    <SidePanel
      label="Thread"
      testId="thread-panel"
      title={(
        <>
          <span className="text-[13px] font-medium text-[#1c2024]">Thread</span>
          <span className="truncate text-[12px] text-[#8b8d98]">{`${label}${run ? ` · ${run.when}` : ""}`}</span>
        </>
      )}
      onClose={onClose}
      footer={run ? (
        <Composer
          value={text}
          onChange={setText}
          onSubmit={() => { onReply(text.trim()); setText(""); }}
          placeholder="Reply about this result"
          note="Only the conversation changes what it remembers, its skills or its routines."
        />
      ) : undefined}
    >
      <div ref={scroller} className="flex flex-col gap-5 px-4 py-4">
        {run ? <RunMessage agent={agent} run={run} privately={!isMine(agent)} replies={0} onThread={null} inThread /> : null}
        {session ? (
          <div className="flex flex-col gap-3" data-testid="thread-live" data-state={session.state}>
            <p className="text-[12px] leading-4 text-[#8b8d98]">{`A fresh session · started ${session.run.when}`}</p>
            <RunSteps steps={session.run.steps.slice(0, session.shown)} />
            {session.state === "needs_you" && session.ask ? (
              <AskCard agent={agent} session={session} nowMs={nowMs} onAnswer={onAnswerAsk} onThread={null} />
            ) : (
              <WorkingLine agent={agent} label={sessionStateLabel(session, access)} />
            )}
            {session.state !== "needs_you" ? <AppButton variant="secondary" icon={Square} onClick={onStop} testId="thread-stop">{session.state === "waiting" ? "Cancel" : "Stop now"}</AppButton> : null}
          </div>
        ) : null}
        {replies.map((reply) => reply.from === "agent" ? (
          <div key={reply.id} className="flex gap-2.5" data-testid="thread-reply-agent">
            <span className="pt-0.5"><AgentAvatar agent={agent} size={20} /></span>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p className="text-[14px] leading-6 text-[#1c2024]">{reply.text}</p>
              {reply.move ? (
                reply.move.done ? (
                  <span className="text-[12px] text-[#8b8d98]" data-testid="thread-moved">Said in the conversation.</span>
                ) : (
                  <span><AppButton variant="secondary" onClick={() => onMove(reply.id)} testId="thread-move">Say it in the conversation</AppButton></span>
                )
              ) : null}
            </div>
          </div>
        ) : (
          <UserBubble key={reply.id}>{reply.text}</UserBubble>
        ))}
      </div>
    </SidePanel>
  );
}

// ---------------------------------------------------------------------------
// Details: what it's doing now, its routines, what it costs. Settings sit in the next tab.
// ---------------------------------------------------------------------------

export type DetailsTab = "activity" | "settings";

export function DetailsPanel({ agent, access, sessions, tab, onTab, onClose, onToggle, onRoutine, onRun, onOpenThread, settings }: {
  agent: Agent;
  access: Access;
  sessions: AgentSession[];
  tab: DetailsTab;
  onTab: (tab: DetailsTab) => void;
  onClose: () => void;
  onToggle: (on: boolean) => void;
  onRoutine: (routineId: string, on: boolean) => void;
  onRun: () => void;
  onOpenThread: (id: string) => void;
  settings: ReactNode;
}) {
  return (
    <SidePanel
      label="Details"
      testId="settings-panel"
      wide={tab === "settings"}
      onClose={onClose}
      title={(
        <div className="flex items-center gap-1 rounded-full bg-[#f0f0f3] p-0.5" role="tablist" aria-label={`${agent.name} details`}>
          {(["activity", "settings"] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              role="tab"
              aria-selected={tab === entry}
              onClick={() => onTab(entry)}
              data-testid={`details-tab-${entry}`}
              className={`h-7 rounded-full px-3 text-[12px] font-medium transition-colors ${tab === entry ? "bg-white text-[#1c2024] shadow-[0_1px_2px_rgba(15,23,42,0.08)]" : "text-[#60646c] hover:text-[#1c2024]"}`}
            >
              {entry === "activity" ? "Activity" : "Settings"}
            </button>
          ))}
        </div>
      )}
    >
      {tab === "activity" ? (
        <Activity agent={agent} access={access} sessions={sessions} onToggle={onToggle} onRoutine={onRoutine} onRun={onRun} onOpenThread={onOpenThread} />
      ) : (
        <div className="px-4 py-4" data-testid="settings-scroll">{settings}</div>
      )}
    </SidePanel>
  );
}

function PanelSection({ title, meta, children, testId }: { title: string; meta?: string; children: ReactNode; testId: string }) {
  return (
    <section className="flex flex-col gap-1 border-t border-[#f3f4f6] px-4 py-3 first:border-t-0" data-testid={testId}>
      <div className="flex min-h-6 items-center justify-between gap-3">
        <h3 className="text-[12px] font-medium text-[#8b8d98]">{title}</h3>
        {meta ? <span className="text-[12px] text-[#8b8d98]">{meta}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Activity({ agent, access, sessions, onToggle, onRoutine, onRun, onOpenThread }: {
  agent: Agent;
  access: Access;
  sessions: AgentSession[];
  onToggle: (on: boolean) => void;
  onRoutine: (routineId: string, on: boolean) => void;
  onRun: () => void;
  onOpenThread: (id: string) => void;
}) {
  const mine = isMine(agent);
  const steers = canChange(agent);
  const role = roleOf(agent) ?? "collaborator";
  const busy = sessions.filter((session) => session.state !== "waiting" && session.kind !== "ask").length;
  const budget = effectiveBudget(agent, access);
  const today = agent.runs.filter((run) => run.today && !run.asked);
  const over = overBudget(agent, access);
  const status = !agent.on ? (mine ? "Paused" : "Off for you") : over ? "Over budget" : "On";
  const where = [agent.runsOn.cloud ? "OpenWork Cloud" : null, ...MY_COMPUTERS.filter((computer) => agent.runsOn.computers.includes(computer.id)).map((computer) => computer.name)].filter(Boolean);
  return (
    <div className="flex flex-col pb-4" data-testid="details-activity">
      <PanelSection title={mine ? "Status" : `Shared by ${personName(agent.owner)} · ${ROLE_LABEL[role]}`} testId="details-status">
        <div className="flex min-h-10 items-center justify-between gap-3">
          <span className="flex min-w-0 flex-col">
            <span className="text-[14px] font-medium leading-5 text-[#1c2024]" data-testid="details-status-title">{status}</span>
            <span className="text-[12px] leading-4 text-[#8b8d98]">{agent.on ? `${nextRunText(agent)}.` : mine ? "Runs nothing until you turn it on." : "You can still ask it things."}</span>
          </span>
          <AppSwitch checked={agent.on} onChange={onToggle} label={mine ? agent.name : `Run ${agent.name}'s routines for me`} testId="agent-on" />
        </div>
      </PanelSection>

      <PanelSection title="Working now" meta={`${busy} of ${access.atOnce} at once`} testId="details-sessions">
        {sessions.length === 0 ? <p className="py-1.5 text-[13px] leading-5 text-[#60646c]">Nothing running.</p> : null}
        {sessions.map((session) => (
          <button
            key={session.id}
            type="button"
            onClick={() => onOpenThread(session.id)}
            className="flex min-h-10 items-center gap-2.5 rounded-lg px-1 text-left transition-colors hover:bg-[#f9f9fb]"
            data-testid="details-session"
            data-state={session.state}
          >
            <span className={`size-2 shrink-0 rounded-full ${session.state === "needs_you" ? "bg-[#E8933A]" : session.state === "working" ? "animate-pulse bg-[#0090ff] motion-reduce:animate-none" : "bg-[#d9d9e0]"}`} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px] leading-5 text-[#1c2024]">{session.label}</span>
              <span className="truncate text-[12px] leading-4 text-[#8b8d98]">{sessionStateLabel(session, access)}</span>
            </span>
          </button>
        ))}
        <span className="pt-1"><AppButton variant="secondary" icon={Play} onClick={onRun} testId="thread-run-now">Run now</AppButton></span>
      </PanelSection>

      <PanelSection title="Routines" meta={agent.routines.length > 0 ? String(agent.routines.length) : undefined} testId="details-routines">
        {agent.routines.length === 0 ? <p className="py-1.5 text-[13px] leading-5 text-[#60646c]">None. Ask in the conversation to set one up.</p> : null}
        {agent.routines.map((routine) => (
          <div key={routine.id} className="flex min-h-10 items-center justify-between gap-3" data-testid={`details-routine-${routine.id}`} data-on={routine.on ? "true" : "false"}>
            <span className="flex min-w-0 flex-col">
              <span className={`truncate text-[13px] leading-5 ${routine.on ? "text-[#1c2024]" : "text-[#8b8d98]"}`}>{routine.name}</span>
              <span className="truncate text-[12px] leading-4 text-[#8b8d98]">{routine.on ? routineWhen(routine) : steers ? "Paused" : `Paused by ${firstNameOf(agent.owner)}`}</span>
            </span>
            {steers ? <AppSwitch checked={routine.on} onChange={(on) => onRoutine(routine.id, on)} label={routine.name} testId={`details-routine-on-${routine.id}`} /> : null}
          </div>
        ))}
        {!mine && agent.routines.length > 0 ? <p className="text-[12px] leading-4 text-[#8b8d98]">They run for you only while it's on for you, with your own accounts.</p> : null}
      </PanelSection>

      <PanelSection title="This month" meta={agent.paidBy === "org" ? "Org pays" : "You pay"} testId="details-budget">
        <p className="text-[13px] leading-5 text-[#1c2024]">
          <span className="font-mono tabular-nums">{budgetLine(agent, access)}</span>
          {budget !== null ? <span className="text-[#8b8d98]">{isShared(agent.share, agent.owner) ? " · per person" : ""}</span> : null}
        </p>
        {budget !== null ? (
          <span className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#f0f0f3]" aria-hidden>
            <span className={`block h-full rounded-full ${over ? "bg-[#E8933A]" : "bg-[#1c2024]"}`} style={{ width: `${Math.min(100, Math.round((agent.spentMicro / Math.max(1, budget)) * 100))}%` }} />
          </span>
        ) : null}
      </PanelSection>

      <PanelSection title="Where it works" testId="details-where">
        <p className="text-[13px] leading-5 text-[#1c2024]">{where.length > 0 ? where.join(", ") : "Nowhere yet"}</p>
        {access.cloudOnly ? <p className="inline-flex items-center gap-1 text-[12px] leading-4 text-[#8b8d98]"><Lock className="size-3" aria-hidden />Your admin allows OpenWork Cloud only</p> : null}
      </PanelSection>

      <PanelSection title="Done today" meta={today.length > 0 ? String(today.length) : undefined} testId="details-done">
        {today.length === 0 ? <p className="py-1.5 text-[13px] leading-5 text-[#60646c]">No runs today.</p> : null}
        {today.slice(0, 4).map((run) => (
          <button key={run.id} type="button" onClick={() => onOpenThread(run.id)} className="flex min-h-9 items-center gap-2.5 rounded-lg px-1 text-left transition-colors hover:bg-[#f9f9fb]" data-testid="details-done-run">
            <span className="size-2 shrink-0 rounded-full bg-[#d9d9e0]" />
            <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-[#1c2024]">{run.routine ?? "Run now"}</span>
            <span className="shrink-0 text-[12px] text-[#8b8d98]">{run.when}</span>
          </button>
        ))}
      </PanelSection>

      {!mine ? (
        <p className="px-4 pt-1 text-[12px] leading-4 text-[#8b8d98]">{`Used by ${peopleLabel(sharedPeople(agent.share, agent.owner).length + 1)}. Each person has their own conversation.`}</p>
      ) : null}
    </div>
  );
}

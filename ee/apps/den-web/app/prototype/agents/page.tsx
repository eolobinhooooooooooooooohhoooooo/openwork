"use client";

import { useRef, useState } from "react";
import { DenSegmented } from "../../(den)/_components/ui/segmented";
import type { AccessDraft } from "../../(den)/dashboard/_components/access-summary";
import { ADMIN, AdminDashboard, type AdminTab } from "./den";
import { DesktopApp, type DesktopView } from "./desktop";
import {
  type Access,
  type Agent,
  type ChatCard,
  type ChatTurn,
  type ConnectorId,
  type Scenario,
  type SetupStepId,
  DEFAULT_ACCESS,
  DEFAULT_CONNECTED,
  ME,
  MEMBER,
  agentFromDraft,
  answerSetup,
  applyRun,
  askAgent,
  clockNow,
  connectorById,
  copyAgent,
  draftAgent,
  giveJob,
  inMyList,
  interpretChat,
  isMine,
  keepManagers,
  noTools,
  noteAsksFirst,
  sampleAgents,
  simulateRun,
  toolsForLevel,
} from "./model";

// Prototype only: every screen here runs on sample data held in memory.

// Two people, two places. A member does everything about their agents in the
// OpenWork app. An admin sets the rules for everyone in the Cloud dashboard.
type Viewer = "member" | "admin";

const VIEWER_NOTE: Record<Viewer, string> = {
  member: `You are ${MEMBER.name}, a member. Everything about your agents is here, in the OpenWork app.`,
  admin: `You are ${ADMIN.name}, an admin. These rules apply to every member's agents.`,
};

// Everything read, except the newest run of one agent, so a fresh message shows in the sidebar.
function startingSeen(agents: Agent[]): Record<string, number> {
  const fresh = agents.find((agent) => agent.on && agent.runs.length > 0);
  return Object.fromEntries(agents.map((agent) => [agent.id, agent.runs.length - (agent.id === fresh?.id ? 1 : 0)]));
}

function pendingProposalName(turns: ChatTurn[]): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const card = turns[index]?.card;
    if (card?.kind === "proposal" && card.state === "draft") return card.draft.name;
  }
  return null;
}

export default function AgentsPrototypePage() {
  const [viewer, setViewer] = useState<Viewer>("member");
  const [adminTab, setAdminTab] = useState<AdminTab>("rules");
  const [scenario, setScenario] = useState<Scenario>("sample");
  const [agents, setAgents] = useState<Agent[]>(sampleAgents);
  const [access, setAccess] = useState<Access>(DEFAULT_ACCESS);
  const [connected, setConnected] = useState<Record<ConnectorId, boolean>>(DEFAULT_CONNECTED);
  const [removed, setRemoved] = useState<Agent | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [contextId, setContextId] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ agentId: string; question: string } | null>(null);
  const [seenRuns, setSeenRuns] = useState<Record<string, number>>(() => startingSeen(sampleAgents()));
  const [desktopView, setDesktopView] = useState<DesktopView>({ kind: "chat" });
  const counter = useRef(0);

  const nextId = (prefix: string) => {
    counter.current += 1;
    return `${prefix}-${counter.current}`;
  };

  const readingId = viewer === "member" && desktopView.kind === "agent" ? desktopView.agentId : null;
  const unreadIds = agents
    .filter((agent) => inMyList(agent, access) && agent.id !== readingId && agent.runs.length > (seenRuns[agent.id] ?? 0))
    .map((agent) => agent.id);

  // Leaving a thread marks what was in it as read.
  const markThreadRead = () => {
    const agent = agents.find((entry) => entry.id === readingId);
    if (agent) setSeenRuns((current) => ({ ...current, [agent.id]: agent.runs.length }));
  };

  const changeDesktopView = (next: DesktopView) => {
    markThreadRead();
    setDesktopView(next);
  };

  const changeViewer = (next: Viewer) => {
    markThreadRead();
    setViewer(next);
  };

  const patchAgent = (id: string, patch: Partial<Agent>) => {
    setAgents((current) => current.map((agent) => (agent.id === id ? { ...agent, ...patch } : agent)));
  };

  // "Run now" runs the agent once on its instructions. Testing a routine runs that routine.
  const runAgent = (id: string, routineId?: string) => {
    const runId = nextId("run");
    const when = clockNow();
    setRunningId(id);
    window.setTimeout(() => {
      setAgents((current) => current.map((agent) => {
        if (agent.id !== id) return agent;
        const routine = agent.routines.find((entry) => entry.id === routineId);
        return applyRun(agent, simulateRun(agent, access, connected, when, runId, routine));
      }));
      setRunningId(null);
    }, 700);
  };

  // A question is answered in the asker's own thread, with the asker's own accounts.
  const askQuestion = (id: string, question: string) => {
    const runId = nextId("run");
    const when = clockNow();
    setRunningId(id);
    setAsking({ agentId: id, question });
    window.setTimeout(() => {
      setAgents((current) => current.map((agent) => (agent.id === id ? applyRun(agent, askAgent(agent, access, connected, question, when, runId)) : agent)));
      setRunningId(null);
      setAsking(null);
    }, 900);
  };

  const removeAgent = (agent: Agent) => {
    setAgents((current) => current.filter((entry) => entry.id !== agent.id));
    setRemoved(agent);
    if (desktopView.kind === "agent" && desktopView.agentId === agent.id) setDesktopView({ kind: "agents" });
  };

  const undoRemove = () => {
    if (!removed) return;
    setAgents((current) => [...current, removed]);
    setRemoved(null);
  };

  // A copy is yours to change, so it opens with its settings showing.
  const makeCopy = (agent: Agent) => {
    if (agents.filter(isMine).length >= access.maxAgents) return;
    const id = nextId("agent");
    setAgents((current) => [...current, copyAgent(agent, id, access)]);
    markThreadRead();
    setDesktopView({ kind: "agent", agentId: id, settings: true });
  };

  // A new agent is a named draft. It opens in its own thread, where the first message is its job.
  const createAgent = (name: string) => {
    if (agents.filter(isMine).length >= access.maxAgents) return;
    const id = nextId("agent");
    setAgents((current) => [...current, draftAgent(id, name, access)]);
    markThreadRead();
    setDesktopView({ kind: "agent", agentId: id, settings: false });
  };

  // Saying the job again starts the setup cards over, so they match what was said last.
  const giveJobTo = (agentId: string, text: string) => {
    setAgents((current) => current.map((agent) => (agent.id === agentId && agent.setup
      ? giveJob({ ...agent, tools: noTools(), routines: [], setup: { ...agent.setup, answered: {} } }, text, access)
      : agent)));
  };

  const answerSetupFor = (agentId: string, step: SetupStepId, answer: "done" | "skipped", patch?: Partial<Agent>) => {
    setAgents((current) => current.map((agent) => (agent.id === agentId ? answerSetup(agent, step, answer, patch) : agent)));
  };

  // A manager is always someone the agent is shared with.
  const shareAgent = (id: string, share: AccessDraft, managers: string[]) => patchAgent(id, { share, managers: keepManagers(managers, share) });

  // Your own agent keeps what you tell it at once. A shared agent asks first, because it changes for everyone who uses it.
  const addNote = (agentId: string, text: string) => {
    const noteId = nextId("note");
    setAgents((current) => current.map((agent) => {
      if (agent.id !== agentId) return agent;
      const forEveryone = noteAsksFirst(agent);
      return { ...agent, notes: [...agent.notes, { id: noteId, text, afterRuns: agent.runs.length, by: ME, forEveryone, state: forEveryone ? "ask" : "kept" }] };
    }));
  };

  const answerNote = (agentId: string, noteId: string, keep: boolean) => {
    setAgents((current) => current.map((agent) => (agent.id === agentId
      ? { ...agent, notes: agent.notes.map((note) => (note.id === noteId && note.state === "ask" ? { ...note, state: keep ? "kept" : "dropped" } : note)) }
      : agent)));
  };

  const removeNote = (agentId: string, noteId: string) => {
    setAgents((current) => current.map((agent) => (agent.id === agentId ? { ...agent, notes: agent.notes.filter((note) => note.id !== noteId) } : agent)));
  };

  const askChat = (prompt: string) => {
    const result = interpretChat({ prompt, agents, access, connected, id: nextId("chat"), when: clockNow(), contextId, pendingName: pendingProposalName(turns) });
    const turnId = nextId("turn");
    setAgents(result.agents);
    setContextId(result.agentId);
    setTurns((current) => [...current, { id: turnId, prompt, reply: result.reply, card: result.card, steps: result.steps.map((step, index) => ({ ...step, key: `${turnId}-${index}` })) }]);
  };

  // Anything that gives an agent more reach waits here for a click.
  const resolveCard = (turnId: string, accept: boolean) => {
    const card = turns.find((turn) => turn.id === turnId)?.card;
    if (!card) return;
    const setCard = (next: ChatCard) => setTurns((current) => current.map((turn) => (turn.id === turnId ? { ...turn, card: next } : turn)));
    if (card.kind === "proposal" && card.state === "draft") {
      if (!accept) {
        setCard({ ...card, state: "dismissed" });
        return;
      }
      const id = nextId("agent");
      setAgents((current) => [...current, agentFromDraft(card.draft, id, access)]);
      setContextId(id);
      setCard({ ...card, state: "on", agentId: id });
      return;
    }
    if (card.kind === "permission" && card.state === "ask") {
      if (accept) {
        const every = toolsForLevel(connectorById(card.connector), "write");
        setAgents((current) => current.map((agent) => (agent.id === card.agentId
          ? {
            ...agent,
            tools: { ...agent.tools, [card.connector]: every.filter((tool) => agent.tools[card.connector].includes(tool) || card.tools.includes(tool)) },
            instructions: card.addInstructions ? `${agent.instructions} ${card.addInstructions}` : agent.instructions,
          }
          : agent)));
      }
      setCard({ ...card, state: accept ? "allowed" : "kept" });
      return;
    }
    if (card.kind === "share" && card.state === "ask") {
      if (accept) shareAgent(card.agentId, card.share, card.managers);
      setCard({ ...card, state: accept ? "shared" : "kept" });
    }
  };

  const changeScenario = (next: Scenario) => {
    const fresh = next === "empty" ? [] : sampleAgents();
    setScenario(next);
    setAgents(fresh);
    setSeenRuns(startingSeen(fresh));
    setRemoved(null);
    setTurns([]);
    setContextId(null);
    setDesktopView({ kind: "chat" });
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <div
        className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-slate-800 bg-[#0f172a] px-4 py-2 text-[12px] text-slate-300"
        data-testid="prototype-bar"
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 font-medium text-white">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Prototype · Personal agents · sample data
          </span>
          <DenSegmented
            aria-label="Who is looking"
            value={viewer}
            onChange={changeViewer}
            options={[
              { value: "member", label: "Member · OpenWork app" },
              { value: "admin", label: "Admin · Cloud dashboard" },
            ]}
            optionTestId={(value) => `proto-role-${value}`}
          />
          <DenSegmented
            aria-label="Starting point"
            value={scenario}
            onChange={changeScenario}
            options={[
              { value: "sample", label: "With sample agents" },
              { value: "empty", label: "First visit" },
            ]}
            optionTestId={(value) => `proto-scenario-${value}`}
          />
        </div>
        <p className="text-slate-400" data-testid="proto-role-note">{VIEWER_NOTE[viewer]}</p>
      </div>

      {viewer === "admin" ? (
        <AdminDashboard tab={adminTab} onTab={setAdminTab} agents={agents} access={access} onAccess={setAccess} onPatchAgent={patchAgent} />
      ) : (
        <DesktopApp
          view={desktopView}
          onView={changeDesktopView}
          agents={agents}
          access={access}
          connected={connected}
          turns={turns}
          unreadIds={unreadIds}
          runningId={runningId}
          asking={asking}
          onAsk={askChat}
          onCard={resolveCard}
          onRun={runAgent}
          onNote={addNote}
          onAnswerNote={answerNote}
          onQuestion={askQuestion}
          onPatch={patchAgent}
          removed={removed}
          onRemove={removeAgent}
          onUndoRemove={undoRemove}
          onCopy={makeCopy}
          onShare={shareAgent}
          onRemoveNote={removeNote}
          onConnect={(id) => setConnected((current) => ({ ...current, [id]: true }))}
          onCreate={createAgent}
          onJob={giveJobTo}
          onSetup={answerSetupFor}
        />
      )}
    </div>
  );
}

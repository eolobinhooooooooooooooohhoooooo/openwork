"use client";

import { CircleDollarSign, Plug, Power, Repeat, SlidersHorizontal } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ConnectorLogo } from "../../(den)/dashboard/_components/item-logo";
import { formatWorkbotCost } from "../../(den)/dashboard/_features/workbot-usage/workbot-usage-data";
import { AppButton, CardDetails, CardRow, CardShell, Composer, PaneHeader, ToolList, accessWord } from "./app-parts";
import {
  type Access,
  type Agent,
  type AgentSetup,
  type ConnectorId,
  type SetupStepId,
  CONNECTORS,
  JOB_EXAMPLES,
  SETUP_STEPS,
  agentFilePath,
  effectiveBudget,
  listWords,
  lowerFirst,
  makeRoutine,
  routineName,
  scheduleLine,
  setupStep,
  toolsLine,
} from "./model";
import { Dialog } from "./parts";
import { BudgetRows, ScheduleEditor } from "./settings";

// ---------------------------------------------------------------------------
// Starting from +: name the agent, land in its thread as a draft, tell it its
// job, answer three cards, then turn it on. Nothing runs before that.
// ---------------------------------------------------------------------------

type StepState = "ask" | "done" | "skipped";
type Answer = (answer: "done" | "skipped", patch?: Partial<Agent>) => void;

export function NewAgentDialog({ taken, atLimit, maxAgents, onCreate, onClose }: {
  taken: string[];
  atLimit: boolean;
  maxAgents: number;
  onCreate: (name: string) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const trimmed = name.trim();
  const clash = taken.some((entry) => entry.toLowerCase() === trimmed.toLowerCase());
  const ready = trimmed.length > 0 && !clash && !atLimit;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (ready) onCreate(trimmed);
  };
  return (
    <Dialog
      title="New agent"
      description="Give it a name. You tell it what to do next, in its own thread."
      onClose={onClose}
      testId="new-agent-dialog"
      footer={(
        <>
          <AppButton variant="quiet" onClick={onClose} testId="new-agent-cancel">Cancel</AppButton>
          <AppButton disabled={!ready} onClick={() => onCreate(trimmed)} testId="new-agent-create">Create</AppButton>
        </>
      )}
    >
      <form onSubmit={submit} className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-[13px] font-medium text-[#1c2024]">Name</label>
        <input
          id={id}
          autoFocus
          value={name}
          maxLength={40}
          placeholder="PR review"
          disabled={atLimit}
          onChange={(event) => setName(event.target.value)}
          data-testid="new-agent-name"
          className="h-9 rounded-xl border border-[#e0e1e6] bg-white px-3 text-[14px] text-[#1c2024] outline-none transition-colors placeholder:text-[#8b8d98] focus:border-[#1c2024] disabled:opacity-60"
        />
        <p className="text-[12px] leading-4 text-[#8b8d98]" role="status" data-testid="new-agent-note">
          {atLimit
            ? `Your admin allows ${maxAgents} agents. Remove one to make another.`
            : clash ? "You already have an agent with that name." : "It starts as a draft only you can see."}
        </p>
      </form>
    </Dialog>
  );
}

export function DraftThread({ agent, setup, access, connected, settingsOpen, onJob, onSetup, onTurnOn, onSettings }: {
  agent: Agent;
  setup: AgentSetup;
  access: Access;
  connected: Record<ConnectorId, boolean>;
  settingsOpen: boolean;
  onJob: (text: string) => void;
  onSetup: (step: SetupStepId, answer: "done" | "skipped", patch?: Partial<Agent>) => void;
  onTurnOn: () => void;
  onSettings: () => void;
}) {
  const [text, setText] = useState("");
  const hasJob = agent.instructions.trim().length > 0;
  const current = setupStep(setup);
  const shown = SETUP_STEPS.filter((step) => setup.answered[step] !== undefined || step === current);
  const answered = Object.keys(setup.answered).length;
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTo({ top: node.scrollHeight });
  }, [answered, hasJob]);

  const send = (message: string) => {
    setText("");
    onJob(message.trim());
  };
  const stateOf = (step: SetupStepId): StepState => setup.answered[step] ?? "ask";

  return (
    <>
      <PaneHeader title={agent.name} sub="Draft · Only you can see it">
        <AppButton variant={settingsOpen ? "secondary" : "quiet"} icon={SlidersHorizontal} pressed={settingsOpen} onClick={onSettings} testId="thread-settings">Settings</AppButton>
      </PaneHeader>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto" data-testid="draft-thread" data-agent={agent.id} data-step={hasJob ? current ?? "turn-on" : "job"}>
        {hasJob ? (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 py-6">
            <div className="flex flex-col gap-1.5 border-b border-[#f3f4f6] pb-5">
              <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-[12px] font-medium text-[#8b8d98]">
                What it does
                <code className="font-mono font-normal" data-testid="thread-file">{agentFilePath(agent)}</code>
              </p>
              <p className="whitespace-pre-line text-[14px] leading-6 text-[#1c2024]" data-testid="thread-instructions">{agent.instructions}</p>
              <p className="text-[13px] leading-5 text-[#60646c]" data-testid="thread-terms">
                {current === null ? "Ready when you are. Nothing has run yet." : "Three short questions, then you turn it on. Nothing runs before that."}
              </p>
            </div>
            {shown.map((step) => step === "tools" ? (
              <ToolsCard key={`tools-${agent.instructions}`} agent={agent} setup={setup} connected={connected} state={stateOf(step)} onAnswer={(answer, patch) => onSetup(step, answer, patch)} />
            ) : step === "routine" ? (
              <RoutineCard key={`routine-${agent.instructions}`} agent={agent} setup={setup} state={stateOf(step)} onAnswer={(answer, patch) => onSetup(step, answer, patch)} />
            ) : (
              <PaysCard key={`pays-${agent.instructions}`} agent={agent} access={access} state={stateOf(step)} onAnswer={(answer, patch) => onSetup(step, answer, patch)} />
            ))}
            {current === null ? <TurnOnCard agent={agent} access={access} onTurnOn={onTurnOn} /> : null}
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-5 py-10" data-testid="draft-empty">
            <div className="flex flex-col gap-1.5">
              <h2 className="text-[20px] font-semibold leading-7 tracking-[-0.2px] text-[#1c2024]">{`What should ${agent.name} do?`}</h2>
              <p className="max-w-[560px] text-[14px] leading-6 text-[#60646c]">
                Say what it should look at and how often. It then asks which tools it may use, when it works and who pays, before anything runs.
              </p>
            </div>
            <div className="flex flex-col items-start gap-2">
              {JOB_EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => send(example)}
                  data-testid="draft-example"
                  className="rounded-2xl border border-[#e0e1e6] px-3.5 py-2 text-left text-[13px] leading-5 text-[#1c2024] transition-colors hover:bg-[#f0f0f3]"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="shrink-0 px-5 pb-4 pt-2">
        <Composer
          value={text}
          onChange={setText}
          onSubmit={() => send(text)}
          placeholder={hasJob ? `Tell ${agent.name} again to change what it does...` : `Tell ${agent.name} what to do...`}
          focus={!hasJob}
          note={hasJob ? "A new message replaces what it does and starts the questions again." : "Your first message is its job."}
        />
      </div>
    </>
  );
}

function CardLine({ children }: { children: string }) {
  return <p className="text-[14px] leading-5 text-[#60646c]" data-testid="setup-card-line">{children}</p>;
}

function ToolsCard({ agent, setup, connected, state, onAnswer }: {
  agent: Agent;
  setup: AgentSetup;
  connected: Record<ConnectorId, boolean>;
  state: StepState;
  onAnswer: Answer;
}) {
  const offered = CONNECTORS.filter((connector) => setup.tools[connector.id].length > 0);
  const used = CONNECTORS.filter((connector) => agent.tools[connector.id].length > 0);
  if (state !== "ask") {
    return (
      <CardShell icon={Plug} title="Which tools it can use" state={state === "done" ? "Allowed" : "Skipped"} testId="setup-card-tools" dataState={state}>
        <CardLine>
          {used.length > 0
            ? `${listWords(used.map((connector) => `${connector.name} ${lowerFirst(accessWord(connector, agent.tools[connector.id]))}`))}. Every other tool is blocked.`
            : "No tools yet. You can allow them in Settings."}
        </CardLine>
      </CardShell>
    );
  }
  return (
    <CardShell
      icon={Plug}
      title="Which tools it can use"
      state="1 of 3"
      testId="setup-card-tools"
      dataState="ask"
      footer={(
        <>
          {offered.length > 0 ? <AppButton onClick={() => onAnswer("done", { tools: setup.tools })} testId="setup-tools-allow">Allow these tools</AppButton> : null}
          <AppButton variant={offered.length > 0 ? "quiet" : "secondary"} onClick={() => onAnswer("skipped")} testId="setup-tools-skip">
            {offered.length > 0 ? "Skip" : "Continue without tools"}
          </AppButton>
        </>
      )}
    >
      <div className="flex flex-col gap-2">
        <CardLine>
          {offered.length > 0
            ? "Its job needs these. Every other tool stays blocked, and it uses your own connected accounts."
            : "Your message named no app, so it starts with no tools. You can allow them in Settings at any time."}
        </CardLine>
        {offered.map((connector) => (
          <div key={connector.id} className="flex items-center gap-2.5 text-[14px] leading-5" data-testid={`setup-tools-${connector.id}`} data-tools={setup.tools[connector.id].join(",")}>
            <ConnectorLogo name={connector.name} url={connector.url} size="xs" />
            <span className="font-medium text-[#1c2024]">{connector.name}</span>
            <span className="shrink-0 text-[#1c2024]">{accessWord(connector, setup.tools[connector.id])}</span>
            <span className="min-w-0 flex-1 truncate text-[#8b8d98]">
              {connected[connector.id] ? toolsLine(connector, setup.tools[connector.id]) : "Not connected yet. It skips this until you connect it."}
            </span>
          </div>
        ))}
        {setup.capped.map((name) => <CardLine key={name}>{`Your admin blocks some ${name} tools for every agent. Those are left out.`}</CardLine>)}
      </div>
      {offered.length > 0 ? (
        <CardDetails>
          {offered.map((connector) => <ToolList key={connector.id} label={`${connector.name} tools`} tools={setup.tools[connector.id]} />)}
        </CardDetails>
      ) : null}
    </CardShell>
  );
}

function RoutineCard({ agent, setup, state, onAnswer }: {
  agent: Agent;
  setup: AgentSetup;
  state: StepState;
  onAnswer: Answer;
}) {
  const [schedule, setSchedule] = useState(setup.schedule);
  const [editing, setEditing] = useState(false);
  if (state !== "ask") {
    const routine = agent.routines[0];
    return (
      <CardShell icon={Repeat} title="When it works" state={state === "done" ? "Added" : "Skipped"} testId="setup-card-routine" dataState={state}>
        <CardLine>{routine ? `${routine.name}. ${scheduleLine(routine.schedule)}.` : "Only when you ask it. You can add a routine in Settings."}</CardLine>
      </CardShell>
    );
  }
  const name = routineName(schedule);
  return (
    <CardShell
      icon={Repeat}
      title="When it works"
      state="2 of 3"
      testId="setup-card-routine"
      dataState="ask"
      footer={(
        <>
          <AppButton onClick={() => onAnswer("done", { routines: [makeRoutine(`${agent.id}-routine`, name, "", schedule)] })} testId="setup-routine-add">Add this routine</AppButton>
          <AppButton variant="secondary" pressed={editing} onClick={() => setEditing(!editing)} testId="setup-routine-change">Change</AppButton>
          <AppButton variant="quiet" onClick={() => onAnswer("skipped")} testId="setup-routine-skip">Skip</AppButton>
        </>
      )}
    >
      <div className="space-y-1 text-[14px] leading-5 text-[#60646c]">
        <p className="text-[#1c2024]" data-testid="setup-routine-when">{scheduleLine(schedule)}</p>
        <p>{`This becomes a routine called ${name}. It runs in OpenWork Cloud, also when this computer is off. You can add more routines later.`}</p>
        <p>Skip, and it works only when you ask it.</p>
      </div>
      {editing ? (
        <div className="border-t border-[#f3f4f6] pt-1" data-testid="setup-routine-editor">
          <ScheduleEditor schedule={schedule} onChange={setSchedule} />
        </div>
      ) : null}
    </CardShell>
  );
}

function budgetSentence(agent: Agent, access: Access): string {
  const budget = effectiveBudget(agent, access);
  const from = agent.paidBy === "org" ? "the org's agent budget" : "your own limit";
  return budget === null ? `No budget of its own. Paid from ${from}.` : `Up to ${formatWorkbotCost(budget)} a month, from ${from}.`;
}

function PaysCard({ agent, access, state, onAnswer }: {
  agent: Agent;
  access: Access;
  state: StepState;
  onAnswer: Answer;
}) {
  const [budgetMicro, setBudgetMicro] = useState(agent.budgetMicro);
  const [paidBy, setPaidBy] = useState(agent.paidBy);
  if (state !== "ask") {
    return (
      <CardShell icon={CircleDollarSign} title="Who pays, and how much" state={state === "done" ? "Set" : "Skipped"} testId="setup-card-pays" dataState={state}>
        <CardLine>{budgetSentence(agent, access)}</CardLine>
      </CardShell>
    );
  }
  return (
    <CardShell
      icon={CircleDollarSign}
      title="Who pays, and how much"
      state="3 of 3"
      testId="setup-card-pays"
      dataState="ask"
      footer={(
        <>
          <AppButton onClick={() => onAnswer("done", { budgetMicro, paidBy })} testId="setup-pays-keep">Keep this</AppButton>
          <AppButton variant="quiet" onClick={() => onAnswer("skipped")} testId="setup-pays-skip">Skip</AppButton>
        </>
      )}
    >
      <CardLine>It stops for the month when it reaches its budget, and tells you.</CardLine>
      <div className="flex flex-col divide-y divide-gray-100">
        <BudgetRows agent={{ ...agent, budgetMicro, paidBy }} access={access} onBudget={setBudgetMicro} onPaidBy={setPaidBy} spend={false} />
      </div>
    </CardShell>
  );
}

function TurnOnCard({ agent, access, onTurnOn }: { agent: Agent; access: Access; onTurnOn: () => void }) {
  const used = CONNECTORS.filter((connector) => agent.tools[connector.id].length > 0);
  return (
    <CardShell
      icon={Power}
      title={`Turn on ${agent.name}`}
      state="Ready"
      testId="setup-card-turn-on"
      dataState="ready"
      footer={(
        <>
          <AppButton onClick={onTurnOn} testId="setup-turn-on">{`Turn on ${agent.name}`}</AppButton>
          <span className="min-w-0 flex-1 text-[13px] leading-5 text-[#60646c]">You can change all of this in Settings.</span>
        </>
      )}
    >
      <div className="flex flex-col gap-2">
        <CardRow label="Tools">
          {used.length > 0 ? listWords(used.map((connector) => `${connector.name} ${lowerFirst(accessWord(connector, agent.tools[connector.id]))}`)) : "None yet"}
        </CardRow>
        <CardRow label="Routines">
          {agent.routines.length > 0
            ? <span className="flex flex-col">{agent.routines.map((routine) => <span key={routine.id}>{`${routine.name}. ${scheduleLine(routine.schedule)}`}</span>)}</span>
            : "None. It works only when you ask it."}
        </CardRow>
        <CardRow label="Budget">{budgetSentence(agent, access)}</CardRow>
        <CardRow label="Reports">A direct message from Workbot in Slack, and here in its thread.</CardRow>
        <CardRow label="Shared with">Nobody. Use Share once it is on.</CardRow>
      </div>
    </CardShell>
  );
}

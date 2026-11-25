# Personal agents (`personalAgents`)

- **Feature key:** `personalAgents`
- **Deployments:** cloud
- **Author:** `benjaminshafii`

## What people get

A member can make agents of their own from chat, as many as they want. Each
agent has a name and a brief: one Markdown text that says what the agent
watches or does, how it decides, and how it reports.

An agent works through routines. A routine is a Cloud Automation that belongs
to the agent, so it has a schedule, a run history and a Run now like any other
Automation. Every run starts from the agent's brief, followed by what that
routine does.

The owner can keep an agent away from a connector, or from single tools of a
connector. A run of that agent is not offered those tools and cannot call
them. The owner's own chat and their other Automations are not affected.

Only the owner sees or changes their agents.

## In the app

With the feature on, the sidebar has an Agents section. Its + opens a new
agent's chat: the agent asks what it should do, the member answers in one
message, and one card asks "Start like this?". Saying yes creates the agent,
its first routine and the first run. The run's result appears in the same
chat. Each agent is listed once and keeps one conversation; its name in the
header opens a small panel with an on/off switch, the next run, its routines
and Run now.

## What is built so far

The storage, the API, the OpenWork Connect capabilities and the agent chat in
the app. Not built yet:

- asking the owner before an agent's first change in an app (cloud runs are
  unattended)
- settings for an agent in the app: its brief, its tools, its budget
- enforcing the monthly spending limit (it is stored with the agent)
- sharing an agent with teammates
- limiting built-in connectors such as Google Workspace per agent (a tool
  policy that names one is refused)
- running a routine on the owner's desktop
- telling the owner about a result while the chat is closed
- the same conversation on another computer: which chat belongs to which agent
  is remembered on this computer only

## How it works

- `personal_agent` holds the agent; `personal_agent_revision` holds each
  version of its definition: the brief (encrypted like Automation
  instructions), the tool policy, the default placement and the monthly budget.
- `automation.agent_id` marks an Automation as a routine.
  `automation_revision.agent_revision_id` pins the agent version that revision
  runs with. Changing the agent's definition makes the next version and gives
  each routine a new revision that pins it; a run already started keeps the
  version it began with. Archiving the agent archives its routines.
- `/v1/personal-agents` creates, lists, reads, changes and archives agents,
  creates and lists routines, and runs an agent now. Each route is also an
  OpenWork Connect capability.
- With the feature off for an organization the routes answer 404 and the
  capabilities are not listed. Routines that already exist keep their brief and
  tool limits.
- A run adds the pinned brief in front of the routine's instructions. Blocked
  connections and tools become scopes on the run's credential, the same way an
  admin keeps a connection from Workbot, so search, direct calls and Code Mode
  all leave them out. A run that cannot be limited this way does not start.

- In the app, a chat that belongs to an agent is an ordinary session. The chat
  model offers the agent through `agent.propose`, which only draws the card;
  the app calls `/v1/personal-agents` when the member says yes. The app code
  is `apps/app/src/react-app/domains/agents/`.

## Verify

`ee/apps/den-api/test/api/personal-agents.api.test.ts` covers the flag, the
versions, a routine as an Automation, the prompt of a manual run, and a blocked
tool. `apps/app/tests/personal-agent-start.test.ts` covers what
saying yes does: the order of the three calls, a retry that makes nothing
twice, and two confirmations at once.

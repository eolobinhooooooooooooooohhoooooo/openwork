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

## What is built so far

This is the first step: the storage, the API and the OpenWork Connect
capabilities, so an agent can be made and run from chat. Not built yet:

- a screen for agents in the desktop app or on the web
- enforcing the monthly spending limit (it is stored with the agent)
- sharing an agent with teammates
- limiting built-in connectors such as Google Workspace per agent (a tool
  policy that names one is refused)
- running a routine on the owner's desktop
- reporting to the owner in a Workbot DM

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

## Verify

`ee/apps/den-api/test/api/personal-agents.api.test.ts` covers the flag, the
versions, a routine as an Automation, the prompt of a manual run, and a blocked
tool.

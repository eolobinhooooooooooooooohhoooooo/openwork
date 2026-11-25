import assert from "node:assert/strict";
import { test } from "node:test";
import type { PersonalAgentEventDetail } from "@openwork/types/den/personal-agents";
import { agentEventSentence, formatAgentMoney, sharedWithText, writeAccessText } from "./words";

const agent = "Bug watcher";
const cases: readonly [string, PersonalAgentEventDetail, string][] = [
  ["agent.created", {}, "created Bug watcher"],
  ["agent.updated", {}, "updated Bug watcher"],
  ["agent.archived", {}, "archived Bug watcher"],
  ["agent.paused", {}, "paused Bug watcher"],
  ["agent.resumed", {}, "resumed Bug watcher"],
  ["agent.transferred", { from: "Dana Reyes", to: "Sam Okafor" }, "moved Bug watcher from Dana Reyes to Sam Okafor"],
  ["agent.budget_set", { monthlyBudgetMicros: 10_000_000 }, "set Bug watcher's budget to $10.00 a month"],
  ["agent.budget_set", { monthlyBudgetMicros: 0 }, "set Bug watcher's budget to $0.00 a month"],
  ["agent.budget_set", { monthlyBudgetMicros: null }, "removed Bug watcher's budget"],
  ["agent.tools_changed", {}, "changed the tools Bug watcher may use"],
  ["share.added", { member: "Priya Nair", role: "collaborator" }, "shared Bug watcher with Priya Nair as Collaborator"],
  ["share.changed", { memberName: "Sam Okafor", role: "manager" }, "changed Sam Okafor's role on Bug watcher to Manager"],
  ["share.removed", { member: "Priya Nair" }, "removed Priya Nair's access to Bug watcher"],
  ["routine.created", { routineName: "Morning check" }, "added Morning check to Bug watcher"],
  ["routine.changed", { routineName: "Morning check" }, "changed Morning check on Bug watcher"],
  ["request.asked", { tool: "Create issue" }, "asked to let Bug watcher use Create issue"],
  ["request.asked", { summary: "Change the schedule" }, "asked to change Bug watcher"],
  ["request.denied", { tool: "Create issue" }, "denied Bug watcher access to Create issue"],
  ["request.denied", { summary: "Change the schedule" }, "denied a request to change Bug watcher"],
  ["request.allowed_once", { tool: "Create issue" }, "let Bug watcher use Create issue once"],
  ["request.always_allowed", { tool: "Create issue" }, "let Bug watcher always use Create issue"],
  ["request.approved", { summary: "Change the schedule" }, "approved a change to Bug watcher"],
  ["organization.tools_changed", {}, "changed the tools no agent may use"],
  ["organization.budget_set", { monthlyBudgetMicros: 50_000_000 }, "set the spending limit for every agent to $50.00 a month"],
  ["organization.budget_set", { monthlyBudgetMicros: null }, "removed the spending limit for every agent"],
  ["agent.future_action", {}, "recorded agent future action"],
];

for (const [action, detail, expected] of cases) {
  test(`words for ${expected}`, () => {
    assert.equal(agentEventSentence(action, detail, action.startsWith("organization.") ? null : agent), expected);
  });
}

test("sharing names three or fewer people with their roles", () => {
  const team = [
    { name: "Sam Okafor", role: "manager" },
    { name: "Priya Nair", role: "collaborator" },
    { name: "Lee Park", role: "collaborator" },
  ] as const;
  assert.equal(sharedWithText([]), "Only the owner");
  assert.equal(sharedWithText(team), "Sam Okafor (Manager), Priya Nair (Collaborator), Lee Park (Collaborator)");
  assert.equal(sharedWithText([...team, { name: "Dana Reyes", role: "manager" }]), "4 people");
});

test("write access shows the default or each count", () => {
  assert.equal(writeAccessText({ allowed: 0, ask: 0, blocked: 0 }), "Asks first");
  assert.equal(writeAccessText({ allowed: 3, ask: 0, blocked: 2 }), "3 allowed · 0 ask · 2 blocked");
});

test("money converts micros into two decimal places", () => {
  assert.equal(formatAgentMoney(0), "$0.00");
  assert.equal(formatAgentMoney(424_999), "$0.42");
  assert.equal(formatAgentMoney(425_000), "$0.43");
  assert.equal(formatAgentMoney(10_000_000), "$10.00");
  assert.equal(formatAgentMoney(1_250_500_000), "$1,250.50");
});

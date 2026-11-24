"use client";

import { ArrowUp, ChevronRight, Plus, type SquarePen } from "lucide-react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import { type Connector, PRESET_LABEL, presetOf, toolCount } from "./model";

// The pieces of the OpenWork app every screen here is built from: its buttons,
// its composer, and the cards a chat or a thread shows.

export function AppButton({ variant = "primary", icon: Icon, children, onClick, disabled = false, pressed, testId }: {
  variant?: "primary" | "secondary" | "quiet";
  icon?: typeof SquarePen;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  // Set on a button that shows or hides something, such as the settings panel.
  pressed?: boolean;
  testId?: string;
}) {
  const look = variant === "primary"
    ? "bg-[#1c2024] text-[#fcfcfd] hover:bg-[#30343a]"
    : variant === "secondary"
      ? "border border-[#e0e1e6] bg-[#fcfcfd] text-[#1c2024] hover:bg-[#f0f0f3]"
      : "text-[#60646c] hover:bg-[#f0f0f3] hover:text-[#1c2024]";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      data-testid={testId}
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${look}`}
    >
      {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function AppSwitch({ checked, onChange, label, testId }: { checked: boolean; onChange: (checked: boolean) => void; label: string; testId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      data-testid={testId}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-[#1c2024]" : "bg-[#d9d9e0]"}`}
    >
      <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none ${checked ? "translate-x-4" : ""}`} />
    </button>
  );
}

export function PaneHeader({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-[#f3f4f6] px-5 py-2">
      <div className="flex min-w-0 items-baseline gap-2.5">
        <h1 className="truncate text-[13px] font-medium text-[#1c2024]">{title}</h1>
        {sub ? <span className="truncate text-[12px] text-[#8b8d98]">{sub}</span> : null}
      </div>
      {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
    </header>
  );
}

export function Composer({ value, onChange, onSubmit, placeholder, disabled = false, focus = false, note }: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  disabled?: boolean;
  focus?: boolean;
  note?: string;
}) {
  const ready = !disabled && value.trim().length > 0;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (ready) onSubmit();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (ready) onSubmit();
  };
  return (
    <form onSubmit={submit} className="mx-auto w-full max-w-[800px]">
      <div className={`rounded-[18px] border border-[#e0e1e6] bg-[#fcfcfd] px-3 pb-2 pt-3 shadow-[0_2px_8px_rgba(15,23,42,0.04)] ${disabled ? "opacity-60" : ""}`}>
        <textarea
          rows={1}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={focus}
          aria-label={placeholder}
          data-testid="chat-input"
          className="block w-full resize-none bg-transparent px-1 text-[14px] leading-6 text-[#1c2024] outline-none placeholder:text-[#8b8d98]"
        />
        <div className="mt-1.5 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-[12px] text-[#8b8d98]">
            <span className="grid size-7 place-items-center rounded-full text-[#60646c]"><Plus className="size-4" aria-hidden /></span>
            Auto
          </span>
          <button
            type="submit"
            disabled={!ready}
            aria-label="Send"
            data-testid="chat-send"
            className="grid size-8 place-items-center rounded-full bg-[#011627] text-white transition-opacity disabled:opacity-25"
          >
            <ArrowUp className="size-4" aria-hidden />
          </button>
        </div>
      </div>
      {note ? <p className="px-2 pt-2 text-center text-[12px] leading-4 text-[#8b8d98]">{note}</p> : null}
    </form>
  );
}

export function UserBubble({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[75%] whitespace-pre-wrap rounded-3xl bg-[#f0f0f3] px-4 py-2.5 text-[14px] leading-6 text-[#1c2024]">{children}</p>
    </div>
  );
}

export function Working({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2 py-1 text-[14px] leading-5 text-[#8b8d98]" role="status">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#8b8d98] motion-reduce:animate-none" />
      {label}
    </p>
  );
}

export function CardShell({ icon: Icon, title, state, testId, dataState, children, footer }: {
  icon: typeof SquarePen;
  title: string;
  state: string;
  testId: string;
  dataState: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="w-full max-w-2xl space-y-3 rounded-2xl border border-[#e0e1e6] bg-[#fcfcfd] px-4 py-3" data-testid={testId} data-state={dataState}>
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 size-4 shrink-0 text-[#60646c]" aria-hidden />
        <h3 className="min-w-0 flex-1 text-[14px] font-medium leading-5 text-[#1c2024]">{title}</h3>
        <span className="shrink-0 text-[12px] leading-5 text-[#60646c]" data-testid="chat-card-state">{state}</span>
      </div>
      {children}
      {footer ? <div className="flex flex-wrap items-center gap-2 border-t border-[#f3f4f6] pt-3">{footer}</div> : null}
    </section>
  );
}

export function CardRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 text-[14px] leading-5 sm:grid-cols-[96px_minmax(0,1fr)] sm:gap-x-3">
      <span className="text-[#8b8d98]">{label}</span>
      <span className="min-w-0 text-[#1c2024]">{children}</span>
    </div>
  );
}

export function CardDetails({ children }: { children: ReactNode }) {
  return (
    <details className="group/details text-[13px] leading-5 text-[#60646c]">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-[#60646c] hover:text-[#1c2024] [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 transition-transform duration-150 group-open/details:rotate-90 motion-reduce:transition-none" aria-hidden />
        Details
      </summary>
      <div className="flex flex-col gap-1.5 pl-[18px] pt-2">{children}</div>
    </details>
  );
}

export function ToolList({ label, tools }: { label: string; tools: string[] }) {
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <span className="text-[#8b8d98]">{label}</span>
      {tools.map((tool) => <code key={tool} className="rounded bg-[#f0f0f3] px-1.5 py-px font-mono text-[12px] text-[#1c2024]">{tool}</code>)}
    </p>
  );
}

// How much of an app an agent uses, in a word or two.
export function accessWord(connector: Connector, tools: string[]): string {
  const preset = presetOf(connector, tools);
  return preset === "custom" ? toolCount(connector, tools) : PRESET_LABEL[preset];
}

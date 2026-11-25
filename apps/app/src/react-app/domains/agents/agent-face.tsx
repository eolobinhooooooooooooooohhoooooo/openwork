import { cn } from "@/lib/utils";

const FACE_COLORS = [
  { className: "bg-red-9", value: "var(--red-9)" },
  { className: "bg-blue-9", value: "var(--blue-9)" },
  { className: "bg-purple-9", value: "var(--purple-9)" },
  { className: "bg-orange-9", value: "var(--orange-9)" },
  { className: "bg-green-9", value: "var(--green-9)" },
  { className: "bg-pink-9", value: "var(--pink-9)" },
  { className: "bg-cyan-9", value: "var(--cyan-9)" },
] as const;

const NEW_FACE = { className: "bg-gray-8", value: "var(--gray-8)" } as const;

export function agentFaceColor(name: string | null) {
  if (!name) return NEW_FACE;
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) % 9973;
  return FACE_COLORS[hash % FACE_COLORS.length] ?? NEW_FACE;
}

export function agentFaceLetter(name: string | null): string {
  return name?.trim().charAt(0).toUpperCase() || "+";
}

export function AgentFace(props: { name: string | null; size?: "sm" | "md" | "lg"; className?: string }) {
  const size = props.size ?? "sm";
  return (
    <span
      aria-hidden="true"
      data-agent-face
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        size === "sm" && "size-5 text-[10px]",
        size === "md" && "size-6 text-[11px]",
        size === "lg" && "size-14 text-2xl",
        agentFaceColor(props.name).className,
        props.className,
      )}
    >
      {agentFaceLetter(props.name)}
    </span>
  );
}

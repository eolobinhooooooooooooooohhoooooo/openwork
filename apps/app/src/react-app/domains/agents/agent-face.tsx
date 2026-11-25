import { cn } from "@/lib/utils";

const FACE_COLORS = ["bg-red-9", "bg-blue-9", "bg-purple-9", "bg-orange-9", "bg-green-9", "bg-pink-9", "bg-cyan-9", "bg-amber-9"];

export function agentFaceColor(seed: string): string {
  let hash = 0;
  for (const character of seed) hash = (hash * 31 + character.charCodeAt(0)) % 9973;
  return FACE_COLORS[hash % FACE_COLORS.length] ?? "bg-blue-9";
}

export function AgentFace(props: { name: string | null; size?: "sm" | "md" | "lg"; className?: string }) {
  const size = props.size ?? "sm";
  const letter = props.name?.trim().charAt(0).toUpperCase() ?? "";
  return (
    <span
      aria-hidden="true"
      data-agent-face
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        size === "sm" && "size-5 text-[10px]",
        size === "md" && "size-6 text-[11px]",
        size === "lg" && "size-14 text-2xl",
        props.name ? agentFaceColor(props.name) : "bg-gray-8",
        props.className,
      )}
    >
      {letter || "+"}
    </span>
  );
}

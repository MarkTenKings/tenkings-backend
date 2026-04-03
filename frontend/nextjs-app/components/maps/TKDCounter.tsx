import { useEffect, useState } from "react";

type TKDCounterProps = {
  value: number;
  className?: string;
};

export default function TKDCounter({ value, className }: TKDCounterProps) {
  const [bump, setBump] = useState(false);

  useEffect(() => {
    setBump(true);
    const timeout = window.setTimeout(() => setBump(false), 280);
    return () => window.clearTimeout(timeout);
  }, [value]);

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border border-[rgba(212,168,67,0.24)] bg-[rgba(212,168,67,0.08)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#d4a843] transition ${bump ? "scale-105" : "scale-100"} ${className ?? ""}`.trim()}
    >
      <span aria-hidden>+</span>
      <span>{value} TKD</span>
    </div>
  );
}

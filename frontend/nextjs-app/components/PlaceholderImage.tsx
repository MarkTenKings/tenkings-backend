interface PlaceholderImageProps {
  label: string;
}

export function PlaceholderImage({ label }: PlaceholderImageProps) {
  return (
    <div className="flex h-full w-full items-center justify-center rounded-2xl border border-dashed border-violet-500/60 bg-night-900/70 text-xs uppercase tracking-[0.45em] text-violet-200">
      {label}
    </div>
  );
}

import { adminPanelClass } from "./AdminPrimitives";

type PaginationBarProps = {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  onChange: (page: number) => void;
};

export function PaginationBar({ page, pageSize, totalCount, totalPages, onChange }: PaginationBarProps) {
  const start = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = totalCount === 0 ? 0 : Math.min(page * pageSize, totalCount);

  return (
    <section className={adminPanelClass("p-4")}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-slate-300">
          Showing {start}-{end} of {totalCount} cards
        </p>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onChange(page - 1)}
            disabled={page <= 1}
            className="rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Prev
          </button>
          <span className="text-[11px] uppercase tracking-[0.24em] text-slate-400">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => onChange(page + 1)}
            disabled={page >= totalPages}
            className="rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
}

export const COMPS_V2_INITIAL_VISIBLE_COUNT = 30;
export const COMPS_V2_MAX_VISIBLE_COUNT = 60;

export const initialCompsV2VisibleCount = (includedCount: number) =>
  includedCount > 0 ? COMPS_V2_MAX_VISIBLE_COUNT : COMPS_V2_INITIAL_VISIBLE_COUNT;

export const revealCompsV2Locally = (currentVisibleCount: number, candidateCount: number) =>
  Math.min(
    Math.max(0, candidateCount),
    COMPS_V2_MAX_VISIBLE_COUNT,
    Math.max(COMPS_V2_INITIAL_VISIBLE_COUNT, currentVisibleCount) + COMPS_V2_INITIAL_VISIBLE_COUNT,
  );

export const handleFetch30MoreCompsV2Click = (input: {
  currentVisibleCount: number;
  candidateCount: number;
  selectedIds: readonly string[];
  compsPublic: boolean;
  setVisibleCount: (nextVisibleCount: number) => void;
}) => {
  const visibleCount = revealCompsV2Locally(input.currentVisibleCount, input.candidateCount);
  input.setVisibleCount(visibleCount);
  return {
    visibleCount,
    selectedIds: input.selectedIds,
    compsPublic: input.compsPublic,
  };
};

export const visibleCompsV2Candidates = <Candidate>(
  candidates: readonly Candidate[],
  visibleCount: number,
): Candidate[] => candidates.slice(0, Math.max(0, Math.min(visibleCount, COMPS_V2_MAX_VISIBLE_COUNT)));

export const isCompsV2QueryReadOnly = (mode: "CARD" | "RESEARCH") => mode === "CARD";

export const shouldAutoRunCompsV2Search = (input: {
  mode: "CARD" | "RESEARCH";
  cardId: string | null;
  hasSnapshot: boolean;
  candidateCount: number;
  query: string;
  busy: boolean;
  autoAttemptedCardId: string | null;
}) => Boolean(
  input.mode === "CARD" &&
  input.cardId &&
  !input.hasSnapshot &&
  input.candidateCount === 0 &&
  input.query &&
  !input.busy &&
  input.autoAttemptedCardId !== input.cardId
);

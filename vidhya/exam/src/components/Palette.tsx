export type PaletteStatus = { answered: boolean; flagged: boolean };

/** The M3 question palette. Counts line and Submit live here so the side panel (>= 1024px) and the sheet share them. */
export function Palette({ statuses, current, onGo }: {
  statuses: PaletteStatus[];
  current: number;
  onGo: (index: number) => void;
}) {
  return (
    <div className="pal" role="group" aria-label="Questions">
      {statuses.map((s, i) => (
        <button
          key={i}
          type="button"
          className={`${s.answered ? 'a' : ''} ${s.flagged ? 'f' : ''} ${i === current ? 'c' : ''}`}
          aria-current={i === current ? 'true' : undefined}
          aria-label={`Question ${i + 1}, ${s.answered ? 'answered' : 'blank'}${s.flagged ? ', flagged' : ''}`}
          onClick={() => onGo(i)}
        >
          {i + 1}
        </button>
      ))}
    </div>
  );
}

export function paletteCounts(statuses: PaletteStatus[]) {
  const answered = statuses.filter(s => s.answered).length;
  return { answered, blank: statuses.length - answered, flagged: statuses.filter(s => s.flagged).length };
}

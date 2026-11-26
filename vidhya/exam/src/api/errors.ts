/** An error from the Exam Brain, as the app sees it. `code` is the brain's BrainError code or a transport code. */
export class ExamApiError extends Error {
  readonly code: string;
  readonly status: number;
  /** True when the brain could not be reached or a proxy answered for it (DR8): the shell shows the outage banner. */
  readonly down: boolean;
  constructor(code: string, message: string, opts: { status?: number; down?: boolean } = {}) {
    super(message);
    this.name = 'ExamApiError';
    this.code = code;
    this.status = opts.status ?? 0;
    this.down = opts.down ?? false;
  }
}

/** DR8: said plainly when the brain is down. The banner adds the DeepTutor link. */
export const DOWN_COPY = "The Exam page is down for now. Answers you already saved are safe. DeepTutor's Practice and Tutor still work.";
/** DR5: shown by the screens when an answer is held on the device. Exported so tests and screens share one string. */
export const OFFLINE_SAVE_COPY = "Saved · we'll check it when you're back online";

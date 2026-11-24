import type { ReactNode } from 'react';

export const TUTOR_HREF = '/';

export function TitleBar({ title, left, right, tutorHref = TUTOR_HREF, center }: {
  title?: string;
  /** Replaces the "← Tutor" link (the question screen has a close button instead). */
  left?: ReactNode;
  right?: ReactNode;
  tutorHref?: string;
  center?: ReactNode;
}) {
  return (
    <header className="titlebar">
      <div className="side">{left ?? <a href={tutorHref}>← Tutor</a>}</div>
      {center ?? (title ? <h1>{title}</h1> : null)}
      <div className="side end">{right}</div>
    </header>
  );
}

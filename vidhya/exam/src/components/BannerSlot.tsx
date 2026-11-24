/**
 * The one banner slot, directly under the title bar (section 21): one sentence,
 * one action, never a modal, never alert(). Four banners, with the copy from
 * the design review.
 */
export type Banner =
  | { kind: 'offline' }
  | { kind: 'release'; onRefresh: () => void }
  | { kind: 'access-ended'; endedOn: string; renewHref: string }
  | { kind: 'outage'; tutorHref: string };

export function BannerSlot({ banner }: { banner: Banner | null }) {
  if (!banner) return <div role="status" aria-live="polite" />;
  return (
    <div role="status" aria-live="polite">
      <p className="banner" style={{ marginBottom: 0 }}>
        {banner.kind === 'offline' && <>Saved · we'll check it when you're back online. <span style={{ color: 'var(--text-secondary)' }}>You can keep going.</span></>}
        {banner.kind === 'release' && (
          <>Content updated. <button type="button" onClick={banner.onRefresh}>Refresh</button> to get the new version. Your answers are kept.</>
        )}
        {banner.kind === 'access-ended' && (
          <>Your access ended on {banner.endedOn}. Your marks history is still here. <a href={banner.renewHref}>Renew on Telegram</a></>
        )}
        {banner.kind === 'outage' && (
          <>The Exam page is down for now. Answers you already saved are safe. <a href={banner.tutorHref}>DeepTutor's Practice and Tutor still work →</a></>
        )}
      </p>
    </div>
  );
}

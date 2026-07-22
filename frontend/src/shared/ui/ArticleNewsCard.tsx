// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, Newspaper, X } from 'lucide-react';

/**
 * ArticleNewsCard - a compact promo card pinned near the foot of the sidebar
 * that links out to the featured long-form article on the uberization of
 * construction. It reuses the sidebar card frame (same width, radius, border,
 * shadow and entrance animation) and opens the article in a new tab.
 *
 * This used to embed a YouTube video; it now points at the written article
 * instead, so the whole card is a single external link with a title, a short
 * subtitle and an external-link affordance. It keeps the existing
 * `sidebar.video_news.*` i18n keys for the title/subtitle.
 *
 * Collapsed by default: only the title shows so the block stays quiet at the
 * foot of the sidebar. On hover (or keyboard focus, for accessibility) the
 * subtitle and the "Read the article" affordance expand into view. The whole
 * card is a link in both states, so it is always clickable - hovering just
 * reveals the detail before the click.
 *
 * Dismissal: the card can be closed with the corner button. It is not a
 * permanent hide - it reopens on the next app load so the article keeps a
 * gentle second (and final) chance to be seen. Only after the user has closed
 * it MAX_DISMISSALS times does it stay hidden for good. The count is read once
 * per mount, so a fresh session shows the card again as long as the stored
 * count is still below the cap.
 */

const ARTICLE_URL = 'https://openconstructionerp.com/uberization-of-construction/';
const DISMISS_KEY = 'oce.uberizationCard.dismissCount';
const MAX_DISMISSALS = 2;

/** Read the persisted dismissal count, tolerant of disabled/blocked storage. */
function readDismissCount(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    const n = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function ArticleNewsCard() {
  const { t } = useTranslation();

  // Persisted count of prior closes, read once at mount. The card reopens on
  // every app load until this reaches the cap; `closed` hides it for the
  // current session the moment the user dismisses it.
  const [dismissCount] = useState(readDismissCount);
  const [closed, setClosed] = useState(false);

  const handleClose = useCallback(() => {
    setClosed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, String(readDismissCount() + 1));
    } catch {
      // Storage disabled (private mode / blocked) - the card simply reappears
      // next load, which is an acceptable degradation.
    }
  }, []);

  if (closed || dismissCount >= MAX_DISMISSALS) return null;

  const title = t('sidebar.video_news.title', { defaultValue: 'Uberization of Construction' });
  const subtitle = t('sidebar.video_news.subtitle', {
    defaultValue: 'Open data, transparency, and the idea behind the platform',
  });
  const read = t('sidebar.video_news.read', { defaultValue: 'Read the article' });
  const dismiss = t('sidebar.video_news.dismiss', { defaultValue: 'Dismiss' });

  return (
    <div className="relative mx-2 mb-2">
      <a
        href={ARTICLE_URL}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="sidebar-article-news"
        aria-label={`${title} - ${read}`}
        className="group flex items-start gap-2.5 overflow-hidden rounded-lg border border-border-light bg-surface-elevated px-3 py-2.5 shadow-sm ring-1 ring-black/5 transition-shadow animate-card-in hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 dark:ring-white/5"
      >
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-oe-blue/10 text-oe-blue dark:text-sky-300">
          <Newspaper size={13} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block break-words pr-4 text-[13px] font-bold leading-tight text-content-primary">
            {title}
          </span>
          {/* Detail row: collapsed to zero height by default, expands on hover
              or keyboard focus. The grid-rows 0fr -> 1fr trick animates to the
              content's natural height; the inner overflow-hidden span is what
              clips it while collapsed. */}
          <span
            className="grid grid-rows-[0fr] opacity-0 transition-all duration-200 ease-out group-hover:grid-rows-[1fr] group-hover:opacity-100 group-focus-visible:grid-rows-[1fr] group-focus-visible:opacity-100 motion-reduce:transition-none"
            aria-hidden="false"
          >
            <span className="overflow-hidden">
              <span className="mt-1 block text-[11px] leading-snug text-content-secondary">
                {subtitle}
              </span>
              <span className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-blue-600 dark:text-sky-300">
                {read}
                <ArrowUpRight size={11} className="shrink-0" />
              </span>
            </span>
          </span>
        </span>
      </a>
      {/* Close button - a sibling of the anchor (never nested inside it, which
          would be invalid interactive-in-interactive markup). Subtle by
          default so the card stays quiet; darkens on hover/focus. */}
      <button
        type="button"
        onClick={handleClose}
        aria-label={dismiss}
        title={dismiss}
        data-testid="sidebar-article-news-dismiss"
        className="absolute right-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-md text-content-tertiary transition-colors hover:bg-surface-secondary hover:text-content-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
      >
        <X size={12} strokeWidth={2.25} />
      </button>
    </div>
  );
}

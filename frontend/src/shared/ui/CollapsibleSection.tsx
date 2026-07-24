// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * A titled section a user can collapse when they do not need it. Built for the
 * "How this module fits together" / explainer blocks that lead many module
 * pages: helpful the first time, noise once you know the module. The header
 * always shows (so it is obvious what the collapsed block is and that it can be
 * reopened); the body expands and collapses with a smooth height animation and
 * the choice is remembered per `storageKey`, so it stays the way each user left
 * it across reloads.
 *
 * Height animates with the grid `0fr`->`1fr` trick (no measuring, no fixed
 * max-height guesswork): a grid wrapper animates its single track, an
 * `overflow-hidden min-h-0` child clips as it shrinks, and the padding lives one
 * level deeper so a collapsed block leaves no residual height. Collapsed content
 * is taken out of the tab order and the a11y tree with `inert` rather than
 * `hidden`, because `display:none` cannot animate.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';

function readCollapsed(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(`oce.collapse.${key}`);
    if (raw === null) return fallback;
    return raw === '1';
  } catch {
    return fallback;
  }
}

function persistCollapsed(key: string, collapsed: boolean): void {
  try {
    localStorage.setItem(`oce.collapse.${key}`, collapsed ? '1' : '0');
  } catch {
    /* private mode / quota - collapsing still works for the session. */
  }
}

export interface CollapsibleSectionProps {
  /** Stable id for remembering the open/closed choice, e.g. "tendering.how". */
  storageKey: string;
  /** Header label. */
  title: ReactNode;
  /** Optional leading icon in the header. */
  icon?: ReactNode;
  /** Optional one-line hint shown under the title (stays visible when collapsed). */
  subtitle?: ReactNode;
  /** Start collapsed on the very first visit (default: expanded). */
  defaultCollapsed?: boolean;
  children: ReactNode;
  className?: string;
  /** Extra classes for the innermost content wrapper. Padding lives here so a
   *  collapsed block has no leftover vertical space (default: `px-4 pb-4`). */
  bodyClassName?: string;
}

export function CollapsibleSection({
  storageKey,
  title,
  icon,
  subtitle,
  defaultCollapsed = false,
  children,
  className,
  bodyClassName,
}: CollapsibleSectionProps) {
  const [collapsed, setCollapsed] = useState<boolean>(() => readCollapsed(storageKey, defaultCollapsed));
  const clipRef = useRef<HTMLDivElement>(null);

  useEffect(() => persistCollapsed(storageKey, collapsed), [storageKey, collapsed]);

  // Keep collapsed content out of the tab order and the a11y tree without the
  // `display:none` that would kill the height animation. `inert` is a no-op in
  // browsers that lack it, so this degrades gracefully to a purely visual hide.
  useEffect(() => {
    const el = clipRef.current;
    if (!el) return;
    if (collapsed) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  }, [collapsed]);

  const toggle = useCallback(() => setCollapsed((c) => !c), []);

  const bodyId = `collapsible-${storageKey.replace(/[^a-z0-9]+/gi, '-')}`;

  return (
    <section className={clsx('overflow-hidden rounded-xl border border-border-light bg-surface-secondary/40', className)}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-controls={bodyId}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-secondary/60"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {icon}
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold text-content-primary">{title}</span>
            {subtitle && <span className="truncate text-2xs text-content-tertiary">{subtitle}</span>}
          </span>
        </span>
        <ChevronDown
          size={16}
          aria-hidden
          className={clsx(
            'shrink-0 text-content-tertiary transition-transform duration-300 ease-oe motion-reduce:transition-none',
            collapsed ? '' : 'rotate-180',
          )}
        />
      </button>
      {/* grid-rows 0fr->1fr animates height with no measuring. */}
      <div
        id={bodyId}
        className={clsx(
          'grid transition-[grid-template-rows] duration-300 ease-oe motion-reduce:transition-none',
          collapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]',
        )}
      >
        <div ref={clipRef} className="min-h-0 overflow-hidden">
          <div className={bodyClassName ?? 'px-4 pb-4'}>{children}</div>
        </div>
      </div>
    </section>
  );
}

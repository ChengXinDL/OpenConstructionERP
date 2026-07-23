// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// ModuleInfoButton — the re-open control for a collapsed module info card.
//
// Founder revision 2026-07-23: when a `DismissibleInfo` card is collapsed the
// way back should be a clear button sitting right next to the module's
// "How it works" button, not a stray icon somewhere else - "свернуть в кнопку
// рядом с how to ... и если нужно её понятно развернуть". This pill is that
// button. It is hosted by `ModuleGuideButton` so it always lands next to
// "How it works", and it self-hides whenever nothing on the page is collapsed
// (so a page with its info card open shows no extra chrome).
//
// Visual identity: a quiet, outlined blue pill that echoes the info card's own
// light-blue tint, deliberately softer than the solid "How it works" button
// next to it so the pair reads as primary (learn) + secondary (bring the note
// back). Same pill geometry and mobile icon-collapse as its siblings so the
// header actions line up.

import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import clsx from 'clsx';

import { useModuleInfoStore } from '@/stores/useModuleInfoStore';

export interface ModuleInfoButtonProps {
  /** Optional extra classes for layout-specific tweaks. */
  className?: string;
}

export function ModuleInfoButton({ className }: ModuleInfoButtonProps) {
  const { t } = useTranslation();
  const hasCollapsed = useModuleInfoStore((s) => s.entries.length > 0);
  const expandAll = useModuleInfoStore((s) => s.expandAll);

  // Nothing collapsed on this page -> no re-open control, no clutter.
  if (!hasCollapsed) return null;

  const label = t('common.module_info', { defaultValue: 'Module information' });

  return (
    <button
      type="button"
      onClick={expandAll}
      data-testid="module-info-button"
      aria-label={label}
      title={label}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full',
        'border border-oe-blue/25 bg-transparent hover:bg-oe-blue/10',
        'px-2.5 h-7 text-xs font-semibold text-oe-blue-text',
        'transition-colors focus:outline-none focus:ring-2 focus:ring-oe-blue/40',
        className,
      )}
    >
      <Info size={13} strokeWidth={2} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// ModuleGuideButton — small pill that opens the module's "How it works"
// guide. Designed to sit immediately next to the existing ModuleHelpButton
// (the Tour button) so the two read as a deliberate pair on a module header.
//
// Visual identity: this guide button is BLUE with a GraduationCap icon and
// reads as the substantive "learn how this works" action (a little more
// prominent than its neighbour); the sibling Tour button (ModuleHelpButton)
// is violet with a Compass icon and reads as a quick walkthrough. Distinct
// hue and icon so the two are never confused, same size and pill geometry so
// they line up.
//
// Mobile collapse: on `sm` and below the label hides and only the icon
// shows, matching ModuleHelpButton; the button stays accessible via
// aria-label.

import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GraduationCap } from 'lucide-react';
import clsx from 'clsx';

import { ModuleGuide, type ModuleGuideContent } from './ModuleGuide';
import { ModuleInfoButton } from './ModuleInfoButton';
import { ModuleCasesButton } from '@/features/cases/ModuleCasesButton';
import { useModuleInfoStore } from '@/stores/useModuleInfoStore';

export interface ModuleGuideButtonProps {
  /** The guide content to teach when the button is clicked. */
  content: ModuleGuideContent;
  /** Optional extra classes for layout-specific tweaks. */
  className?: string;
  /** Optional override for the button label. Defaults to "How it works". */
  label?: string;
  /** Optional handler for the guide's closing CTA (last card). When the
   *  content defines a `ctaKey`, the CTA button runs this then closes. */
  onCta?: () => void;
}

export function ModuleGuideButton({
  content,
  className,
  label,
  onCta,
}: ModuleGuideButtonProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  // Tell the store a "How it works" button is present on this page, so the
  // Header suppresses its top-bar info fallback icon and lets the re-open pill
  // below own the collapsed-card affordance. Keyed by a stable id so a
  // StrictMode double-mount (or two guide buttons) stays balanced.
  const guideId = useId();
  const registerGuide = useModuleInfoStore((s) => s.registerGuide);
  const unregisterGuide = useModuleInfoStore((s) => s.unregisterGuide);
  useEffect(() => {
    registerGuide(guideId);
    return () => unregisterGuide(guideId);
  }, [guideId, registerGuide, unregisterGuide]);

  const resolvedLabel = label ?? t('guide.button', { defaultValue: 'How it works' });
  const aria = t('guide.button_aria', {
    defaultValue: 'Learn how this module works',
  });

  return (
    <>
      {/* Sibling "Cases for this module" pill, sitting to the LEFT of the
          How-it-works button. It is route-derived and self-hides when no
          playbook touches the current module, so it costs nothing on pages
          without cases. */}
      <ModuleCasesButton />
      {/* Re-open control for a collapsed module info card, sitting immediately
          next to "How it works" (founder 2026-07-23). Self-hides when nothing
          on the page is collapsed. */}
      <ModuleInfoButton />
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="module-guide-button"
        aria-label={aria}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={aria}
        className={clsx(
          'inline-flex items-center gap-1.5 rounded-full',
          'border border-oe-blue/40 bg-oe-blue/10 hover:bg-oe-blue/20',
          'px-2.5 h-7 text-xs font-semibold text-oe-blue',
          'transition-colors focus:outline-none focus:ring-2 focus:ring-oe-blue/40',
          className,
        )}
      >
        <GraduationCap size={13} strokeWidth={2} />
        <span className="hidden sm:inline">{resolvedLabel}</span>
      </button>

      <ModuleGuide
        open={open}
        onClose={() => setOpen(false)}
        content={content}
        onCta={onCta}
      />
    </>
  );
}

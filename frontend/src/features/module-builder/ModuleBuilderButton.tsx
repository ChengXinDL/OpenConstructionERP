// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * The top-bar entry point to the module builder.
 *
 * It sits in the header rather than in the sidebar because building a module is
 * something you do *from wherever you are* - you notice the platform is missing
 * a register while you are looking at the thing that needs it. The sidebar
 * lists screens; this is an action.
 *
 * Shown to administrators only. Installing writes files onto the server and
 * loads them into the running process, which is `module_builder.install`, an
 * administrator permission. The role read here comes from the auth store and is
 * for deciding what to draw, never for access: the server enforces the
 * permission on the call itself, and a viewer who reached this some other way
 * is refused there.
 *
 * The wizard is loaded lazily. It is a large screen that most sessions never
 * open, and the header is on every page.
 */
import { Suspense, lazy, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Wand2 } from 'lucide-react';
import clsx from 'clsx';

import { useAuthStore } from '@/stores/useAuthStore';

const ModuleBuilderWizard = lazy(() =>
  import('./ModuleBuilderWizard').then((m) => ({ default: m.ModuleBuilderWizard })),
);

export function ModuleBuilderButton({ className }: { className?: string }) {
  const { t } = useTranslation();
  const role = useAuthStore((s) => s.userRole);
  const [open, setOpen] = useState(false);

  if (role !== 'admin') return null;

  const label = t('module_builder.header_button', { defaultValue: 'Build a module' });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        title={label}
        data-testid="header-module-builder"
        className={clsx(
          'relative flex h-8 w-8 items-center justify-center rounded-lg',
          'text-content-secondary hover:bg-surface-secondary hover:text-content-primary',
          'transition-colors focus:outline-none focus:ring-2 focus:ring-oe-blue/40',
          className,
        )}
      >
        <Wand2 size={16} strokeWidth={1.9} />
      </button>

      {open && (
        <Suspense fallback={null}>
          <ModuleBuilderWizard open={open} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}

export default ModuleBuilderButton;

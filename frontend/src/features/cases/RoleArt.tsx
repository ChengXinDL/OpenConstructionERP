// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import clsx from 'clsx';
import { ROLE_BY_ID } from './roles';
import type { ProfessionalRole } from './types';

interface RoleArtProps {
  role: ProfessionalRole;
  /** Sizing classes (height + width). Rendered as a circular tile. */
  className?: string;
  title?: string;
}

/**
 * The icon for a professional role: the role's own glyph centred in a soft
 * tinted disc, drawn in the role's accent colour. A flat, clear vector mark -
 * no raster portrait, no brand asset - in the same iconographic language as
 * the case tiles, so a role reads at a glance and resolves in both light and
 * dark themes. Keeps the same props as before so every call site is unchanged.
 */
export function RoleArt({ role, className, title }: RoleArtProps) {
  const meta = ROLE_BY_ID[role];
  if (!meta) return null;
  const Glyph = meta.badge;
  return (
    <span
      title={title}
      aria-hidden="true"
      className={clsx(
        // `tint.tile` carries the soft background, the accent text colour the
        // glyph inherits through currentColor, and the ring - all theme-aware.
        'inline-flex shrink-0 items-center justify-center rounded-full ring-1 ring-inset',
        meta.tint.tile,
        className,
      )}
    >
      <Glyph className="h-1/2 w-1/2" strokeWidth={2} aria-hidden="true" />
    </span>
  );
}

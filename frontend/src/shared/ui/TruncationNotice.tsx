// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';

import { isTruncated, type Page } from '@/shared/lib/api';

export interface TruncationNoticeProps {
  /** The page as it came back from the API. */
  page: Pick<Page<unknown>, 'items' | 'total'>;
  /**
   * What the rows are, already translated and plural, e.g. "activities".
   * Passed as an interpolation value so a translator can move it; never
   * concatenate it into the sentence at the call site.
   */
  entity: string;
  /** Optional hint about how to reach the rest, e.g. a search box. */
  hint?: string;
  className?: string;
}

/**
 * States how much of a collection is on screen when some of it is not.
 *
 * Renders nothing when the page is complete, so a call site can mount it
 * unconditionally. That is deliberate: the alternative is each surface
 * writing its own `total > items.length` test, and a surface that forgets
 * the test looks exactly like one that does not need it.
 *
 * This is the honest half of the paging contract. A list that pages needs
 * page controls; a list that cannot page — a picker, a modal, a dropdown —
 * still has to admit that it is showing a slice.
 */
export function TruncationNotice({ page, entity, hint, className }: TruncationNoticeProps) {
  const { t } = useTranslation();

  if (!isTruncated(page)) return null;

  return (
    <p
      className={clsx('text-xs text-content-tertiary', className)}
      role="status"
      data-testid="truncation-notice"
    >
      {t('common.showing_partial', {
        defaultValue: 'Showing {{shown}} of {{total}} {{entity}}',
        shown: page.items.length,
        total: page.total,
        entity,
      })}
      {hint ? ` ${hint}` : ''}
    </p>
  );
}

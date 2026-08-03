# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
"""One display order for schedule activities, shared by every list query.

Activities are ordered by ``sort_order`` first and by ``wbs_code`` second.
``wbs_code`` is a ``String(50)``, so the second term used to be a plain
lexicographic comparison, and lexicographic is the wrong comparison for a
code that carries numbers: ``"10"`` sorts before ``"2"``. Whenever
``sort_order`` does not separate two rows - and it separates nothing at all
in a schedule whose rows were all written with the column's default of 0 -
that wrong comparison is the only thing deciding the order the user sees,
which is how a twelve-phase programme lists as 1, 10, 11, 12, 2, 3.

The order has to be decided in SQL rather than in the client because the
activity list is paginated (``offset``/``limit``). Sorting a page after it
has been fetched only rearranges the rows that happened to land on that
page, which looks fixed on page one and is not fixed at all.

WBS codes in the wild are not plain integers. The shipped demo estate alone
contains unpadded ordinals (``1`` … ``35``), zero-padded ones (``01`` …
``12``), DIN 276 groups (``300``, ``320``), dotted multi-segment codes
(``2.1``, ``2.6``) and alphanumeric ones (``F1``, ``34A``, ``01E``), so a
cast to integer is not available: it would raise on more than half of them.
:func:`natural_sort_key` therefore left-pads every *run of digits* to a
fixed width and compares the result as text, which orders each numeric run
numerically while leaving the letters and separators around it alone.

Four read sites share this order: the paginated repository list, the
per-BIM-element list, the code-grouped list, and the ``Schedule.activities``
relationship. Two others deliberately do not, because they are not asking
for the WBS order: the critical-path endpoint sorts by ``early_start`` and
the field-diary lookup by ``start_date``. Both are chronological views, and
both already handle their own key.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import func

from app.modules.schedule.models import Activity

if TYPE_CHECKING:
    from sqlalchemy.sql.elements import ColumnElement

#: Width every run of digits is padded to before the code is compared as
#: text. A WBS segment wider than this still sorts, but only its last
#: :data:`NATURAL_SORT_DIGITS` digits take part in the comparison; twelve
#: leaves several orders of magnitude of headroom over the widest real code
#: (a four-digit chapter/section pair such as ``0113``).
NATURAL_SORT_DIGITS = 12

# Prefix every digit run with NATURAL_SORT_DIGITS zeros, then keep only the
# last NATURAL_SORT_DIGITS digits of each run. The two passes together are a
# left-pad: "2" and "02" both become "000000000002", which sorts after
# "000000000001" and before "000000000010" - the numeric answer. Written as
# two regexp_replace calls because a replacement string cannot compute a
# per-match padding width.
_PAD = "0" * NATURAL_SORT_DIGITS
_DIGIT_RUN = r"(\d+)"
_KEEP_LAST = r"\d*(\d{" + str(NATURAL_SORT_DIGITS) + r"})"


def natural_sort_key(column: Any) -> ColumnElement[str]:
    """Build a text sort key that compares embedded numbers numerically.

    Args:
        column: A text column (or expression) holding a code such as a WBS
            code. ``NULL`` is treated as the empty string so it sorts first
            and deterministically rather than being pushed around by the
            backend's NULL-ordering default.

    Returns:
        A SQL expression usable anywhere a sort term is: ``order_by``, a
        window ``ORDER BY``, or a functional index.

    Note:
        Uses PostgreSQL's ``regexp_replace``. PostgreSQL is the platform's
        only supported backend - ``app.database.create_engine_from_settings``
        refuses to build an engine for anything else - so there is no second
        dialect to keep this portable across.
    """
    padded = func.regexp_replace(func.coalesce(column, ""), _DIGIT_RUN, _PAD + r"\1", "g")
    return func.regexp_replace(padded, _KEEP_LAST, r"\1", "g")


def activity_order_terms() -> list[ColumnElement[Any]]:
    """Return the canonical ``ORDER BY`` terms for a list of activities.

    ``sort_order`` stays the primary term, so an explicit ordering always
    wins over the code. The writers that set one are the schedule importers
    (which number the rows they create), ``create_activity`` (which appends
    at ``max + 1``) and a ``PATCH`` carrying ``sort_order``; a schedule none
    of them touched carries the column default of 0 on every row, and there
    the code decides alone. ``wbs_code`` breaks ties naturally rather than
    lexicographically, and the primary key breaks what is left so that two
    rows agreeing on both cannot swap places between two pages of the same
    paginated read.

    Returns:
        Sort terms to splat into ``.order_by(*activity_order_terms())``.
    """
    return [Activity.sort_order, natural_sort_key(Activity.wbs_code), Activity.id]

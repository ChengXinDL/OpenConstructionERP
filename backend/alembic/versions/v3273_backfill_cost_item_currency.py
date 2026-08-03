# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Backfill oe_costs_item.currency from the region code that already names it.

``CostItem.currency`` is ``String(10), nullable=False, default=""`` and a CWICR
parquet carries no currency column, so the importer has to resolve the code
from the region it is loading and stamp it on every row. Its lookup table did
not cover every region it would accept, and an import of one of the missing
ones resolved to ``''`` and wrote a whole catalogue of rates with no unit of
money on them. The write path is fixed separately; this repairs the rows it
already wrote.

Measured on a real database before this was written, not inferred: 55 718 of
123 485 cost rows carried a blank currency, and every one of them was
``source = 'cwicr'`` with ``region = 'ZH_SHANGHAI'``. The other three regions
in the same table - RU_STPETERSBURG, TR_ISTANBUL and the Universal starter set
- were complete, so this is one import rather than a systemic write. That is
also what makes it repairable rather than guesswork: the region code is not a
hint about the currency, it IS the currency. A CWICR catalogue is imported one
region at a time and every rate in it is denominated in that region's local
money.

Why this is safe to run over customer data:

* **Only empty or NULL rows are touched.** A row carrying any currency is
  never rewritten, whatever its value. An install whose items were imported
  rather than ingested from CWICR is therefore untouched. Verified on a seeded
  row: a ``ZH_SHANGHAI`` item already carrying USD came through the run still
  carrying USD.
* **Nothing is invented.** The region-to-currency pairs below are a frozen
  snapshot of ``app/modules/costs/base_registry.py``'s ``_GLOBAL_MARKETS``
  table, which is where the application itself gets the answer. A row whose
  region is not in that table keeps its blank currency, and the count of such
  rows is logged rather than papered over. Verified the same way: a row under a
  region no base declares stayed blank.
* **Frozen on purpose.** The pairs are inlined rather than imported. A
  migration that imports application code breaks the moment that code moves
  on, and this revision has to keep running against the schema and the
  registry as they were when it was written.
* **Idempotent.** The predicate stops matching once a row is filled, so a
  second run updates zero rows. Run twice against the measured database: the
  first pass reported 55 718 filled, the second 0 blank before and 0 filled.

One thing this deliberately does **not** do. There is a separate, open question
about the same recipe carrying an identical amount in several currencies. This
revision only writes the *label*; it changes no amount, so it neither fixes nor
hides that. If anything it makes it easier to see, because identical numbers now
carry different currency codes instead of none. Repricing is a separate decision
and is not taken here.

Revision ID: v3273_backfill_cost_item_currency
Revises: v3272_assignment_activity_link
Create Date: 2026-08-03
"""

from __future__ import annotations

import logging
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "v3273_backfill_cost_item_currency"
down_revision: Union[str, Sequence[str], None] = "v3272_assignment_activity_link"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger("alembic.runtime.migration")

_ITEM = "oe_costs_item"

# Frozen snapshot of base_registry._GLOBAL_MARKETS (region -> ISO 4217 code).
_REGION_CURRENCY: tuple[tuple[str, str], ...] = (
    ("USA_USD", "USD"),
    ("UK_GBP", "GBP"),
    ("DE_BERLIN", "EUR"),
    ("ENG_TORONTO", "CAD"),
    ("FR_PARIS", "EUR"),
    ("SP_BARCELONA", "EUR"),
    ("PT_SAOPAULO", "BRL"),
    ("RU_STPETERSBURG", "RUB"),
    ("AR_DUBAI", "AED"),
    ("HI_MUMBAI", "INR"),
    ("AU_SYDNEY", "AUD"),
    ("NZ_AUCKLAND", "NZD"),
    ("IT_ROME", "EUR"),
    ("NL_AMSTERDAM", "EUR"),
    ("PL_WARSAW", "PLN"),
    ("CS_PRAGUE", "CZK"),
    ("HR_ZAGREB", "EUR"),
    ("BG_SOFIA", "BGN"),
    ("RO_BUCHAREST", "RON"),
    ("SV_STOCKHOLM", "SEK"),
    ("JA_TOKYO", "JPY"),
    ("KO_SEOUL", "KRW"),
    ("TH_BANGKOK", "THB"),
    ("VI_HANOI", "VND"),
    ("ID_JAKARTA", "IDR"),
    ("MX_MEXICOCITY", "MXN"),
    ("ZA_JOHANNESBURG", "ZAR"),
    ("NG_LAGOS", "NGN"),
    ("ZH_SHANGHAI", "CNY"),
    ("TR_ISTANBUL", "TRY"),
)


def _has_column(inspector: sa.engine.reflection.Inspector, table: str, column: str) -> bool:
    """True when ``table`` exists and carries ``column``."""
    if table not in inspector.get_table_names():
        return False
    return any(col["name"] == column for col in inspector.get_columns(table))


def upgrade() -> None:
    """Fill blank cost-item currencies from the region code. Never overwrite."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # The costs module can be absent on a partial install, and this revision
    # must not be the thing that stops an upgrade over such a database.
    if not _has_column(inspector, _ITEM, "currency"):
        logger.info("%s.currency absent, nothing to backfill", _ITEM)
        return
    if not _has_column(inspector, _ITEM, "region"):
        logger.info("%s.region absent, nothing to backfill from", _ITEM)
        return

    blank = "(currency IS NULL OR TRIM(currency) = '')"

    before = bind.execute(
        sa.text(f"SELECT COUNT(*) FROM {_ITEM} WHERE {blank}")  # noqa: S608 - constants
    ).scalar_one()

    filled = 0
    for region, code in _REGION_CURRENCY:
        result = bind.execute(
            sa.text(
                f"UPDATE {_ITEM} SET currency = :code "  # noqa: S608 - constants
                f"WHERE {blank} AND region = :region"
            ),
            {"code": code, "region": region},
        )
        filled += result.rowcount or 0

    remaining = bind.execute(
        sa.text(f"SELECT COUNT(*) FROM {_ITEM} WHERE {blank}")  # noqa: S608 - constants
    ).scalar_one()

    logger.info(
        "cost item currency backfill: %s blank before, %s filled, %s still blank",
        before,
        filled,
        remaining,
    )
    if remaining:
        # Flag rather than guess. A row whose region is not in the frozen
        # market table has no derivable currency, and writing a default would
        # be inventing money.
        logger.warning(
            "%s rows in %s still carry no currency; their region is not in the "
            "known market table and no currency can be derived for them",
            remaining,
            _ITEM,
        )


def downgrade() -> None:
    """Deliberately a no-op.

    A currency code this migration wrote is indistinguishable from one a user
    or an import set: both are just a code sitting in the column. Blanking the
    rows this revision touched would therefore destroy values that may have
    been corrected by hand since. Downgrading a schema is reversible;
    downgrading a backfill is not, so this side is intentionally empty.
    """

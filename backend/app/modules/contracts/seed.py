# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Deterministic seed data for the contracts module.

Two jobs, both idempotent:

1. **Catalog fabrication** - 10 contracts spanning all primary types
   (3 lump-sum, 2 GMP, 1 cost-plus, 2 T&M, 1 unit-price, 1 design-build),
   each with 5-15 SoV lines, 4 progress claims and 2 closed with a
   FinalAccount. Fabricated only into projects that hold no contract at
   all: the demo installer authors each demo project's own head contract
   and trade subcontracts, and stacking a generic catalog on top of those
   would bury the authored register under filler.

2. **Progress-claim backfill** - every authored contract shipped without a
   single progress claim, so the payment side of the register was empty on
   every install. For each live contract that has no claims yet, a staged
   claim run is written along the contract's own calendar: earlier periods
   paid, then one under approval, the latest submitted, the current period
   still a draft. German-market projects number their claims AZ-nn
   (Abschlagszahlung); everything else keeps PC-nnnn.

All decisions are seeded from fixed ``random.Random`` instances so output
is reproducible.
"""

from __future__ import annotations

import logging
import random
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.contracts.models import (
    Contract,
    ContractLine,
    ContractTypeConfiguration,
    FeeStructure,
    FinalAccount,
    GainshareConfiguration,
    LDClause,
    ProgressClaim,
    RetentionSchedule,
)

logger = logging.getLogger(__name__)


_TYPE_CONFIG_CATALOG: list[dict[str, object]] = [
    {
        "contract_type": "lump_sum",
        "display_name": "Lump-Sum",
        "allowed_fields": ["total_value", "retention_percent"],
        "default_fee_structure": {},
    },
    {
        "contract_type": "gmp",
        "display_name": "Guaranteed Maximum Price",
        "allowed_fields": ["gmp_cap", "target_cost", "gainshare_split_pct"],
        "default_fee_structure": {"fee_type": "percent_of_cost", "fee_percent": 4},
    },
    {
        "contract_type": "cost_plus",
        "display_name": "Cost-Plus",
        "allowed_fields": ["fee_percent", "max_fee"],
        "default_fee_structure": {"fee_type": "percent_of_cost", "fee_percent": 8},
    },
    {
        "contract_type": "tm",
        "display_name": "Time & Materials",
        "allowed_fields": ["tm_nte_cap", "labor_rates", "material_markup"],
        "default_fee_structure": {"fee_type": "percent_of_cost", "fee_percent": 5},
    },
    {
        "contract_type": "unit_price",
        "display_name": "Unit Price",
        "allowed_fields": ["measurement_method", "qty_variance_threshold"],
        "default_fee_structure": {},
    },
    {
        "contract_type": "design_build",
        "display_name": "Design-Build",
        "allowed_fields": ["design_phase_fee", "construction_phase_fee"],
        "default_fee_structure": {"fee_type": "fixed", "fee_fixed_amount": 0},
    },
    {
        "contract_type": "combination",
        "display_name": "Combination / Hybrid",
        "allowed_fields": ["component_breakdown"],
        "default_fee_structure": {},
    },
    {
        "contract_type": "remeasurement",
        "display_name": "Remeasurement",
        "allowed_fields": ["measurement_method", "qty_variance_threshold"],
        "default_fee_structure": {},
    },
]


# How each procurement route is named on a contract cover sheet. The stored
# value stays the machine code; this is only what the register shows.
_TYPE_LABELS: dict[str, str] = {
    "lump_sum": "Lump sum",
    "gmp": "Guaranteed maximum price",
    "cost_plus": "Cost plus fee",
    "tm": "Time and materials",
    "unit_price": "Unit price",
    "design_build": "Design and build",
}


_TYPE_DISTRIBUTION: list[str] = [
    "lump_sum",
    "lump_sum",
    "lump_sum",
    "gmp",
    "gmp",
    "cost_plus",
    "tm",
    "tm",
    "unit_price",
    "design_build",
]


async def seed_type_configurations(session: AsyncSession) -> int:
    """Insert ContractTypeConfiguration catalog rows if missing."""
    from sqlalchemy import select

    existing = (await session.execute(select(ContractTypeConfiguration.contract_type))).scalars().all()
    inserted = 0
    for cfg in _TYPE_CONFIG_CATALOG:
        if cfg["contract_type"] in existing:
            continue
        row = ContractTypeConfiguration(
            contract_type=cfg["contract_type"],  # type: ignore[arg-type]
            display_name=cfg["display_name"],  # type: ignore[arg-type]
            allowed_fields=cfg["allowed_fields"],
            default_fee_structure=cfg["default_fee_structure"],
            schema_version="1.0",
        )
        session.add(row)
        inserted += 1
    if inserted:
        await session.flush()
    return inserted


def _parse_seed_date(value: str | None) -> date | None:
    """Parse a contract date column (bare date or ISO datetime) to a date."""
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text).date()
    except ValueError:
        return None


def _month_starts(first: date, last: date) -> list[date]:
    """First-of-month dates from ``first``'s month through ``last``'s month."""
    out: list[date] = []
    cursor = first.replace(day=1)
    stop = last.replace(day=1)
    while cursor <= stop:
        out.append(cursor)
        cursor = (cursor + timedelta(days=32)).replace(day=1)
    return out


def _stamp(day: date, hour: int) -> str:
    """A business-hours ISO timestamp on ``day``."""
    return datetime(day.year, day.month, day.day, hour, 0, 0, tzinfo=UTC).isoformat()


#: How many claim periods a single contract materializes at most. Enough to
#: show the full lifecycle ladder without flooding an old contract's register.
_MAX_CLAIM_PERIODS = 6


async def seed_progress_claims_demo(
    session: AsyncSession,
    project_ids: list[uuid.UUID],
) -> dict[str, int]:
    """Backfill a staged progress-claim run onto claim-less live contracts.

    The demo installer authors each project's head contract and trade
    subcontracts but no payment history, so every register opened on an empty
    claims tab. For each ``active`` / ``completed`` contract of the given
    projects that still has no claims, this writes one claim per elapsed
    calendar month (capped at :data:`_MAX_CLAIM_PERIODS`, anchored on the
    contract's own start date): the oldest periods are paid, one sits at
    approval / certification, the latest full period is submitted and the
    running period is still a draft. Amounts are a plausible monthly slice of
    the contract value with the contract's own retention held, and the
    cumulative ``prior_claims_total`` re-adds exactly.

    Self-guarding and demo-safe by construction: a contract that already has
    any claim (seeded or user-written) is left alone, and the caller passes
    demo projects only. German-market projects (``country_code == "DE"``)
    number claims AZ-nn, the Abschlagszahlung convention their users expect;
    other markets keep PC-nnnn.

    Args:
        session: Open async DB session (the caller commits).
        project_ids: Projects whose contracts are eligible. Empty list is a
            no-op.

    Returns:
        Dict with ``claims_backfilled`` / ``contracts_backfilled`` counts.
    """
    if not project_ids:
        return {"claims_backfilled": 0, "contracts_backfilled": 0}

    from app.modules.projects.models import Project

    contracts = (
        (
            await session.execute(
                select(Contract)
                .where(Contract.project_id.in_(project_ids))
                .where(Contract.status.in_(("active", "completed")))
                .order_by(Contract.code)
            )
        )
        .scalars()
        .all()
    )
    if not contracts:
        return {"claims_backfilled": 0, "contracts_backfilled": 0}

    claimed_ids = set(
        (
            await session.execute(
                select(ProgressClaim.contract_id.distinct()).where(
                    ProgressClaim.contract_id.in_([c.id for c in contracts])
                )
            )
        )
        .scalars()
        .all()
    )

    german_rows = await session.execute(
        select(Project.id).where(Project.id.in_(project_ids)).where(Project.country_code == "DE")
    )
    german_projects = set(german_rows.scalars().all())

    today = datetime.now(UTC).date()
    claims_written = 0
    contracts_touched = 0

    for contract in contracts:
        if contract.id in claimed_ids:
            continue
        total_value = contract.total_value or Decimal("0")
        start = _parse_seed_date(contract.start_date)
        if total_value <= 0 or start is None or start >= today:
            continue

        end = _parse_seed_date(contract.end_date)
        contract_months = max(len(_month_starts(start, end)) if end and end > start else 12, 1)
        periods = _month_starts(start, today)[-_MAX_CLAIM_PERIODS:]
        if not periods:
            continue

        rng = random.Random(f"progress-claims:{contract.code}")
        retention_pct = (contract.retention_percent or Decimal("0")) / Decimal("100")
        monthly_base = total_value / Decimal(contract_months)

        # Lifecycle ladder, newest period first: the running month is still in
        # draft, the last full month is submitted, one is under approval or
        # certification, everything older is paid.
        ladder = ["draft", "submitted", rng.choice(("approved", "certified"))]
        statuses: list[str] = []
        for idx_from_end in range(len(periods)):
            statuses.append(ladder[idx_from_end] if idx_from_end < len(ladder) else "paid")
        statuses.reverse()
        if statuses[-1] == "draft" and len(statuses) == 1:
            # A register whose only claim is an untouched draft reads dead.
            statuses[-1] = "submitted"

        prior_total = Decimal("0.00")
        for seq, (period_start, status) in enumerate(zip(periods, statuses, strict=True), start=1):
            period_end = (period_start + timedelta(days=32)).replace(day=1) - timedelta(days=1)
            wobble = Decimal(str(rng.uniform(0.72, 1.28)))
            gross = (monthly_base * wobble).quantize(Decimal("1")) + Decimal("0.00")
            if gross <= 0:
                gross = Decimal("100.00")
            retention = (gross * retention_pct).quantize(Decimal("0.01"))

            # Never stamp a submission in the future: a contract young enough
            # to have only its running period gets "submitted today".
            submitted_day = min(period_end + timedelta(days=3), today)
            approved_day = submitted_day + timedelta(days=14)
            paid_day = approved_day + timedelta(days=12)
            is_submitted = status != "draft"
            is_approved = status in ("approved", "certified", "paid")

            number = f"AZ-{seq:02d}" if contract.project_id in german_projects else f"PC-{seq:04d}"
            session.add(
                ProgressClaim(
                    contract_id=contract.id,
                    claim_number=number,
                    period_start=period_start.isoformat(),
                    period_end=min(period_end, today).isoformat(),
                    claim_date=submitted_day.isoformat() if is_submitted else None,
                    gross_amount=gross,
                    retention_amount=retention,
                    prior_claims_total=prior_total,
                    net_due=gross - retention,
                    status=status,
                    submitted_at=_stamp(submitted_day, 10) if is_submitted else None,
                    approved_at=_stamp(approved_day, 14) if is_approved else None,
                    paid_at=_stamp(paid_day, 11) if status == "paid" else None,
                    currency=contract.currency or "",
                    metadata_=dict((contract.metadata_ or {}), seeded=True),
                )
            )
            prior_total += gross
            claims_written += 1
        contracts_touched += 1

    if claims_written:
        await session.flush()
        logger.info(
            "seed_progress_claims_demo: %d claims across %d contracts",
            claims_written,
            contracts_touched,
        )
    return {"claims_backfilled": claims_written, "contracts_backfilled": contracts_touched}


async def seed_contracts_demo(
    session: AsyncSession,
    project_ids: list[uuid.UUID],
) -> dict[str, int]:
    """Generate demo contracts and backfill claim runs onto authored ones.

    The 10-type catalog is fabricated round-robin, but only into projects
    that hold no contract yet: demo projects arrive with an authored head
    contract plus trade subcontracts, and those registers must not be
    diluted with generic filler. Afterwards
    :func:`seed_progress_claims_demo` gives every claim-less live contract
    of the given projects its staged payment history.

    Args:
        session: Open async DB session (the caller commits).
        project_ids: List of existing project UUIDs to distribute contracts to
            (round-robin). Empty list returns zero counts.

    Returns:
        Dict with counts: contracts, lines, claims, final_accounts,
        type_configs, fee_structures, gainshare_configs, claims_backfilled,
        contracts_backfilled.
    """
    if not project_ids:
        logger.info("seed_contracts_demo: no project_ids → skipping")
        return {
            "contracts": 0,
            "lines": 0,
            "claims": 0,
            "final_accounts": 0,
            "type_configs": 0,
            "fee_structures": 0,
            "gainshare_configs": 0,
            "claims_backfilled": 0,
            "contracts_backfilled": 0,
        }

    rng = random.Random(42)
    type_configs = await seed_type_configurations(session)

    # Contract codes are deterministic and the column is unique, so a second
    # run used to abort on the first duplicate rather than skip it. Re-seeding
    # is how the demo estate is refreshed, so it has to be a no-op here. The
    # existing codes are read once instead of probed per contract.
    existing_codes = set((await session.execute(select(Contract.code))).scalars().all())

    # Fabricate the catalog only into projects that own no contract at all.
    # The demo installer authors each demo project's own head contract and
    # subcontracts; those projects need the claim backfill below, not ten
    # more generic agreements on top of the authored register.
    occupied = set(
        (await session.execute(select(Contract.project_id.distinct()).where(Contract.project_id.in_(project_ids))))
        .scalars()
        .all()
    )
    empty_projects = [pid for pid in project_ids if pid not in occupied]

    contracts_count = 0
    lines_count = 0
    claims_count = 0
    final_account_count = 0
    fee_count = 0
    gainshare_count = 0

    for idx, c_type in enumerate(_TYPE_DISTRIBUTION):
        if not empty_projects:
            break
        project_id = empty_projects[idx % len(empty_projects)]
        code = f"CT-{idx + 1:03d}-{c_type.upper()[:3]}"
        if code in existing_codes:
            continue
        terms: dict[str, object] = {}
        if c_type == "gmp":
            terms = {
                "gmp_cap": str(Decimal("1000000") + idx * 100000),
                "target_cost": str(Decimal("900000") + idx * 100000),
                "gainshare_split_pct": "50",
            }
        elif c_type == "cost_plus":
            terms = {"fee_percent": "7.5"}
        elif c_type == "tm":
            terms = {"tm_nte_cap": str(Decimal("250000") + idx * 25000)}

        total_value = Decimal("100000") * (idx + 5)
        contract = Contract(
            code=code,
            title=f"{_TYPE_LABELS.get(c_type, c_type)} agreement {code}",
            contract_type=c_type,
            counterparty_type="subcontractor" if idx % 2 else "client",
            counterparty_id=uuid.uuid4(),
            project_id=project_id,
            total_value=total_value,
            currency="EUR",
            retention_percent=Decimal("5"),
            retention_release_event="practical_completion",
            status="active",
            terms=terms,
        )
        session.add(contract)
        await session.flush()
        contracts_count += 1

        # SoV lines (5-15 per contract)
        line_count = rng.randint(5, 15)
        for li in range(line_count):
            qty = Decimal(str(rng.randint(1, 500)))
            rate = Decimal(str(rng.randint(50, 5000)))
            session.add(
                ContractLine(
                    contract_id=contract.id,
                    code=f"{idx + 1:02d}.{li + 1:03d}",
                    description=f"{_TYPE_LABELS.get(c_type, c_type)} works, item {li + 1}",
                    line_type=rng.choice(
                        ("work", "material", "labor", "fee", "contingency"),
                    ),
                    unit=rng.choice(("m", "m2", "m3", "kg", "pcs", "lsum")),
                    quantity=qty,
                    unit_rate=rate,
                    total_value=qty * rate,
                    order_index=li,
                )
            )
            lines_count += 1

        # FeeStructure for cost_plus / tm / design_build
        if c_type in ("cost_plus", "tm", "design_build"):
            session.add(
                FeeStructure(
                    contract_id=contract.id,
                    fee_type="percent_of_cost",
                    fee_percent=Decimal("7.5") if c_type == "cost_plus" else Decimal("5"),
                    fee_fixed_amount=None,
                    max_fee=None,
                    sliding_scale=[],
                )
            )
            fee_count += 1

        # GainshareConfiguration for GMP
        if c_type == "gmp":
            session.add(
                GainshareConfiguration(
                    contract_id=contract.id,
                    target_cost=Decimal(terms.get("target_cost") or 0),  # type: ignore[arg-type]
                    gmp_cap=Decimal(terms.get("gmp_cap") or 0),  # type: ignore[arg-type]
                    savings_split_owner_pct=Decimal("50"),
                    savings_split_contractor_pct=Decimal("50"),
                    overrun_responsibility="contractor",
                )
            )
            gainshare_count += 1

        # RetentionSchedule
        session.add(
            RetentionSchedule(
                contract_id=contract.id,
                accrual_rule={"per_claim_percent": 5},
                release_rule={"on_event": "practical_completion"},
                notes="Standard 5% retention",
            )
        )

        # LDClause
        session.add(
            LDClause(
                contract_id=contract.id,
                per_day_amount=Decimal("500"),
                currency="EUR",
                max_amount=Decimal("50000"),
                enforcement_status="active",
            )
        )

        # 4 progress claims
        statuses = ("paid", "approved", "submitted", "draft")
        for ci, st in enumerate(statuses):
            gross = total_value * Decimal(str(0.1 * (ci + 1)))
            retention = gross * Decimal("0.05")
            session.add(
                ProgressClaim(
                    contract_id=contract.id,
                    claim_number=f"PC-{ci + 1:04d}",
                    period_start=f"2026-0{ci + 1}-01",
                    period_end=f"2026-0{ci + 1}-28",
                    claim_date=f"2026-0{ci + 1}-28",
                    gross_amount=gross,
                    retention_amount=retention,
                    prior_claims_total=gross * Decimal(str(ci)),
                    net_due=gross - retention,
                    status=st,
                    currency="EUR",
                )
            )
            claims_count += 1

        # Close two of the contracts with a FinalAccount
        if idx in (0, 5):
            paid_amount = total_value * Decimal("0.95")
            session.add(
                FinalAccount(
                    contract_id=contract.id,
                    final_contract_value=total_value,
                    total_paid=paid_amount,
                    retention_held=total_value * Decimal("0.05"),
                    retention_released=Decimal("0"),
                    final_balance=total_value - paid_amount,
                    sign_off_date="2026-12-31",
                    status="closed",
                    notes="Final account agreed, 5% retention held to defects liability expiry.",
                )
            )
            final_account_count += 1

    await session.flush()

    # Backfill staged claim runs onto every claim-less live contract of the
    # given projects - the authored demo contracts above all, which is what
    # makes the payment-application registers non-empty out of the box.
    backfill = await seed_progress_claims_demo(session, project_ids)

    logger.info(
        "seed_contracts_demo: %d contracts, %d lines, %d claims, %d final_accounts, %d type_configs, "
        "%d claims backfilled onto %d contracts",
        contracts_count,
        lines_count,
        claims_count,
        final_account_count,
        type_configs,
        backfill["claims_backfilled"],
        backfill["contracts_backfilled"],
    )
    return {
        "contracts": contracts_count,
        "lines": lines_count,
        "claims": claims_count,
        "final_accounts": final_account_count,
        "type_configs": type_configs,
        "fee_structures": fee_count,
        "gainshare_configs": gainshare_count,
        "claims_backfilled": backfill["claims_backfilled"],
        "contracts_backfilled": backfill["contracts_backfilled"],
    }

# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Formwork Pydantic schemas - request / response models.

Money fields use ``Decimal`` on input and ``str`` on output to match the
project's v3 §10 "Decimal as string" contract. Returning a float would
let JavaScript clients lose precision on large unit rates.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_serializer

# ── enum-like patterns ───────────────────────────────────────────────────

SYSTEM_TYPES = "wall|slab|column|beam|foundation|climbing|custom"
MATERIALS = "plywood|steel|aluminium|composite|timber|other"


def _money_to_str(v: Decimal | None) -> str | None:
    """Serialise a Decimal to a fixed 2-dp string (None → None)."""
    if v is None:
        return None
    # ``Decimal.quantize`` would round; we keep ``str()`` to preserve any
    # extra precision the DB rounded into the column itself.
    return format(Decimal(v), "f")


# ── FormworkSystem ───────────────────────────────────────────────────────


class FormworkSystemCreate(BaseModel):
    """Create a new formwork system catalogue row."""

    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(..., min_length=1, max_length=255)
    system_type: str = Field(default="wall", pattern=rf"^({SYSTEM_TYPES})$")
    supplier: str | None = Field(default=None, max_length=255)
    material: str = Field(default="plywood", pattern=rf"^({MATERIALS})$")
    reuses_max: int = Field(default=30, ge=1, le=10_000)
    unit_rate: Decimal = Field(default=Decimal("0"), ge=0)
    erect_strike_rate: Decimal = Field(default=Decimal("0"), ge=0)
    strip_time_days: int = Field(default=1, ge=0, le=365)
    currency: str = Field(default="", max_length=3)
    notes: str | None = None
    tenant_id: UUID | None = None


class FormworkSystemUpdate(BaseModel):
    """Partial update for a formwork system.

    Only the fields the caller actually sent are touched, so a nullable field
    can be cleared by sending it as ``null`` while an omitted field is left
    alone. Fields that are NOT NULL in the database (``name``, ``unit_rate``,
    ``strip_time_days``, ...) reject an explicit ``null`` at the service layer
    rather than writing one and failing at flush.
    """

    model_config = ConfigDict(str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=1, max_length=255)
    system_type: str | None = Field(default=None, pattern=rf"^({SYSTEM_TYPES})$")
    supplier: str | None = Field(default=None, max_length=255)
    material: str | None = Field(default=None, pattern=rf"^({MATERIALS})$")
    reuses_max: int | None = Field(default=None, ge=1, le=10_000)
    unit_rate: Decimal | None = Field(default=None, ge=0)
    erect_strike_rate: Decimal | None = Field(default=None, ge=0)
    strip_time_days: int | None = Field(default=None, ge=0, le=365)
    currency: str | None = Field(default=None, max_length=3)
    notes: str | None = None


class FormworkSystemResponse(BaseModel):
    """A formwork catalogue row as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    system_type: str
    supplier: str | None = None
    material: str
    reuses_max: int
    unit_rate: Decimal
    erect_strike_rate: Decimal
    strip_time_days: int
    currency: str
    notes: str | None = None
    tenant_id: UUID | None = None
    created_at: datetime
    updated_at: datetime

    @field_serializer("unit_rate", "erect_strike_rate")
    def _ser_money(self, v: Decimal) -> str:
        return _money_to_str(v)  # type: ignore[return-value]


class FormworkSystemSeedResult(BaseModel):
    """Response payload for ``POST /systems/seed-defaults``."""

    inserted: int
    skipped: int
    total_after: int


class FormworkSystemUsage(BaseModel):
    """How many priced assignments depend on one catalogue system.

    Read before deleting or re-rating a system: changing ``unit_rate`` moves
    every one of these totals, and deleting a system that is still in use is
    refused by the database (``ondelete="RESTRICT"``).
    """

    system_id: UUID
    assignment_count: int
    project_count: int
    total_area_m2: Decimal
    total_cost: Decimal

    @field_serializer("total_area_m2", "total_cost")
    def _ser_money(self, v: Decimal) -> str:
        return _money_to_str(v)  # type: ignore[return-value]


# ── FormworkAssignment ───────────────────────────────────────────────────


class FormworkAssignmentCreate(BaseModel):
    """Create a new formwork assignment.

    ``computed_unit_cost`` and ``computed_total`` are derived server-side
    from ``unit_rate`` × waste × reuse_count - they are NOT accepted in
    the request body even if the client sends them (they would be a lie
    until they go through the service-layer recomputation).
    """

    model_config = ConfigDict(str_strip_whitespace=True)

    project_id: UUID
    boq_position_id: UUID | None = None
    formwork_system_id: UUID
    area_m2: Decimal = Field(default=Decimal("0"), ge=0)
    reuse_count: int = Field(default=1, ge=1, le=10_000)
    waste_pct: Decimal = Field(default=Decimal("5.00"), ge=0, le=100)
    notes: str | None = None
    tenant_id: UUID | None = None


class FormworkAssignmentUpdate(BaseModel):
    """Partial update for a formwork assignment.

    ``exclude_unset`` semantics: an omitted field is untouched, an explicit
    ``null`` clears the nullable fields (``boq_position_id``, ``notes``). The
    NOT NULL fields refuse an explicit ``null`` at the service layer instead of
    writing one and failing at flush.
    """

    model_config = ConfigDict(str_strip_whitespace=True)

    boq_position_id: UUID | None = None
    formwork_system_id: UUID | None = None
    area_m2: Decimal | None = Field(default=None, ge=0)
    reuse_count: int | None = Field(default=None, ge=1, le=10_000)
    waste_pct: Decimal | None = Field(default=None, ge=0, le=100)
    notes: str | None = None


class FormworkAssignmentResponse(BaseModel):
    """A formwork assignment row as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    boq_position_id: UUID | None = None
    formwork_system_id: UUID
    area_m2: Decimal
    reuse_count: int
    waste_pct: Decimal
    computed_unit_cost: Decimal
    material_unit_cost: Decimal
    labour_unit_cost: Decimal
    computed_total: Decimal
    notes: str | None = None
    tenant_id: UUID | None = None
    created_at: datetime
    updated_at: datetime

    @field_serializer(
        "area_m2",
        "waste_pct",
        "computed_unit_cost",
        "material_unit_cost",
        "labour_unit_cost",
        "computed_total",
    )
    def _ser_money(self, v: Decimal) -> str:
        return _money_to_str(v)  # type: ignore[return-value]


class FormworkAssignmentDetail(FormworkAssignmentResponse):
    """An assignment plus the catalogue facts needed to read its rate.

    Returned by the list and detail endpoints so the client can show "Steel
    wall panel, steel, 100 reuses max, EUR" next to the computed rate without
    a second round trip per row. Populated from an eagerly loaded ``system``
    relationship, never from a lazy walk.
    """

    system_name: str = ""
    system_type: str = ""
    material: str = ""
    supplier: str | None = None
    reuses_max: int = 0
    system_unit_rate: Decimal = Decimal("0")
    erect_strike_rate: Decimal = Decimal("0")
    strip_time_days: int = 0
    currency: str = ""
    schedule_line_count: int = 0

    @field_serializer("system_unit_rate", "erect_strike_rate")
    def _ser_system_money(self, v: Decimal) -> str:
        return _money_to_str(v)  # type: ignore[return-value]


# ── FormworkScheduleLine ─────────────────────────────────────────────────


class FormworkScheduleLineCreate(BaseModel):
    """Append one pour-cycle line under a FormworkAssignment.

    ``project_id`` is derived from the parent assignment server-side, so
    callers do not need to (and should not) pass it.
    """

    model_config = ConfigDict(str_strip_whitespace=True)

    pour_no: int = Field(default=1, ge=1, le=10_000)
    pour_date: date | None = None
    level_label: str = Field(default="", max_length=120)
    area_m2: Decimal = Field(default=Decimal("0"), ge=0)
    notes: str | None = None


class FormworkScheduleLineUpdate(BaseModel):
    """Partial update for a pour-cycle schedule line.

    ``project_id`` and ``assignment_id`` are immutable (a line cannot be
    moved to a different parent), so they are deliberately absent here.
    """

    model_config = ConfigDict(str_strip_whitespace=True)

    pour_no: int | None = Field(default=None, ge=1, le=10_000)
    pour_date: date | None = None
    level_label: str | None = Field(default=None, max_length=120)
    area_m2: Decimal | None = Field(default=None, ge=0)
    notes: str | None = None


class FormworkScheduleLineResponse(BaseModel):
    """A pour-cycle schedule line as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    assignment_id: UUID
    pour_no: int
    pour_date: date | None = None
    level_label: str
    area_m2: Decimal
    notes: str | None = None
    created_at: datetime
    updated_at: datetime

    @field_serializer("area_m2")
    def _ser_area(self, v: Decimal) -> str:
        return _money_to_str(v)  # type: ignore[return-value]


# ── Cycle analysis ───────────────────────────────────────────────────────


class FormworkCycleConflict(BaseModel):
    """Two consecutive pours the same panel set cannot physically serve.

    Raised when the gap between pour dates is shorter than the system's
    ``strip_time_days``: the concrete has not gained enough strength to strike
    the panels, so they are not available for the next lift.
    """

    from_pour_no: int
    to_pour_no: int
    gap_days: int
    required_days: int


class FormworkCycleAnalysis(BaseModel):
    """What the pour schedule says about an assignment's reuse economics.

    The panel set the contractor has to buy or hire is the LARGEST single
    pour, not the total. Forming ``total_pour_area_m2`` with a
    ``peak_pour_area_m2`` set means the set turns around
    ``total / peak`` times, and that ratio - floored to a whole use - is the
    honest reuse count to amortise the panel rate over.

    ``derived_reuse_count`` is deliberately the FLOOR of the ratio. Rounding
    up would divide the panel cost by a turnaround the programme does not
    actually deliver, which under-prices the job; rounding down is the
    conservative direction.
    """

    assignment_id: UUID
    pour_count: int
    total_pour_area_m2: Decimal
    peak_pour_area_m2: Decimal
    reuse_ratio: Decimal
    derived_reuse_count: int
    current_reuse_count: int
    current_area_m2: Decimal
    reuses_max: int
    strip_time_days: int
    min_gap_days: int | None = None
    conflicts: list[FormworkCycleConflict] = Field(default_factory=list)
    dated_pour_count: int = 0
    # True when the assignment as typed already matches what the schedule
    # supports, so ``derive-from-schedule`` would be a no-op.
    in_sync: bool = False

    @field_serializer(
        "total_pour_area_m2",
        "peak_pour_area_m2",
        "reuse_ratio",
        "current_area_m2",
    )
    def _ser_qty(self, v: Decimal) -> str:
        return _money_to_str(v)  # type: ignore[return-value]


class FormworkDeriveResult(BaseModel):
    """Outcome of writing the schedule-derived figures onto an assignment."""

    assignment: FormworkAssignmentResponse
    analysis: FormworkCycleAnalysis
    changed: bool


# ── Re-pricing ───────────────────────────────────────────────────────────


class FormworkRepriceResult(BaseModel):
    """How many assignments a catalogue change actually moved.

    ``repriced`` counts rows whose stored total changed; ``unchanged`` counts
    rows that were recomputed and came out identical. The two together are the
    number of assignments examined, so a caller can tell "nothing depended on
    that system" from "everything depended on it and nothing moved".
    """

    examined: int
    repriced: int
    unchanged: int
    delta_total: Decimal = Decimal("0")

    @field_serializer("delta_total")
    def _ser_money(self, v: Decimal) -> str:
        return _money_to_str(v)  # type: ignore[return-value]


class FormworkSystemUpdateResult(BaseModel):
    """Response for ``PATCH /systems/{id}``: the row plus what it moved.

    Editing a catalogue rate re-prices every assignment derived from it, so
    the response says how many. Returning only the system would leave the
    caller unaware that the edit just changed the formwork total on other
    people's projects.
    """

    system: FormworkSystemResponse
    reprice: FormworkRepriceResult


# ── Project rollup ───────────────────────────────────────────────────────


class FormworkTypeBreakdown(BaseModel):
    """One ``system_type`` bucket of a project's formwork spend."""

    system_type: str
    assignment_count: int
    area_m2: Decimal
    total: Decimal
    share_pct: Decimal

    @field_serializer("area_m2", "total", "share_pct")
    def _ser_money(self, v: Decimal) -> str:
        return _money_to_str(v)  # type: ignore[return-value]


class FormworkProjectSummary(BaseModel):
    """The formwork numbers a quantity surveyor wants on one screen.

    ``single_use_total`` is what the same areas would cost priced as if every
    pour needed brand-new panels (reuse count 1). The difference against
    ``total_cost`` is ``amortisation_saving`` - the money the reuse assumption
    is claiming, and therefore the number that has to survive review.

    ``currency`` is blank and ``currency_mixed`` is true when the assignments
    resolve to more than one catalogue currency; the totals are then a plain
    sum of unlike units and must not be shown as money until the mix is fixed.
    """

    project_id: UUID
    assignment_count: int
    system_count: int
    total_area_m2: Decimal
    total_cost: Decimal
    material_cost: Decimal
    labour_cost: Decimal
    average_unit_cost: Decimal
    single_use_total: Decimal
    amortisation_saving: Decimal
    amortisation_saving_pct: Decimal
    unlinked_to_boq: int
    currency: str = ""
    currency_mixed: bool = False
    by_system_type: list[FormworkTypeBreakdown] = Field(default_factory=list)

    @field_serializer(
        "total_area_m2",
        "total_cost",
        "material_cost",
        "labour_cost",
        "average_unit_cost",
        "single_use_total",
        "amortisation_saving",
        "amortisation_saving_pct",
    )
    def _ser_money(self, v: Decimal) -> str:
        return _money_to_str(v)  # type: ignore[return-value]


# ── Validation ───────────────────────────────────────────────────────────


class FormworkFinding(BaseModel):
    """One failing formwork validation rule, ready for the UI.

    ``key`` is a stable i18n key (``formwork.validation.<rule_id>``) and
    ``context`` carries the numbers the message interpolates, so the same
    finding renders in every locale without the backend formatting prose.
    """

    rule_id: str
    severity: str
    category: str
    message: str
    key: str
    element_ref: str | None = None
    suggestion: str | None = None
    context: dict[str, Any] = Field(default_factory=dict)


class FormworkValidationReport(BaseModel):
    """Result of running the ``formwork`` rule set over one scope."""

    target_type: str
    target_id: UUID | None = None
    status: str
    error_count: int
    warning_count: int
    info_count: int
    passed_count: int
    findings: list[FormworkFinding] = Field(default_factory=list)
    # Rule sets that were requested but resolved to zero registered rules.
    # Non-empty means validation did NOT run, which is not the same as passing.
    unsupported_rule_sets: list[str] = Field(default_factory=list)


# ── helpers ──────────────────────────────────────────────────────────────


def default_seed_systems() -> list[dict[str, Any]]:
    """Return the catalogue of starter formwork systems.

    Idempotent insert (``/systems/seed-defaults``) walks this list and
    skips any name that already exists for the calling tenant. Currency
    deliberately left blank so each tenant can localise on first use.

    Every row carries all three rate drivers, because a starter catalogue
    that only fills ``unit_rate`` teaches the wrong habit: the erect-and-strike
    labour is paid on every use and dominates the rate once the panels have
    been amortised over a few dozen lifts. Slab systems carry the long strip
    times (props stay in until the slab carries itself); wall and column
    systems strike the next day.

    The figures are order-of-magnitude starting points for a first estimate,
    not quotations - every tenant re-rates them against its own hire terms.
    """
    return [
        {
            "name": "Steel framed wall panel",
            "system_type": "wall",
            "supplier": None,
            "material": "steel",
            "reuses_max": 100,
            "unit_rate": Decimal("65.00"),
            "erect_strike_rate": Decimal("16.00"),
            "strip_time_days": 1,
        },
        {
            "name": "Aluminium slab deck panel",
            "system_type": "slab",
            "supplier": None,
            "material": "aluminium",
            "reuses_max": 80,
            "unit_rate": Decimal("48.00"),
            "erect_strike_rate": Decimal("13.00"),
            "strip_time_days": 7,
        },
        {
            "name": "Steel wall panel, single-side tie",
            "system_type": "wall",
            "supplier": None,
            "material": "steel",
            "reuses_max": 100,
            "unit_rate": Decimal("70.00"),
            "erect_strike_rate": Decimal("14.00"),
            "strip_time_days": 1,
        },
        {
            "name": "Aluminium drophead slab panel",
            "system_type": "slab",
            "supplier": None,
            "material": "aluminium",
            "reuses_max": 80,
            "unit_rate": Decimal("52.00"),
            "erect_strike_rate": Decimal("12.00"),
            "strip_time_days": 7,
        },
        {
            "name": "Heavy-duty steel wall panel",
            "system_type": "wall",
            "supplier": None,
            "material": "steel",
            "reuses_max": 100,
            "unit_rate": Decimal("68.00"),
            "erect_strike_rate": Decimal("15.00"),
            "strip_time_days": 1,
        },
        {
            "name": "Crane-set steel wall panel",
            "system_type": "wall",
            "supplier": None,
            "material": "steel",
            "reuses_max": 100,
            "unit_rate": Decimal("60.00"),
            "erect_strike_rate": Decimal("16.00"),
            "strip_time_days": 1,
        },
        {
            "name": "Girder wall formwork",
            "system_type": "wall",
            "supplier": None,
            "material": "steel",
            "reuses_max": 100,
            "unit_rate": Decimal("58.00"),
            "erect_strike_rate": Decimal("17.00"),
            "strip_time_days": 1,
        },
        {
            "name": "Self-climbing core system",
            "system_type": "climbing",
            "supplier": None,
            "material": "steel",
            "reuses_max": 50,
            "unit_rate": Decimal("120.00"),
            "erect_strike_rate": Decimal("28.00"),
            "strip_time_days": 3,
        },
        {
            "name": "Generic plywood + studs",
            "system_type": "custom",
            "supplier": None,
            "material": "plywood",
            "reuses_max": 8,
            "unit_rate": Decimal("18.00"),
            "erect_strike_rate": Decimal("22.00"),
            "strip_time_days": 2,
        },
        {
            "name": "Generic timber forms",
            "system_type": "foundation",
            "supplier": None,
            "material": "timber",
            "reuses_max": 5,
            "unit_rate": Decimal("14.00"),
            "erect_strike_rate": Decimal("19.00"),
            "strip_time_days": 1,
        },
    ]

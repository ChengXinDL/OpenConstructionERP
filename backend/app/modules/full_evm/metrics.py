# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Decimal-exact Earned Value Management kernel for the Full EVM register.

Pure functions, no database, no HTTP, no locale. Everything a caller needs to
turn the four base observations (BAC, PV, EV, AC) into the full standard EVM
metric set, with every division-by-zero case answered explicitly.

Relationship to :mod:`app.modules.eac.evm`
------------------------------------------
:mod:`app.modules.eac.evm` is the in-memory EVM calculator the rules engine
uses. This kernel deliberately does **not** re-invent its vocabulary: the EAC
method names (:data:`EAC_METHODS`) and the plain-language metric glossary
(:data:`METRIC_GLOSSARY`) are imported from it, so there is exactly one place
where "combined" means "cost and schedule both persist".

What differs is the numeric contract, and it differs on purpose. That module
returns dimensionless indices as ``float`` and derives ``EAC = BAC / CPI`` by
routing the float CPI back through ``Decimal(str(cpi))``. That is fine for a
transient calculation, but this module *persists* an auditable register that
finance and dispute teams read back months later, so money here is never
computed through a float. Every EAC variant is algebraically rewritten so the
rounded index never enters the money path at all::

    EAC(cpi)      = BAC / CPI              = BAC * AC / EV
    EAC(combined) = AC + (BAC-EV)/(CPI*SPI) = AC + (BAC-EV) * AC * PV / EV**2

Both identities hold because ``CPI = EV / AC`` and ``SPI = EV / PV`` by
definition. The right-hand forms contain only exact money terms, so a stored
CPI rounded to six decimal places can never move the forecast.

Undefined is not zero
---------------------
Early in a project ``AC``, ``PV`` and ``EV`` are all legitimately zero. A ratio
whose denominator is zero is *undefined*, and this kernel returns ``None`` for
it rather than ``0`` (which reads as "catastrophically inefficient") or
infinity (which is not representable in the register). ``None`` survives all
the way to a NULL column and to a ``null`` on the wire, so a consumer can tell
"not measurable yet" from "measured, and bad".

Currency neutrality
-------------------
No currency is assumed and no minor-unit count is hardcoded. Money is rounded
to a caller-supplied ``quantum`` (see :func:`quantum_for_minor_units`), so a
zero-decimal currency and a three-decimal currency are both exactly
representable.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any

# Method names and glossary are shared with the rules-engine calculator so the
# two surfaces cannot drift apart. See the module docstring for why the maths
# itself is not shared.
from app.modules.eac.evm import EAC_METHODS, METRIC_GLOSSARY

__all__ = [
    "DEFAULT_MONEY_QUANTUM",
    "EAC_METHODS",
    "MAX_MINOR_UNITS",
    "METRIC_GLOSSARY",
    "RATIO_QUANTUM",
    "EvmMetrics",
    "compute_metrics",
    "eac_variants",
    "quantize_money",
    "quantize_ratio",
    "quantum_for_minor_units",
    "to_decimal",
]

ZERO = Decimal("0")
ONE = Decimal("1")

#: Storage precision for dimensionless indices - mirrors ``Numeric(12, 6)``.
RATIO_QUANTUM = Decimal("0.000001")

#: Money rounding step when the caller does not name one (two minor units).
DEFAULT_MONEY_QUANTUM = Decimal("0.01")

#: Largest minor-unit count we accept. Four covers every ISO 4217 currency in
#: use (three minor units is the real maximum) and matches ``Numeric(18, 4)``.
MAX_MINOR_UNITS = 4


def quantum_for_minor_units(minor_units: int) -> Decimal:
    """Return the money rounding step for a currency's minor-unit count.

    Args:
        minor_units: Number of decimal places the currency uses. ``0`` for a
            zero-decimal currency, ``2`` for most, ``3`` for a few.

    Returns:
        The rounding step, e.g. ``Decimal("0.01")`` for ``minor_units=2``.

    Raises:
        ValueError: If ``minor_units`` is negative or above
            :data:`MAX_MINOR_UNITS`, which would not fit the storage column.
    """
    if minor_units < 0 or minor_units > MAX_MINOR_UNITS:
        msg = f"minor_units must be between 0 and {MAX_MINOR_UNITS}, got {minor_units}."
        raise ValueError(msg)
    return ONE.scaleb(-minor_units)


def to_decimal(value: Any, *, field: str = "value") -> Decimal:
    """Coerce a money-like input to a finite :class:`~decimal.Decimal`.

    Floats are routed through ``str`` so binary representation noise never
    enters a money amount. ``None`` becomes zero, which is the meaningful
    default for an unreported cumulative total.

    Args:
        value: Number, numeric string, ``Decimal`` or ``None``.
        field: Field name used in the error message so a bad input is
            attributable.

    Returns:
        The value as an exact ``Decimal``.

    Raises:
        ValueError: If the value is not numeric, or is NaN / infinity. A
            non-finite amount must never reach the register: it would poison
            every downstream sum silently.
    """
    if value is None:
        return ZERO
    try:
        result = value if isinstance(value, Decimal) else Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as exc:
        msg = f"{field} is not a valid amount: {value!r}. Provide a number such as 1200.50."
        raise ValueError(msg) from exc
    if not result.is_finite():
        msg = f"{field} must be a finite amount, got {value!r}."
        raise ValueError(msg)
    return result


def quantize_money(value: Decimal | None, quantum: Decimal = DEFAULT_MONEY_QUANTUM) -> Decimal | None:
    """Round a money amount to the currency's minor unit, passing ``None`` through."""
    if value is None:
        return None
    return value.quantize(quantum, rounding=ROUND_HALF_UP)


def quantize_ratio(value: Decimal | None) -> Decimal | None:
    """Round a dimensionless index to :data:`RATIO_QUANTUM`, passing ``None`` through."""
    if value is None:
        return None
    return value.quantize(RATIO_QUANTUM, rounding=ROUND_HALF_UP)


def _ratio(numerator: Decimal, denominator: Decimal) -> Decimal | None:
    """Divide, returning ``None`` instead of raising when the denominator is zero."""
    if denominator == ZERO:
        return None
    return numerator / denominator


# ── EAC variants ─────────────────────────────────────────────────────────────


def eac_variants(
    *,
    bac: Decimal,
    pv: Decimal,
    ev: Decimal,
    ac: Decimal,
    quantum: Decimal = DEFAULT_MONEY_QUANTUM,
) -> dict[str, Decimal | None]:
    """Compute every supported Estimate At Completion side by side.

    The three variants are the standard ones and they *disagree* by design,
    which is why they are returned together rather than one being picked
    silently:

    ``remaining``
        ``EAC = AC + (BAC - EV)``. The overspend so far was a one-off; the
        remaining work still runs to budget. Always defined.
    ``cpi``
        ``EAC = BAC / CPI``, evaluated exactly as ``BAC * AC / EV``. The cost
        performance seen so far continues to the end. Undefined until some
        value has been earned (``EV = 0``), because there is no cost trend yet.
    ``combined``
        ``EAC = AC + (BAC - EV) / (CPI * SPI)``, evaluated exactly as
        ``AC + (BAC - EV) * AC * PV / EV**2``. Being behind schedule is
        expected to keep pushing cost up, so both indices shape the remaining
        work. Undefined when ``EV = 0`` (no cost trend) or ``PV = 0`` (nothing
        was scheduled yet, so there is no schedule trend either).

    Args:
        bac: Budget At Completion.
        pv: Planned Value to date (cumulative).
        ev: Earned Value to date (cumulative).
        ac: Actual Cost to date (cumulative).
        quantum: Money rounding step.

    Returns:
        Mapping of variant name to amount, ``None`` where the variant is not
        computable from the data available.
    """
    remaining = ac + (bac - ev)

    # EAC = BAC / CPI with CPI = EV / AC. Rewritten so no rounded index is
    # ever divided by. Undefined when nothing has been earned yet.
    eac_cpi = None if ev == ZERO else bac * ac / ev

    # EAC = AC + (BAC - EV) / (CPI * SPI) with CPI = EV / AC and SPI = EV / PV.
    eac_combined = None if ev == ZERO or pv == ZERO else ac + (bac - ev) * ac * pv / (ev * ev)

    return {
        "remaining": quantize_money(remaining, quantum),
        "cpi": quantize_money(eac_cpi, quantum),
        "combined": quantize_money(eac_combined, quantum),
    }


# Degradation ladder per requested formula, and the single source of truth for
# it in this module: the legacy forecast path in ``service.py`` imports this
# rather than keeping its own copy. Two ladders that drift apart would answer
# the same question two ways inside one module - with ``PV = 0`` and ``EV > 0``,
# ``combined`` cannot run but ``cpi`` still can, and a ladder that skipped
# straight to ``remaining`` would report a different EAC than the legacy
# surface from identical inputs.
#
# A formula whose divisor is zero cannot run, so the walk goes down to the next
# formula that can - never sideways into a richer one the caller did not ask
# for. ``remaining`` is always computable and therefore always terminates it.
EAC_FALLBACK_LADDER: dict[str, tuple[str, ...]] = {
    "auto": ("combined", "cpi", "remaining"),
    "combined": ("combined", "cpi", "remaining"),
    "cpi": ("cpi", "remaining"),
    "remaining": ("remaining",),
}


def _select_eac(
    method: str,
    variants: dict[str, Decimal | None],
) -> tuple[str, Decimal | None]:
    """Resolve a requested EAC method to the variant actually used.

    The requested name selects a rung of :data:`EAC_FALLBACK_LADDER` and the
    walk takes the first variant whose inputs exist. ``auto`` starts at the
    richest formula; a named method starts at itself and degrades only towards
    simpler formulas, so asking for ``cpi`` can never silently return the
    combined index. Either way the *effective* name comes back with the value,
    so a register row can record which formula produced its number instead of
    implying the requested one did.

    Args:
        method: One of :data:`EAC_METHODS`.
        variants: Output of :func:`eac_variants`.

    Returns:
        ``(effective_method, amount)``.

    Raises:
        ValueError: If ``method`` is not a supported name. An unrecognised
            method must be rejected rather than quietly treated as the default,
            because the difference between the variants is the whole point.
    """
    if method not in EAC_METHODS:
        allowed = ", ".join(EAC_METHODS)
        msg = f"Unknown EAC method {method!r}. Choose one of: {allowed}."
        raise ValueError(msg)

    for candidate in EAC_FALLBACK_LADDER[method]:
        value = variants.get(candidate)
        if value is not None:
            return candidate, value

    # Every rung was undefined, which for a real ladder means EV = 0 on a
    # project that has only just started. ``remaining`` needs no division and
    # is the honest answer; naming it beats storing a null EAC.
    return "remaining", variants["remaining"]


# ── Full metric set ──────────────────────────────────────────────────────────


@dataclass(frozen=True)
class EvmMetrics:
    """The complete EVM metric set for one measurement date.

    Money fields are :class:`~decimal.Decimal`. Dimensionless indices are
    ``Decimal`` or ``None``, where ``None`` means *undefined* (a zero
    denominator), never *zero*.
    """

    # Observations, echoed back so a row is self-contained.
    bac: Decimal
    pv: Decimal
    ev: Decimal
    ac: Decimal

    # Performance to date.
    sv: Decimal
    cv: Decimal
    spi: Decimal | None
    cpi: Decimal | None
    percent_complete: Decimal | None
    percent_spent: Decimal | None

    # Forecast.
    eac_method_requested: str
    eac_method_effective: str
    eac: Decimal | None
    etc: Decimal | None
    vac: Decimal | None
    tcpi_bac: Decimal | None
    tcpi_eac: Decimal | None
    eac_variants: dict[str, Decimal | None]

    def to_dict(self) -> dict[str, Any]:
        """Render as a JSON-safe dict with money and indices as strings.

        Decimal money is serialised as a string per the project's money-on-the-
        wire convention, so a JavaScript client cannot silently lose precision.
        ``None`` stays ``None`` and becomes a JSON ``null``.
        """

        def s(value: Decimal | None) -> str | None:
            return None if value is None else str(value)

        return {
            "bac": s(self.bac),
            "pv": s(self.pv),
            "ev": s(self.ev),
            "ac": s(self.ac),
            "sv": s(self.sv),
            "cv": s(self.cv),
            "spi": s(self.spi),
            "cpi": s(self.cpi),
            "percent_complete": s(self.percent_complete),
            "percent_spent": s(self.percent_spent),
            "eac_method_requested": self.eac_method_requested,
            "eac_method_effective": self.eac_method_effective,
            "eac": s(self.eac),
            "etc": s(self.etc),
            "vac": s(self.vac),
            "tcpi_bac": s(self.tcpi_bac),
            "tcpi_eac": s(self.tcpi_eac),
            "eac_variants": {name: s(value) for name, value in self.eac_variants.items()},
        }


def compute_metrics(
    *,
    bac: Any,
    pv: Any,
    ev: Any,
    ac: Any,
    method: str = "auto",
    quantum: Decimal = DEFAULT_MONEY_QUANTUM,
) -> EvmMetrics:
    """Compute the full EVM metric set from the four base observations.

    Formulas, all standard:

    * ``SV  = EV - PV`` and ``CV = EV - AC`` (money, always defined).
    * ``SPI = EV / PV``, undefined while nothing has been scheduled.
    * ``CPI = EV / AC``, undefined while nothing has been spent.
    * ``EAC`` per :func:`eac_variants`, selected per ``method``.
    * ``ETC = EAC - AC`` and ``VAC = BAC - EAC``.
    * ``TCPI to BAC = (BAC - EV) / (BAC - AC)``, undefined once the budget is
      exactly consumed.
    * ``TCPI to EAC = (BAC - EV) / (EAC - AC)``, undefined when no further
      spend is forecast.

    Args:
        bac: Budget At Completion. Money.
        pv: Planned Value to date, cumulative. Money.
        ev: Earned Value to date, cumulative. Money.
        ac: Actual Cost to date, cumulative. Money.
        method: Which EAC formula to headline; one of :data:`EAC_METHODS`.
        quantum: Money rounding step for the derived amounts.

    Returns:
        The populated :class:`EvmMetrics`.

    Raises:
        ValueError: If any amount is non-numeric, non-finite or negative, or
            if ``method`` is not a supported name. Negative cumulative money is
            rejected rather than clamped, because a negative BAC or AC is a
            data-entry fault whose silent correction would produce a plausible
            but wrong forecast.
    """
    amounts = {
        "BAC": to_decimal(bac, field="BAC"),
        "PV": to_decimal(pv, field="PV"),
        "EV": to_decimal(ev, field="EV"),
        "AC": to_decimal(ac, field="AC"),
    }
    for name, amount in amounts.items():
        if amount < ZERO:
            msg = f"{name} cannot be negative (got {amount}); it is a cumulative money total."
            raise ValueError(msg)

    bac_d = amounts["BAC"]
    pv_d = amounts["PV"]
    ev_d = amounts["EV"]
    ac_d = amounts["AC"]

    variants = eac_variants(bac=bac_d, pv=pv_d, ev=ev_d, ac=ac_d, quantum=quantum)
    effective, eac = _select_eac(method, variants)

    etc = None if eac is None else eac - ac_d
    vac = None if eac is None else bac_d - eac
    remaining_work = bac_d - ev_d
    tcpi_bac = _ratio(remaining_work, bac_d - ac_d)
    tcpi_eac = None if eac is None else _ratio(remaining_work, eac - ac_d)

    return EvmMetrics(
        bac=quantize_money(bac_d, quantum),  # type: ignore[arg-type]
        pv=quantize_money(pv_d, quantum),  # type: ignore[arg-type]
        ev=quantize_money(ev_d, quantum),  # type: ignore[arg-type]
        ac=quantize_money(ac_d, quantum),  # type: ignore[arg-type]
        sv=quantize_money(ev_d - pv_d, quantum),  # type: ignore[arg-type]
        cv=quantize_money(ev_d - ac_d, quantum),  # type: ignore[arg-type]
        spi=quantize_ratio(_ratio(ev_d, pv_d)),
        cpi=quantize_ratio(_ratio(ev_d, ac_d)),
        percent_complete=quantize_ratio(_ratio(ev_d, bac_d)),
        percent_spent=quantize_ratio(_ratio(ac_d, bac_d)),
        eac_method_requested=method,
        eac_method_effective=effective,
        eac=quantize_money(eac, quantum),
        etc=quantize_money(etc, quantum),
        vac=quantize_money(vac, quantum),
        tcpi_bac=quantize_ratio(tcpi_bac),
        tcpi_eac=quantize_ratio(tcpi_eac),
        eac_variants=variants,
    )

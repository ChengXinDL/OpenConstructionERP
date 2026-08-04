# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Rate resolution for assembly money, bridging the project override and ``oe_fx``.

An assembly prices a recipe in one currency and is placed into projects that may
keep their books in another. Two call sites need the same answer - the
apply-template preview and apply-to-BOQ - and both used to consult only
``Project.fx_rates``, a hand-typed JSON column that is empty on a default
project. When it held nothing they kept the foreign number and carried on, which
is how a figure in one currency reached a total labelled with another.

Resolution order, and why it is this order:

1. ``Project.fx_rates`` - a rate an estimator typed against this project. It is
   usually a contractually fixed rate, so it outranks any market feed: a
   contract does not stop applying because the ECB moved. Consulted only when
   the target IS the project's base currency, because the column's documented
   convention is "base units per 1 unit of the foreign currency" and using it in
   the other direction would invert the rate without raising.
2. ``oe_fx`` - the platform's rate register, which degrades on its own from the
   applicable rate set to the legacy cache to a bundled seed, and reports which
   of the three it used.
3. Nothing. The caller must then refuse to present a converted figure rather
   than pass the unconverted one off as converted.

Step 2 is the new one; step 1 is untouched, so a project that converts today
converts to the same number tomorrow.

Rates are resolved once per request into an :class:`FxContext` and the per-pair
maths is pure, so a preview over many components costs one register read rather
than one per component.
"""

import logging
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# Provenance markers. Every converted figure records which of these priced it,
# so a number can always be traced back to the rate that produced it.
FX_SOURCE_IDENTITY = "identity"
FX_SOURCE_PROJECT = "project_fx_rates"
FX_SOURCE_REGISTER = "oe_fx"


def _norm(code: object) -> str:
    """Normalise a currency code to trimmed upper case (``""`` when absent)."""
    return str(code or "").strip().upper()


def _positive_decimal(raw: object) -> Decimal | None:
    """Parse ``raw`` into a finite, strictly positive Decimal, else ``None``.

    ``Decimal("NaN")`` and ``Decimal("Infinity")`` parse without raising, so the
    finiteness check is not redundant with the try/except around it.
    """
    if raw is None:
        return None
    try:
        value = Decimal(str(raw))
    except (InvalidOperation, ValueError, TypeError):
        return None
    if not value.is_finite() or value <= 0:
        return None
    return value


@dataclass(frozen=True)
class FxContext:
    """One request's resolved rate sources, ready to price any pair.

    Attributes:
        project_base: The project's base currency, or ``""`` when it has none.
        project_rates: ``{code: rate-string}`` from ``Project.fx_rates``, giving
            base units per 1 unit of the foreign currency.
        register_rates: ``{code: units-per-register-base}`` from ``oe_fx``.
        register_base: The base ``register_rates`` is quoted against.
        register_provenance: JSON-safe provenance for ``register_rates``.
    """

    project_base: str = ""
    project_rates: dict[str, str] = field(default_factory=dict)
    register_rates: dict[str, Decimal] = field(default_factory=dict)
    register_base: str = ""
    register_provenance: dict[str, Any] = field(default_factory=dict)

    def rate(self, from_currency: object, to_currency: object) -> tuple[Decimal | None, dict[str, Any]]:
        """Resolve the multiplier turning a ``from_currency`` amount into ``to_currency``.

        Args:
            from_currency: ISO 4217 code the amount is currently in.
            to_currency: ISO 4217 code the amount must end up in.

        Returns:
            ``(rate, provenance)``. ``rate`` is ``None`` when no source can price
            the pair; the caller must not emit a converted figure in that case.
            ``provenance`` always names the source used, or why none applied.
        """
        src = _norm(from_currency)
        dst = _norm(to_currency)
        if not src or not dst:
            return None, {"fx_source": "", "reason": "missing_currency", "from": src, "to": dst}
        if src == dst:
            return Decimal("1"), {"fx_source": FX_SOURCE_IDENTITY, "rate": "1", "from": src, "to": dst}

        if self.project_base and dst == self.project_base:
            override = _positive_decimal(self.project_rates.get(src))
            if override is not None:
                return override, {
                    "fx_source": FX_SOURCE_PROJECT,
                    "rate": str(override),
                    "from": src,
                    "to": dst,
                }

        register_rate = self._register_rate(src, dst)
        if register_rate is None:
            return None, {"fx_source": "", "reason": "no_rate", "from": src, "to": dst}
        # The register's own provenance goes first so the four keys below always
        # win. ``fx_source`` names the MECHANISM that priced the pair; the feed
        # the register answered from is ``fx_feed``, which is why
        # ``_register_provenance`` renames it rather than prefixing it into a
        # collision with this one.
        return register_rate, {
            **self.register_provenance,
            "fx_source": FX_SOURCE_REGISTER,
            "rate": str(register_rate),
            "from": src,
            "to": dst,
        }

    def _register_rate(self, src: str, dst: str) -> Decimal | None:
        """Cross ``src`` into ``dst`` through the register's base, or ``None``."""
        if not self.register_base:
            return None
        from app.modules.fx.service import UnknownCurrencyError, cross_rate

        try:
            crossed = cross_rate(src, dst, self.register_rates, base_currency=self.register_base)
        except UnknownCurrencyError:
            # One side of the pair is neither the register's base nor quoted in
            # it. There is no rate, which is a different thing from a bad one.
            return None
        return _positive_decimal(crossed)


async def load_fx_context(session: AsyncSession | None, project: object | None) -> FxContext:
    """Resolve every rate source this request may need, once.

    Args:
        session: Session used to read the ``oe_fx`` register. ``None`` still
            resolves, against the bundled seed alone.
        project: Project whose ``fx_rates`` override takes precedence.

    Returns:
        The populated context. Never raises: a source that cannot be read is
        simply absent from the context, and the caller sees that as "no rate"
        rather than as a failed request.
    """
    from app.modules.boq.service import _project_fx_map

    project_base = _norm(getattr(project, "currency", None))
    project_rates = _project_fx_map(project) if project is not None else {}

    resolved = await _resolve_register(session)
    if resolved is None:
        return FxContext(project_base=project_base, project_rates=project_rates)

    return FxContext(
        project_base=project_base,
        project_rates=project_rates,
        register_rates=dict(resolved.rates),
        register_base=_norm(resolved.base_currency),
        register_provenance=_register_provenance(resolved),
    )


async def _resolve_register(session: AsyncSession | None):  # noqa: ANN201 - fx type is imported lazily
    """Read the ``oe_fx`` rate map, degrading to the bundled seed on a DB error.

    The register read runs inside a SAVEPOINT: an installation whose ``oe_fx``
    tables have not been migrated yet would otherwise leave the caller's
    transaction in a failed state, turning a missing rate table into a failed
    apply rather than an unconverted one.
    """
    from app.modules.fx.service import FxService

    if session is not None:
        try:
            async with session.begin_nested():
                return await FxService(session).resolve_rates()
        except Exception:  # noqa: BLE001 - register unreadable; the seed still prices majors
            logger.warning("oe_fx register unreadable, falling back to bundled seed rates", exc_info=True)

    try:
        return await FxService(None).resolve_rates()
    except Exception:  # noqa: BLE001 - no rate source at all; callers refuse to convert
        logger.warning("oe_fx seed rates unavailable, assemblies cannot convert", exc_info=True)
        return None


def _register_provenance(resolved: Any) -> dict[str, Any]:
    """JSON-safe provenance for a resolved rate set.

    ``resolved`` is an ``oe_fx`` ``ResolvedRates``, typed loosely because this
    module imports ``app.modules.fx`` inside the function rather than at module
    scope - assemblies must load when the FX module is absent. ``Any`` rather
    than ``object`` because the ``hasattr`` guards below are the real narrowing:
    ``object`` makes a checker flag the very attribute reads those guards exist
    to protect, which reads as a missing narrowing rather than a deliberate one.

    ``ResolvedRates.provenance()`` carries ``date`` / ``datetime`` objects, which
    a JSONB position-metadata column cannot store as they stand.

    Its ``source`` names the FEED the register answered from (the ECB, the
    legacy cache, the bundled seed). That is a different question from which
    mechanism priced the pair, which is what callers read ``fx_source`` for, so
    it is emitted as ``fx_feed`` - prefixing it would silently overwrite the
    mechanism marker with the feed name.
    """
    raw = resolved.provenance() if hasattr(resolved, "provenance") else {}
    out: dict[str, Any] = {}
    for key, value in raw.items():
        name = "fx_feed" if key == "source" else f"fx_{key}"
        out[name] = value.isoformat() if hasattr(value, "isoformat") else value
    note = resolved.coverage_note() if hasattr(resolved, "coverage_note") else ""
    if note:
        out["fx_coverage_note"] = note
    return out

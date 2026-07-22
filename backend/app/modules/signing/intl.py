# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Localized labels for the e-signature registry vocabularies.

Pure, dependency-free label lookups for the signature-capability and
session-status code sets so the ``/meta`` endpoint can hand the UI
pre-translated pickers. English is the fallback for any locale or code not in
the table - a missing translation degrades to a readable English label, never a
raw code. Mirrors :mod:`app.modules.credentials.intl`.
"""

from __future__ import annotations

_SUPPORTED = ("en", "de", "es", "ru")


def _normalize_locale(locale: str | None) -> str:
    if not locale:
        return "en"
    base = locale.replace("_", "-").split("-", 1)[0].lower()
    return base if base in _SUPPORTED else "en"


_CAPABILITY_LABELS: dict[str, dict[str, str]] = {
    "qualified_electronic": {
        "en": "Qualified electronic signature",
        "de": "Qualifizierte elektronische Signatur",
        "es": "Firma electrónica cualificada",
        "ru": "Квалифицированная электронная подпись",
    },
    "advanced_electronic": {
        "en": "Advanced electronic signature",
        "de": "Fortgeschrittene elektronische Signatur",
        "es": "Firma electrónica avanzada",
        "ru": "Усиленная электронная подпись",
    },
    "simple_electronic": {
        "en": "Simple electronic signature",
        "de": "Einfache elektronische Signatur",
        "es": "Firma electrónica simple",
        "ru": "Простая электронная подпись",
    },
    "digital_certificate": {
        "en": "Digital-certificate signature",
        "de": "Signatur mit digitalem Zertifikat",
        "es": "Firma con certificado digital",
        "ru": "Подпись цифровым сертификатом",
    },
}

_STATUS_LABELS: dict[str, dict[str, str]] = {
    "draft": {
        "en": "Draft",
        "de": "Entwurf",
        "es": "Borrador",
        "ru": "Черновик",
    },
    "awaiting_signatures": {
        "en": "Awaiting signatures",
        "de": "Warten auf Unterschriften",
        "es": "Esperando firmas",
        "ru": "Ожидает подписей",
    },
    "partially_signed": {
        "en": "Partially signed",
        "de": "Teilweise unterzeichnet",
        "es": "Parcialmente firmado",
        "ru": "Частично подписан",
    },
    "fully_signed": {
        "en": "Fully signed",
        "de": "Vollständig unterzeichnet",
        "es": "Totalmente firmado",
        "ru": "Полностью подписан",
    },
    "declined": {
        "en": "Declined",
        "de": "Abgelehnt",
        "es": "Rechazado",
        "ru": "Отклонён",
    },
    "expired": {
        "en": "Expired",
        "de": "Abgelaufen",
        "es": "Vencido",
        "ru": "Истёк",
    },
}


def _label(code: str | None, locale: str | None, table: dict[str, dict[str, str]]) -> str:
    loc = _normalize_locale(locale)
    entry = table.get(code or "")
    if entry is None:
        # Unknown code: humanise it rather than leak the raw token.
        return (code or "").replace("_", " ").title()
    return entry.get(loc) or entry.get("en") or (code or "")


def describe_capability(code: str | None, locale: str | None = None) -> str:
    """Localized label for a signature-capability code."""
    return _label(code, locale, _CAPABILITY_LABELS)


def describe_status(code: str | None, locale: str | None = None) -> str:
    """Localized label for a session-status code."""
    return _label(code, locale, _STATUS_LABELS)


__all__ = ["describe_capability", "describe_status"]

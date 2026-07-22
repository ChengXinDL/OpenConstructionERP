# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Localized labels for the authority-submission vocabularies.

Pure, dependency-free label lookups for the format-family and status code sets,
so the ``/meta`` endpoint can hand the UI pre-translated pickers. English is the
fallback for any locale or code not in the table - a missing translation
degrades to a readable English label, never a raw code. Mirrors the house style
of :mod:`app.modules.credentials.intl`.
"""

from __future__ import annotations

_SUPPORTED = ("en", "de", "es", "ru")


def _normalize_locale(locale: str | None) -> str:
    if not locale:
        return "en"
    base = locale.replace("_", "-").split("-", 1)[0].lower()
    return base if base in _SUPPORTED else "en"


_FORMAT_LABELS: dict[str, dict[str, str]] = {
    "minstroy_xml": {
        "en": "Minstroy expertise XML",
        "de": "Minstroy-Prüf-XML",
        "es": "XML de peritaje Minstroy",
        "ru": "XML экспертизы Минстрой",
    },
    "gaeb_x83": {
        "en": "Tender exchange (GAEB X83)",
        "de": "Ausschreibung (GAEB X83)",
        "es": "Intercambio de licitación (GAEB X83)",
        "ru": "Обмен тендером (GAEB X83)",
    },
    "cobie": {
        "en": "Asset handover (COBie)",
        "de": "Anlagenübergabe (COBie)",
        "es": "Entrega de activos (COBie)",
        "ru": "Передача активов (COBie)",
    },
    "eplan": {
        "en": "Electronic plan submission",
        "de": "Elektronische Planeinreichung",
        "es": "Envío de plano electrónico",
        "ru": "Электронная подача плана",
    },
    "generic_xml": {
        "en": "Generic XML document",
        "de": "Generisches XML-Dokument",
        "es": "Documento XML genérico",
        "ru": "Универсальный XML-документ",
    },
    "custom": {
        "en": "Custom format",
        "de": "Benutzerdefiniertes Format",
        "es": "Formato personalizado",
        "ru": "Пользовательский формат",
    },
}

_STATUS_LABELS: dict[str, dict[str, str]] = {
    "draft": {
        "en": "Draft",
        "de": "Entwurf",
        "es": "Borrador",
        "ru": "Черновик",
    },
    "validated": {
        "en": "Validated",
        "de": "Validiert",
        "es": "Validado",
        "ru": "Проверен",
    },
    "signed_pending": {
        "en": "Awaiting signature",
        "de": "Signatur ausstehend",
        "es": "Pendiente de firma",
        "ru": "Ожидает подписи",
    },
    "submitted": {
        "en": "Submitted",
        "de": "Eingereicht",
        "es": "Enviado",
        "ru": "Подан",
    },
    "accepted": {
        "en": "Accepted",
        "de": "Angenommen",
        "es": "Aceptado",
        "ru": "Принят",
    },
    "rejected": {
        "en": "Rejected",
        "de": "Abgelehnt",
        "es": "Rechazado",
        "ru": "Отклонён",
    },
}


def _label(code: str | None, locale: str | None, table: dict[str, dict[str, str]]) -> str:
    loc = _normalize_locale(locale)
    entry = table.get(code or "")
    if entry is None:
        # Unknown code: humanise it rather than leak the raw token.
        return (code or "").replace("_", " ").title()
    return entry.get(loc) or entry.get("en") or (code or "")


def describe_format(code: str | None, locale: str | None = None) -> str:
    """Localized label for a format-family code."""
    return _label(code, locale, _FORMAT_LABELS)


def describe_status(code: str | None, locale: str | None = None) -> str:
    """Localized label for a submission-status code."""
    return _label(code, locale, _STATUS_LABELS)


__all__ = ["describe_format", "describe_status"]

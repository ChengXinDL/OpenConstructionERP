# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Localized labels for the source-data register vocabularies.

Pure, dependency-free label lookups for the document-type and status code sets,
so the ``/meta`` endpoint can hand the UI pre-translated pickers. English is the
fallback for any locale or code not in the table - a missing translation
degrades to a readable English label, never a raw code. Mirrors the house style
of :mod:`app.modules.credentials.intl`.
"""

from __future__ import annotations

# Base language of a locale string ("de-AT" -> "de"). Kept tiny and pure.
_SUPPORTED = ("en", "de", "es", "ru")


def _normalize_locale(locale: str | None) -> str:
    if not locale:
        return "en"
    base = locale.replace("_", "-").split("-", 1)[0].lower()
    return base if base in _SUPPORTED else "en"


_TYPE_LABELS: dict[str, dict[str, str]] = {
    "permit": {
        "en": "Permit",
        "de": "Genehmigung",
        "es": "Permiso",
        "ru": "Разрешение",
    },
    "survey": {
        "en": "Survey",
        "de": "Vermessung",
        "es": "Levantamiento",
        "ru": "Изыскание",
    },
    "geotech": {
        "en": "Geotechnical report",
        "de": "Baugrundgutachten",
        "es": "Informe geotécnico",
        "ru": "Геотехнический отчёт",
    },
    "tech_conditions": {
        "en": "Technical conditions",
        "de": "Technische Anschlussbedingungen",
        "es": "Condiciones técnicas",
        "ru": "Технические условия",
    },
    "title_deed": {
        "en": "Title deed",
        "de": "Eigentumsnachweis",
        "es": "Título de propiedad",
        "ru": "Право собственности",
    },
    "approval": {
        "en": "Approval",
        "de": "Freigabe",
        "es": "Aprobación",
        "ru": "Согласование",
    },
    "technical_spec": {
        "en": "Technical specification",
        "de": "Technische Spezifikation",
        "es": "Especificación técnica",
        "ru": "Техническое задание",
    },
    "other": {
        "en": "Other",
        "de": "Sonstige",
        "es": "Otro",
        "ru": "Другое",
    },
}

_STATUS_LABELS: dict[str, dict[str, str]] = {
    "requested": {
        "en": "Requested",
        "de": "Angefordert",
        "es": "Solicitado",
        "ru": "Запрошен",
    },
    "received": {
        "en": "Received",
        "de": "Erhalten",
        "es": "Recibido",
        "ru": "Получен",
    },
    "verified": {
        "en": "Verified",
        "de": "Geprüft",
        "es": "Verificado",
        "ru": "Проверен",
    },
    "expiring_soon": {
        "en": "Expiring soon",
        "de": "Läuft bald ab",
        "es": "Vence pronto",
        "ru": "Скоро истекает",
    },
    "expired": {
        "en": "Expired",
        "de": "Abgelaufen",
        "es": "Vencido",
        "ru": "Истёк",
    },
    "superseded": {
        "en": "Superseded",
        "de": "Ersetzt",
        "es": "Reemplazado",
        "ru": "Заменён",
    },
}


def _label(code: str | None, locale: str | None, table: dict[str, dict[str, str]]) -> str:
    loc = _normalize_locale(locale)
    entry = table.get(code or "")
    if entry is None:
        # Unknown code: humanise it rather than leak the raw token.
        return (code or "").replace("_", " ").title()
    return entry.get(loc) or entry.get("en") or (code or "")


def describe_type(code: str | None, locale: str | None = None) -> str:
    """Localized label for a source-document-type code."""
    return _label(code, locale, _TYPE_LABELS)


def describe_status(code: str | None, locale: str | None = None) -> str:
    """Localized label for a source-document-status code."""
    return _label(code, locale, _STATUS_LABELS)


__all__ = ["describe_status", "describe_type"]

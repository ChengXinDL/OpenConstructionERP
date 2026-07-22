# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Localized labels for the site-supervision vocabularies.

Pure, dependency-free label lookups for the discipline, visit-status,
entry-category and entry-status code sets, so the ``/meta`` endpoint can hand
the UI pre-translated pickers. English is the fallback for any locale or code
not in the table - a missing translation degrades to a readable English label,
never a raw code. Mirrors the house style of :mod:`app.modules.credentials.intl`.
"""

from __future__ import annotations

_SUPPORTED = ("en", "de", "es", "ru")


def _normalize_locale(locale: str | None) -> str:
    if not locale:
        return "en"
    base = locale.replace("_", "-").split("-", 1)[0].lower()
    return base if base in _SUPPORTED else "en"


_DISCIPLINE_LABELS: dict[str, dict[str, str]] = {
    "architecture": {
        "en": "Architecture",
        "de": "Architektur",
        "es": "Arquitectura",
        "ru": "Архитектура",
    },
    "structure": {
        "en": "Structure",
        "de": "Tragwerk",
        "es": "Estructura",
        "ru": "Конструкции",
    },
    "mep": {
        "en": "MEP",
        "de": "TGA",
        "es": "Instalaciones",
        "ru": "Инженерные системы",
    },
    "geotech": {
        "en": "Geotechnical",
        "de": "Geotechnik",
        "es": "Geotecnia",
        "ru": "Геотехника",
    },
    "general": {
        "en": "General",
        "de": "Allgemein",
        "es": "General",
        "ru": "Общий",
    },
    "other": {
        "en": "Other",
        "de": "Sonstige",
        "es": "Otro",
        "ru": "Другое",
    },
}

_VISIT_STATUS_LABELS: dict[str, dict[str, str]] = {
    "planned": {
        "en": "Planned",
        "de": "Geplant",
        "es": "Planificada",
        "ru": "Запланирован",
    },
    "conducted": {
        "en": "Conducted",
        "de": "Durchgeführt",
        "es": "Realizada",
        "ru": "Проведён",
    },
    "reported": {
        "en": "Reported",
        "de": "Berichtet",
        "es": "Informada",
        "ru": "Оформлен",
    },
}

_CATEGORY_LABELS: dict[str, dict[str, str]] = {
    "conformance": {
        "en": "Conformance",
        "de": "Konformität",
        "es": "Conformidad",
        "ru": "Соответствие",
    },
    "deviation": {
        "en": "Deviation",
        "de": "Abweichung",
        "es": "Desviación",
        "ru": "Отклонение",
    },
    "hidden_works": {
        "en": "Hidden works",
        "de": "Verdeckte Arbeiten",
        "es": "Trabajos ocultos",
        "ru": "Скрытые работы",
    },
    "instruction": {
        "en": "Instruction",
        "de": "Anweisung",
        "es": "Instrucción",
        "ru": "Предписание",
    },
    "motivated_refusal": {
        "en": "Motivated refusal",
        "de": "Begründete Ablehnung",
        "es": "Rechazo motivado",
        "ru": "Мотивированный отказ",
    },
}

_ENTRY_STATUS_LABELS: dict[str, dict[str, str]] = {
    "open": {
        "en": "Open",
        "de": "Offen",
        "es": "Abierta",
        "ru": "Открыта",
    },
    "addressed": {
        "en": "Addressed",
        "de": "Bearbeitet",
        "es": "Atendida",
        "ru": "Устранена",
    },
    "refused_motivated": {
        "en": "Refused (motivated)",
        "de": "Begründet abgelehnt",
        "es": "Rechazada (motivada)",
        "ru": "Мотивированный отказ",
    },
    "closed": {
        "en": "Closed",
        "de": "Geschlossen",
        "es": "Cerrada",
        "ru": "Закрыта",
    },
}


def _label(code: str | None, locale: str | None, table: dict[str, dict[str, str]]) -> str:
    loc = _normalize_locale(locale)
    entry = table.get(code or "")
    if entry is None:
        # Unknown code: humanise it rather than leak the raw token.
        return (code or "").replace("_", " ").title()
    return entry.get(loc) or entry.get("en") or (code or "")


def describe_discipline(code: str | None, locale: str | None = None) -> str:
    """Localized label for a discipline code."""
    return _label(code, locale, _DISCIPLINE_LABELS)


def describe_visit_status(code: str | None, locale: str | None = None) -> str:
    """Localized label for a visit-status code."""
    return _label(code, locale, _VISIT_STATUS_LABELS)


def describe_category(code: str | None, locale: str | None = None) -> str:
    """Localized label for an entry-category code."""
    return _label(code, locale, _CATEGORY_LABELS)


def describe_entry_status(code: str | None, locale: str | None = None) -> str:
    """Localized label for an entry-status code."""
    return _label(code, locale, _ENTRY_STATUS_LABELS)


__all__ = [
    "describe_category",
    "describe_discipline",
    "describe_entry_status",
    "describe_visit_status",
]

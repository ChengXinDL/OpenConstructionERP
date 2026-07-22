# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Localized labels for the work-type route classifier vocabularies.

Pure, dependency-free label lookups for the work-type and route code sets, so
the ``/meta`` / ``/work-types`` / ``/route-options`` endpoints can hand the UI
pre-translated pickers. English is the fallback for any locale or code not in
the table - a missing translation degrades to a readable English label, never a
raw code. Mirrors the house style of :mod:`app.modules.credentials.intl`.
"""

from __future__ import annotations

# Base language of a locale string ("de-AT" -> "de"). Kept tiny and pure.
_SUPPORTED = ("en", "de", "es", "ru")


def _normalize_locale(locale: str | None) -> str:
    if not locale:
        return "en"
    base = locale.replace("_", "-").split("-", 1)[0].lower()
    return base if base in _SUPPORTED else "en"


_WORK_TYPE_LABELS: dict[str, dict[str, str]] = {
    "new_build": {
        "en": "New build",
        "de": "Neubau",
        "es": "Obra nueva",
        "ru": "Новое строительство",
    },
    "reconstruction": {
        "en": "Reconstruction",
        "de": "Umbau",
        "es": "Reconstrucción",
        "ru": "Реконструкция",
    },
    "capital_repair": {
        "en": "Capital repair",
        "de": "Grundinstandsetzung",
        "es": "Reparación mayor",
        "ru": "Капитальный ремонт",
    },
    "re_equipment": {
        "en": "Re-equipment",
        "de": "Umrüstung",
        "es": "Reequipamiento",
        "ru": "Техническое перевооружение",
    },
    "maintenance": {
        "en": "Maintenance",
        "de": "Instandhaltung",
        "es": "Mantenimiento",
        "ru": "Текущий ремонт",
    },
    "demolition": {
        "en": "Demolition",
        "de": "Abbruch",
        "es": "Demolición",
        "ru": "Снос",
    },
    "change_of_use": {
        "en": "Change of use",
        "de": "Nutzungsänderung",
        "es": "Cambio de uso",
        "ru": "Изменение назначения",
    },
    "other": {
        "en": "Other",
        "de": "Sonstige",
        "es": "Otro",
        "ru": "Другое",
    },
}

_ROUTE_LABELS: dict[str, dict[str, str]] = {
    "full_permit": {
        "en": "Full permit",
        "de": "Vollständige Genehmigung",
        "es": "Permiso completo",
        "ru": "Полное разрешение",
    },
    "notification": {
        "en": "Notification",
        "de": "Anzeigeverfahren",
        "es": "Notificación",
        "ru": "Уведомление",
    },
    "permitted_development": {
        "en": "Permitted development",
        "de": "Genehmigungsfreies Vorhaben",
        "es": "Desarrollo permitido",
        "ru": "Разрешённое использование",
    },
    "exempt": {
        "en": "Exempt",
        "de": "Genehmigungsfrei",
        "es": "Exento",
        "ru": "Без разрешения",
    },
    "expertise_required": {
        "en": "Expertise required",
        "de": "Gutachten erforderlich",
        "es": "Requiere peritaje",
        "ru": "Требуется экспертиза",
    },
    "undetermined": {
        "en": "Undetermined",
        "de": "Unbestimmt",
        "es": "Sin determinar",
        "ru": "Не определено",
    },
}


def _label(code: str | None, locale: str | None, table: dict[str, dict[str, str]]) -> str:
    loc = _normalize_locale(locale)
    entry = table.get(code or "")
    if entry is None:
        # Unknown code: humanise it rather than leak the raw token.
        return (code or "").replace("_", " ").title()
    return entry.get(loc) or entry.get("en") or (code or "")


def describe_work_type(code: str | None, locale: str | None = None) -> str:
    """Localized label for a work-type code."""
    return _label(code, locale, _WORK_TYPE_LABELS)


def describe_route(code: str | None, locale: str | None = None) -> str:
    """Localized label for a delivery / permit route code."""
    return _label(code, locale, _ROUTE_LABELS)


__all__ = ["describe_route", "describe_work_type"]

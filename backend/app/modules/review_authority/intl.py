# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Localized labels for the review-authority vocabularies.

Pure, dependency-free label lookups for the authority-kind, cycle-status and
remark-classification code sets, so the ``/meta`` endpoint can hand the UI
pre-translated pickers. English is the fallback for any locale or code not in
the table - a missing translation degrades to a readable English label, never a
raw code. Mirrors the house style of :mod:`app.modules.credentials.intl`.
"""

from __future__ import annotations

_SUPPORTED = ("en", "de", "es", "ru")


def _normalize_locale(locale: str | None) -> str:
    if not locale:
        return "en"
    base = locale.replace("_", "-").split("-", 1)[0].lower()
    return base if base in _SUPPORTED else "en"


_AUTHORITY_KIND_LABELS: dict[str, dict[str, str]] = {
    "state_expertise": {
        "en": "State expertise",
        "de": "Staatliche Prüfung",
        "es": "Peritaje estatal",
        "ru": "Государственная экспертиза",
    },
    "building_control": {
        "en": "Building control",
        "de": "Bauaufsicht",
        "es": "Control de edificación",
        "ru": "Строительный надзор",
    },
    "ahj": {
        "en": "Authority having jurisdiction",
        "de": "Zuständige Behörde",
        "es": "Autoridad competente",
        "ru": "Уполномоченный орган",
    },
    "technical_review": {
        "en": "Technical review",
        "de": "Technische Prüfung",
        "es": "Revisión técnica",
        "ru": "Технический контроль",
    },
    "other": {
        "en": "Other",
        "de": "Sonstige",
        "es": "Otro",
        "ru": "Другое",
    },
}

_CYCLE_STATUS_LABELS: dict[str, dict[str, str]] = {
    "draft": {"en": "Draft", "de": "Entwurf", "es": "Borrador", "ru": "Черновик"},
    "submitted": {"en": "Submitted", "de": "Eingereicht", "es": "Enviado", "ru": "Подано"},
    "under_review": {
        "en": "Under review",
        "de": "In Prüfung",
        "es": "En revisión",
        "ru": "На рассмотрении",
    },
    "remarks_issued": {
        "en": "Remarks issued",
        "de": "Anmerkungen erhalten",
        "es": "Observaciones emitidas",
        "ru": "Замечания выданы",
    },
    "responding": {
        "en": "Responding",
        "de": "In Beantwortung",
        "es": "Respondiendo",
        "ru": "Устранение",
    },
    "resubmitted": {
        "en": "Resubmitted",
        "de": "Erneut eingereicht",
        "es": "Reenviado",
        "ru": "Повторно подано",
    },
    "approved": {"en": "Approved", "de": "Genehmigt", "es": "Aprobado", "ru": "Согласовано"},
    "rejected": {"en": "Rejected", "de": "Abgelehnt", "es": "Rechazado", "ru": "Отклонено"},
    "withdrawn": {"en": "Withdrawn", "de": "Zurückgezogen", "es": "Retirado", "ru": "Отозвано"},
}

_CLASSIFICATION_LABELS: dict[str, dict[str, str]] = {
    "has_norm_ref": {
        "en": "Norm reference cited",
        "de": "Normbezug vorhanden",
        "es": "Referencia normativa citada",
        "ru": "Со ссылкой на норму",
    },
    "no_norm_ref_contestable": {
        "en": "No norm reference (contestable)",
        "de": "Kein Normbezug (anfechtbar)",
        "es": "Sin referencia normativa (impugnable)",
        "ru": "Без ссылки на норму (оспоримо)",
    },
    "clarification": {
        "en": "Clarification",
        "de": "Klarstellung",
        "es": "Aclaración",
        "ru": "Уточнение",
    },
    "defect": {"en": "Defect", "de": "Mangel", "es": "Defecto", "ru": "Дефект"},
}


def _label(code: str | None, locale: str | None, table: dict[str, dict[str, str]]) -> str:
    loc = _normalize_locale(locale)
    entry = table.get(code or "")
    if entry is None:
        return (code or "").replace("_", " ").title()
    return entry.get(loc) or entry.get("en") or (code or "")


def describe_authority_kind(code: str | None, locale: str | None = None) -> str:
    """Localized label for an authority-kind code."""
    return _label(code, locale, _AUTHORITY_KIND_LABELS)


def describe_cycle_status(code: str | None, locale: str | None = None) -> str:
    """Localized label for a cycle-status code."""
    return _label(code, locale, _CYCLE_STATUS_LABELS)


def describe_classification(code: str | None, locale: str | None = None) -> str:
    """Localized label for a remark-classification code."""
    return _label(code, locale, _CLASSIFICATION_LABELS)


__all__ = [
    "describe_authority_kind",
    "describe_classification",
    "describe_cycle_status",
]

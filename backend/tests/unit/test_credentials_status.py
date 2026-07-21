# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Pure status derivation and label localization for the credentials registry.

Pins the jurisdiction-neutral status maths: a perpetual credential stays active,
the reminder window is inclusive on the boundary day, an expired window flips to
expired, and manual suspended/revoked states are preserved by the auto-derive
path. Also checks the /meta label lookups localise with an English fallback and
never leak a raw code. No DB, no clock.
"""

from __future__ import annotations

from datetime import date, timedelta

from app.modules.credentials import intl
from app.modules.credentials.service import recompute_status

_TODAY = date(2026, 7, 21)


# ── recompute_status ───────────────────────────────────────────────────────


def test_perpetual_credential_is_active() -> None:
    assert recompute_status(_TODAY, None, 30) == "active"


def test_far_future_is_active() -> None:
    assert recompute_status(_TODAY, _TODAY + timedelta(days=200), 30) == "active"


def test_within_window_is_expiring_soon() -> None:
    assert recompute_status(_TODAY, _TODAY + timedelta(days=15), 30) == "expiring_soon"


def test_boundary_day_is_inclusive() -> None:
    # Exactly notify_days_before out already counts as expiring_soon.
    assert recompute_status(_TODAY, _TODAY + timedelta(days=30), 30) == "expiring_soon"


def test_past_valid_until_is_expired() -> None:
    assert recompute_status(_TODAY, _TODAY - timedelta(days=1), 30) == "expired"


def test_expiry_day_itself_is_expiring_not_expired() -> None:
    # today == valid_until: still valid today, so expiring_soon, not expired.
    assert recompute_status(_TODAY, _TODAY, 30) == "expiring_soon"


def test_manual_states_are_preserved() -> None:
    # Even with an expired window, a manual state is not auto-overwritten.
    assert recompute_status(_TODAY, _TODAY - timedelta(days=5), 30, current_status="suspended") == "suspended"
    assert recompute_status(_TODAY, _TODAY + timedelta(days=5), 30, current_status="revoked") == "revoked"


def test_zero_notify_window_only_flags_on_expiry_day() -> None:
    assert recompute_status(_TODAY, _TODAY + timedelta(days=1), 0) == "active"
    assert recompute_status(_TODAY, _TODAY, 0) == "expiring_soon"


# ── intl labels ────────────────────────────────────────────────────────────


def test_type_labels_localise() -> None:
    assert intl.describe_type("professional_license", "en") == "Professional licence"
    assert intl.describe_type("professional_license", "ru") == "Профессиональная лицензия"
    assert intl.describe_type("professional_license", "de") == "Berufszulassung"


def test_status_labels_localise() -> None:
    assert intl.describe_status("expiring_soon", "es") == "Vence pronto"
    assert intl.describe_status("revoked", "de") == "Widerrufen"


def test_unknown_locale_falls_back_to_english() -> None:
    assert intl.describe_type("certification", "zz") == "Certification"
    assert intl.describe_type("certification", None) == "Certification"


def test_unknown_code_is_humanised_not_raw() -> None:
    # A pack-introduced code with no translation degrades to a readable label.
    assert intl.describe_type("site_welfare_ticket", "en") == "Site Welfare Ticket"

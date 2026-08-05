# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""The shipped statutory payment regimes, and an idempotent seeder for them.

This is where the law is written down. Every number here is a statutory default
and every entry names the sections it came from, because the one question a
quantity surveyor will ask about a computed date is which provision produced
it. Nothing here is a house rule.

Two modelling decisions run through the whole table and are worth stating once
rather than eight times.

**The due date and the final date for payment are different dates, and only the
UK Act genuinely splits them.** The UK Act makes a sum fall due, then gives a
further period before it must be paid, and the notice deadlines hang off both.
The security-of-payment statutes have one date: the progress payment "becomes
due and payable" a set number of days after the claim. Those regimes are
therefore written with the due date on the application date and the statutory
period as the final date for payment, which is what the statute actually
imposes - a last day to pay - and which keeps the final date after the due date
in every regime shipped.

**A null deadline means the statute is silent, which is not the same as zero.**
Malaysia leaves the payment period to the contract and the EU Late Payment
Directive has no notice sequence at all. The rules skip what the regime does
not set rather than treating it as an instant deadline.

Seed data lives here and not in a migration on purpose: a migration is a
schema change that runs once per deployment, and this table is content that
will be corrected as statutes are amended.
"""

from __future__ import annotations

import logging
from decimal import Decimal
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


PAYMENT_REGIMES: tuple[dict[str, Any], ...] = (
    {
        "code": "uk_hgcra",
        "jurisdiction": "United Kingdom",
        "country_code": "GB",
        "statute": "Housing Grants, Construction and Regeneration Act 1996",
        "statute_reference": (
            "sections 110, 110A, 110B and 111, as amended by the Local Democracy, Economic Development "
            "and Construction Act 2009; default periods from the Scheme for Construction Contracts"
        ),
        "due_date_basis": "period_end",
        "due_date_days": 7,
        "due_date_day_basis": "calendar",
        "payment_notice_basis": "due_date",
        "payment_notice_days": 5,
        "payment_notice_day_basis": "calendar",
        "final_date_basis": "due_date",
        "final_date_days": 17,
        "final_date_day_basis": "calendar",
        "pay_less_days": 7,
        "pay_less_day_basis": "calendar",
        "no_notice_effect": "applied_sum_becomes_notified_sum",
        "interest_basis": "reference_rate_plus_margin",
        "interest_reference_rate": "Bank of England base rate",
        "interest_margin_percent": Decimal("8.000"),
        "interest_fixed_percent": None,
        "interest_statute": "Late Payment of Commercial Debts (Interest) Act 1998",
        "notes": (
            "The periods are the Scheme's defaults and apply where the contract does not provide "
            "compliant ones; a contract may set shorter periods but may not remove the sequence. Under "
            "section 111 the notified sum must be paid in full by the final date unless a valid pay-less "
            "notice was served in time, and where the payer served no payment notice the sum the payee "
            "applied for is the notified sum. Section 110B lets the payee serve its own default payment "
            "notice when the payer missed the deadline, which postpones the final date for payment by the "
            "days between the missed deadline and that notice."
        ),
    },
    {
        "code": "ie_cca_2013",
        "jurisdiction": "Ireland",
        "country_code": "IE",
        "statute": "Construction Contracts Act 2013",
        "statute_reference": "section 4 and the Schedule",
        "due_date_basis": "application_date",
        "due_date_days": 0,
        "due_date_day_basis": "calendar",
        "payment_notice_basis": "application_date",
        "payment_notice_days": 21,
        "payment_notice_day_basis": "calendar",
        "final_date_basis": "application_date",
        "final_date_days": 30,
        "final_date_day_basis": "calendar",
        "pay_less_days": None,
        "pay_less_day_basis": "calendar",
        "no_notice_effect": "applied_sum_becomes_notified_sum",
        "interest_basis": "reference_rate_plus_margin",
        "interest_reference_rate": "European Central Bank main refinancing rate",
        "interest_margin_percent": Decimal("8.000"),
        "interest_fixed_percent": None,
        "interest_statute": "European Communities (Late Payment in Commercial Transactions) Regulations 2012",
        "notes": (
            "The Act does not split a due date from a final date the way the UK Act does, so the payment "
            "claim date is taken as the due date and the Act's thirty-day limit as the final date for "
            "payment. The response to a payment claim notice must state the amount proposed to be paid "
            "and the reason for any difference from the amount claimed; there is no separate pay-less "
            "notice. Unpaid amounts carry a right to suspend."
        ),
    },
    {
        "code": "au_nsw_sopa",
        "jurisdiction": "New South Wales, Australia",
        "country_code": "AU",
        "statute": "Building and Construction Industry Security of Payment Act 1999 (NSW)",
        "statute_reference": "sections 11, 13, 14 and 17",
        "due_date_basis": "application_date",
        "due_date_days": 0,
        "due_date_day_basis": "calendar",
        "payment_notice_basis": "application_date",
        "payment_notice_days": 10,
        "payment_notice_day_basis": "business",
        "final_date_basis": "application_date",
        "final_date_days": 15,
        "final_date_day_basis": "business",
        "pay_less_days": None,
        "pay_less_day_basis": "calendar",
        "no_notice_effect": "applied_sum_becomes_notified_sum",
        "interest_basis": "prescribed_rate",
        "interest_reference_rate": "section 101 of the Civil Procedure Act 2005 (NSW)",
        "interest_margin_percent": None,
        "interest_fixed_percent": None,
        "interest_statute": "Building and Construction Industry Security of Payment Act 1999 (NSW), section 11(2)",
        "notes": (
            "The response to a payment claim is a payment schedule. Fifteen business days is the limit "
            "for a head contract and twenty for a subcontract; a contract may set a shorter period but "
            "not a longer one. Business days under this Act exclude 27 to 31 December as well as weekends "
            "and public holidays, so supply that calendar to reproduce the statutory dates exactly. Where "
            "no payment schedule is served in time the respondent becomes liable to pay the claimed "
            "amount on the due date. Interest runs at the greater of the prescribed rate and the rate the "
            "contract specifies."
        ),
    },
    {
        "code": "au_qld_bif",
        "jurisdiction": "Queensland, Australia",
        "country_code": "AU",
        "statute": "Building Industry Fairness (Security of Payment) Act 2017 (Qld)",
        "statute_reference": "sections 68, 75, 76 and 90",
        "due_date_basis": "application_date",
        "due_date_days": 0,
        "due_date_day_basis": "calendar",
        "payment_notice_basis": "application_date",
        "payment_notice_days": 15,
        "payment_notice_day_basis": "business",
        "final_date_basis": "application_date",
        "final_date_days": 25,
        "final_date_day_basis": "business",
        "pay_less_days": None,
        "pay_less_day_basis": "calendar",
        "no_notice_effect": "applied_sum_becomes_notified_sum",
        "interest_basis": "prescribed_rate",
        "interest_reference_rate": "section 67P of the Queensland Building and Construction Commission Act 1991",
        "interest_margin_percent": None,
        "interest_fixed_percent": Decimal("10.000"),
        "interest_statute": "Queensland Building and Construction Commission Act 1991, section 67P",
        "notes": (
            "The response to a payment claim is a payment schedule. Twenty-five business days is the "
            "limit for a head contract and fifteen for a subcontract. Where no payment schedule is served "
            "in time the respondent becomes liable to pay the claimed amount on the due date. Interest "
            "runs at the greater of ten per cent a year and the prescribed rate."
        ),
    },
    {
        "code": "nz_cca_2002",
        "jurisdiction": "New Zealand",
        "country_code": "NZ",
        "statute": "Construction Contracts Act 2002",
        "statute_reference": "sections 18, 20, 21, 22 and 23",
        "due_date_basis": "application_date",
        "due_date_days": 0,
        "due_date_day_basis": "calendar",
        "payment_notice_basis": "application_date",
        "payment_notice_days": 20,
        "payment_notice_day_basis": "business",
        "final_date_basis": "application_date",
        "final_date_days": 20,
        "final_date_day_basis": "business",
        "pay_less_days": None,
        "pay_less_day_basis": "calendar",
        "no_notice_effect": "applied_sum_becomes_notified_sum",
        "interest_basis": "contract",
        "interest_reference_rate": "",
        "interest_margin_percent": None,
        "interest_fixed_percent": None,
        "interest_statute": "",
        "notes": (
            "The response to a payment claim is a payment schedule. Both default periods run twenty "
            "working days from the payment claim, so on the default terms the payer must serve its "
            "schedule on the day payment falls due at the latest; a contract may set shorter periods. "
            "Working days under this Act exclude 24 December to 5 January as well as weekends and public "
            "holidays, so supply that calendar to reproduce the statutory dates exactly. Where no payment "
            "schedule is served the payer becomes liable for the claimed amount and it is recoverable as "
            "a debt. The Act sets no interest rate, so the contract rate applies."
        ),
    },
    {
        "code": "sg_sopa",
        "jurisdiction": "Singapore",
        "country_code": "SG",
        "statute": "Building and Construction Industry Security of Payment Act 2004",
        "statute_reference": "sections 8, 11 and 15",
        "due_date_basis": "application_date",
        "due_date_days": 0,
        "due_date_day_basis": "calendar",
        "payment_notice_basis": "application_date",
        "payment_notice_days": 21,
        "payment_notice_day_basis": "calendar",
        "final_date_basis": "application_date",
        "final_date_days": 35,
        "final_date_day_basis": "calendar",
        "pay_less_days": None,
        "pay_less_day_basis": "calendar",
        "no_notice_effect": "evidential_bar",
        "interest_basis": "contract",
        "interest_reference_rate": "",
        "interest_margin_percent": None,
        "interest_fixed_percent": None,
        "interest_statute": "",
        "notes": (
            "The response to a payment claim is a payment response, due twenty-one days after the claim "
            "for a construction contract and seven days for a supply contract. Payment falls due fourteen "
            "days after the payment response was required, which is where the thirty-five days comes "
            "from, unless the contract sets an earlier date. Failing to serve a payment response does not "
            "concede the claim: it bars the respondent from raising at adjudication any reason it did not "
            "put in the response."
        ),
    },
    {
        "code": "my_cipaa",
        "jurisdiction": "Malaysia",
        "country_code": "MY",
        "statute": "Construction Industry Payment and Adjudication Act 2012",
        "statute_reference": "sections 5, 6 and 36",
        "due_date_basis": "application_date",
        "due_date_days": 0,
        "due_date_day_basis": "calendar",
        "payment_notice_basis": "application_date",
        "payment_notice_days": 10,
        "payment_notice_day_basis": "business",
        "final_date_basis": "application_date",
        "final_date_days": None,
        "final_date_day_basis": "calendar",
        "pay_less_days": None,
        "pay_less_day_basis": "calendar",
        "no_notice_effect": "deemed_dispute",
        "interest_basis": "contract",
        "interest_reference_rate": "",
        "interest_margin_percent": None,
        "interest_fixed_percent": None,
        "interest_statute": "",
        "notes": (
            "The response to a payment claim is a payment response, due ten working days after the claim. "
            "The Act sets no payment period, so the final date for payment comes from the contract and "
            "has to be entered on the application; section 36 voids a clause making payment conditional "
            "on the payer itself being paid. Failing to respond within the ten working days is a deemed "
            "dispute of the whole claim rather than an admission of it, so the claimant's next step is "
            "adjudication and not a debt claim."
        ),
    },
    {
        "code": "eu_late_payment",
        "jurisdiction": "European Union",
        "country_code": "EU",
        "statute": "Directive 2011/7/EU on combating late payment in commercial transactions",
        "statute_reference": "articles 2, 3 and 4",
        "due_date_basis": "application_date",
        "due_date_days": 0,
        "due_date_day_basis": "calendar",
        "payment_notice_basis": "application_date",
        "payment_notice_days": None,
        "payment_notice_day_basis": "calendar",
        "final_date_basis": "application_date",
        "final_date_days": 30,
        "final_date_day_basis": "calendar",
        "pay_less_days": None,
        "pay_less_day_basis": "calendar",
        "no_notice_effect": "none",
        "interest_basis": "reference_rate_plus_margin",
        "interest_reference_rate": "European Central Bank reference rate",
        "interest_margin_percent": Decimal("8.000"),
        "interest_fixed_percent": None,
        "interest_statute": "Directive 2011/7/EU, article 2(6)",
        "notes": (
            "An interest basis rather than a notice regime: the Directive sets a payment period and the "
            "interest that runs when it is missed, and leaves notices to national law, so this regime has "
            "no payment notice and missing one has no consequence under it. Thirty days is the default "
            "period between undertakings; it may be extended to sixty by express agreement and beyond "
            "that only where the term is not grossly unfair to the creditor. Use this regime where a "
            "member state has no construction-specific payment statute, and the national regime where it "
            "has one."
        ),
    },
)

REGIME_CODES: tuple[str, ...] = tuple(regime["code"] for regime in PAYMENT_REGIMES)


def regime_by_code(code: str) -> dict[str, Any] | None:
    """The shipped catalogue entry for ``code``, or ``None`` when unknown."""
    for regime in PAYMENT_REGIMES:
        if regime["code"] == code:
            return dict(regime)
    return None


async def seed_payment_regimes(session: AsyncSession, *, refresh: bool = False) -> dict[str, int]:
    """Insert the shipped regimes that are not in the table yet.

    Idempotent, so it is safe on every startup and safe to call from a read
    path: a regime already present is left alone unless ``refresh`` is set, in
    which case its statutory fields are rewritten from the catalogue. Refresh is
    off by default because an operator may have corrected a period to match a
    contract's own compliant terms, and a silent overwrite on next boot would
    change every date computed afterwards.

    Args:
        session: Active async session. The caller owns the transaction.
        refresh: Rewrite regimes that already exist from the shipped catalogue.

    Returns:
        Counts under ``created``, ``updated`` and ``unchanged``.
    """
    from sqlalchemy import select

    from app.modules.payment_clock.models import PaymentRegime

    existing_rows = (await session.execute(select(PaymentRegime))).scalars().all()
    existing = {row.code: row for row in existing_rows}

    created = updated = unchanged = 0
    for entry in PAYMENT_REGIMES:
        row = existing.get(entry["code"])
        if row is None:
            session.add(PaymentRegime(**entry))
            created += 1
            continue
        if not refresh:
            unchanged += 1
            continue
        for key, value in entry.items():
            setattr(row, key, value)
        updated += 1

    await session.flush()
    logger.info(
        "Payment regimes seeded: %d created, %d updated, %d unchanged",
        created,
        updated,
        unchanged,
    )
    return {"created": created, "updated": updated, "unchanged": unchanged}


__all__ = [
    "PAYMENT_REGIMES",
    "REGIME_CODES",
    "regime_by_code",
    "seed_payment_regimes",
]

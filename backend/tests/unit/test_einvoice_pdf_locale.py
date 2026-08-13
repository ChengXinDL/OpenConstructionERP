# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""The readable page of the hybrid PDF speaks the reader's language.

The embedded CII is standard-prescribed (ISO dates, decimal points) and must
never vary with the locale; the page exists for a human and follows their
conventions - German labels, DD.MM.YYYY, decimal comma, thousands dot. These
tests read the page the way a person does (extracted text) and the XML the way
a machine does, and hold the two to their different contracts.
"""

import io
from decimal import Decimal

from pypdf import PdfReader

from app.modules.einvoice import build_einvoice
from app.modules.einvoice.pdf_embed import build_facturx_pdf
from app.modules.einvoice.pdf_translations import fmt_date, fmt_money, resolve_pdf_locale


def _invoice() -> dict:
    return {
        "invoice_number": "AR-2026-014",
        "invoice_direction": "receivable",
        "invoice_date": "2026-04-15",
        "due_date": "2026-05-15",
        "currency_code": "EUR",
        "amount_subtotal": Decimal("1850000.00"),
        "tax_amount": Decimal("351500.00"),
        "retention_amount": Decimal("0"),
        "amount_total": Decimal("2201500.00"),
        "notes": None,
        "metadata": {
            "einvoice": {
                "vat_rate": "19",
                "buyer_reference": "06-4300251-83",
                "payee_iban": "DE89370400440532013000",
                "payee_account_name": "Hochbau Rhein-Main GmbH",
                "seller": {
                    "name": "Hochbau Rhein-Main GmbH",
                    "vat_id": "DE812345678",
                    "city": "Frankfurt am Main",
                    "postcode": "60327",
                    "country_code": "DE",
                },
                "buyer": {
                    "name": "PVG Projektentwicklung Europaviertel GmbH",
                    "city": "Frankfurt am Main",
                    "postcode": "60308",
                    "country_code": "DE",
                },
            }
        },
    }


def _lines() -> list[dict]:
    return [
        {
            "description": "Rohbauarbeiten UG2-UG1 gem. Aufmaß",
            "unit": "psch",
            "quantity": Decimal("1"),
            "unit_rate": Decimal("1240000.00"),
            "amount": Decimal("1240000.00"),
        },
        {
            "description": "Rohbauarbeiten EG-3.OG gem. Aufmaß",
            "unit": "psch",
            "quantity": Decimal("1"),
            "unit_rate": Decimal("610000.00"),
            "amount": Decimal("610000.00"),
        },
    ]


def _page_text(pdf_bytes: bytes) -> str:
    reader = PdfReader(io.BytesIO(pdf_bytes))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def _build(locale: str) -> bytes:
    ei = build_einvoice(invoice=_invoice(), line_items=_lines(), profile="zugferd")
    return build_facturx_pdf(ei, locale=locale)


def test_the_german_page_is_german_end_to_end():
    text = _page_text(_build("de"))
    assert "RECHNUNG" in text
    assert "Datum: 15.04.2026" in text
    assert "Fällig: 15.05.2026" in text
    assert "Rechnung an" in text
    assert "Käuferreferenz: 06-4300251-83" in text
    assert "USt-IdNr.: DE812345678" in text
    # de-DE money: thousands dot, decimal comma.
    assert "1.240.000,00" in text
    assert "2.201.500,00 EUR" in text
    assert "Nettobetrag" in text
    assert "Gesamtbetrag" in text
    assert "Zahlbetrag" in text
    assert "Kontoinhaber" in text
    # None of the English frame survives.
    for english in ("INVOICE", "Bill to", "Net total", "Grand total", "Amount due", "Account holder"):
        assert english not in text, english


def test_the_english_page_keeps_its_labels_and_gains_grouping():
    text = _page_text(_build("en"))
    assert "INVOICE" in text
    assert "Date: 2026-04-15" in text
    assert "Bill to" in text
    assert "1,240,000.00" in text
    assert "2,201,500.00 EUR" in text


def test_the_embedded_xml_does_not_vary_with_the_page_language():
    """ISO dates and decimal points in the XML are the standard, not a locale."""
    de_reader = PdfReader(io.BytesIO(_build("de")))
    en_reader = PdfReader(io.BytesIO(_build("en")))
    de_xml = de_reader.attachments["factur-x.xml"][0]
    assert de_xml == en_reader.attachments["factur-x.xml"][0]
    assert b"20260415" in de_xml  # CII format 102 date, untouched
    assert b"2201500.00" in de_xml  # decimal point, untouched


def test_an_unknown_locale_falls_back_to_english():
    text = _page_text(_build("fr"))
    assert "INVOICE" in text


def test_locale_resolution_prefers_the_query_then_the_header():
    assert resolve_pdf_locale("de", None) == "de"
    assert resolve_pdf_locale("de-DE", "en") == "de"
    assert resolve_pdf_locale(None, "de-DE,de;q=0.9,en;q=0.8") == "de"
    assert resolve_pdf_locale(None, "fr-FR,fr;q=0.9") == "en"
    assert resolve_pdf_locale(None, None) == "en"


def test_the_de_formatters_alone():
    assert fmt_money(Decimal("1234567.5"), "EUR", "de") == "1.234.567,50"
    assert fmt_money(Decimal("1234567.5"), "EUR", "en") == "1,234,567.50"
    assert fmt_money(Decimal("1000"), "JPY", "de") == "1.000"
    assert fmt_date("2026-04-15", "de") == "15.04.2026"
    assert fmt_date("2026-04-15", "en") == "2026-04-15"
    assert fmt_date("not-a-date", "de") == "not-a-date"

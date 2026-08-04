# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""What the sheet register actually holds after a drawing set is split.

The register's new screen displays exactly what ``split_pdf_to_sheets`` wrote,
so these tests pin the split's output rather than its plumbing: one row per
page, the page order, what happens to a page whose title block cannot be read,
and what a second split of the same file does. ``test_epic_c_versioning``
already covers the ``FileVersion`` chain the split writes; it asserts the sheet
count and nothing else about the rows.

The PDFs are real, rendered with reportlab, so ``detect_sheet_info`` runs
against text pdfplumber genuinely extracted. Tests that need one skip where
reportlab is unavailable; the two aggregation tests seed rows directly and
always run.

Storage is redirected at the test's tmp dir. Without that the split writes the
PDF and its thumbnails under ``~/.openestimator`` on the machine running the
suite, which is where the application keeps real uploads.
"""

from __future__ import annotations

import io
import uuid
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.documents import service as documents_service
from app.modules.documents.models import Document, Sheet
from app.modules.documents.service import SheetService, detect_sheet_info
from app.modules.projects.models import Project
from app.modules.users.models import User
from tests._pg import transactional_session

# ── Fixtures ──────────────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def session() -> AsyncIterator[AsyncSession]:
    """Per-test PostgreSQL session inside an outer transaction.

    The shared ``oe_test_unit`` database already carries the full schema, and
    the transaction is rolled back on teardown, so each test starts empty.
    """
    async with transactional_session() as sess:
        yield sess


@pytest.fixture(autouse=True)
def _isolated_sheet_storage(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """Keep the split's PDF and thumbnail writes inside the test's tmp dir."""
    monkeypatch.setattr(documents_service, "UPLOAD_BASE", tmp_path / "uploads")
    monkeypatch.setattr(documents_service, "SHEET_THUMB_BASE", tmp_path / "sheets")


# ── Helpers ───────────────────────────────────────────────────────────────


async def _seed_project(session: AsyncSession) -> tuple[uuid.UUID, str]:
    """Insert a user and a project so the split has its foreign keys.

    Returns:
        ``(project_id, user_id_as_str)`` in the shape the service takes.
    """
    user = User(
        email=f"sheets-split-{uuid.uuid4().hex[:6]}@test.io",
        hashed_password="x",
        full_name="Sheets Split Tester",
        role="editor",
    )
    session.add(user)
    await session.flush()
    project = Project(name="Sheets Split Project", owner_id=user.id)
    session.add(project)
    await session.flush()
    return project.id, str(user.id)


def _pdf_with_pages(pages: list[list[str]]) -> bytes:
    """Render a PDF whose pages carry the given lines of title-block text."""
    canvas = pytest.importorskip("reportlab.pdfgen.canvas", reason="reportlab is not installed")
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer)
    for lines in pages:
        for offset, line in enumerate(lines):
            pdf.drawString(60, 760 - offset * 20, line)
        pdf.showPage()
    pdf.save()
    return buffer.getvalue()


def _upload(content: bytes, name: str = "drawings.pdf") -> UploadFile:
    """Wrap raw bytes in the ``UploadFile`` the service expects."""
    return UploadFile(filename=name, file=io.BytesIO(content), headers={"content-type": "application/pdf"})


async def _seed_sheet(
    session: AsyncSession,
    project_id: uuid.UUID,
    *,
    page_number: int,
    sheet_number: str | None,
    discipline: str | None,
) -> None:
    """Insert one sheet row directly, bypassing the split."""
    session.add(
        Sheet(
            project_id=project_id,
            document_id=str(uuid.uuid4()),
            page_number=page_number,
            sheet_number=sheet_number,
            discipline=discipline,
            is_current=True,
        )
    )
    await session.flush()


# ── The split ─────────────────────────────────────────────────────────────


async def test_split_creates_one_row_per_page_in_page_order(session: AsyncSession) -> None:
    """Three pages become three rows, numbered 1..3 in the order they appear.

    The order is asserted for a single split of a single file, which is the
    only case the query decides deterministically: ``list_for_project`` sorts
    on ``page_number`` alone, so two documents in one project interleave.
    """
    project_id, user_id = await _seed_project(session)
    pdf = _pdf_with_pages(
        [
            ["SHEET NO: A-201", "SHEET TITLE: Floor Plan Level 2"],
            ["SHEET NO: A-202", "SHEET TITLE: Floor Plan Level 3"],
            ["SHEET NO: S-301", "SHEET TITLE: Foundation Details"],
        ]
    )

    sheets = await SheetService(session).split_pdf_to_sheets(project_id, _upload(pdf), user_id)

    assert len(sheets) == 3
    assert [s.page_number for s in sheets] == [1, 2, 3]
    assert [s.sheet_number for s in sheets] == ["A-201", "A-202", "S-301"]
    assert [s.discipline for s in sheets] == ["Architectural", "Architectural", "Structural"]

    # Same order back out through the read path the register itself uses.
    listed, total = await SheetService(session).list_sheets(project_id)
    assert total == 3
    assert [s.page_number for s in listed] == [1, 2, 3]


async def test_split_reads_the_title_block_fields_the_drawer_shows(session: AsyncSession) -> None:
    """Number, title, scale and revision come off the page; discipline does not.

    Discipline is a lookup of the number's first character, not anything read
    from the drawing. Two columns the drawer has are never written by the
    split at all: ``revision_date`` is not parsed, and ``previous_version_id``
    is never set, so a split row's version history is always empty.
    """
    project_id, user_id = await _seed_project(session)
    pdf = _pdf_with_pages([["SHEET NO: M-401", "SHEET TITLE: Ventilation Layout", "REV C", "SCALE: 1:50"]])

    sheets = await SheetService(session).split_pdf_to_sheets(project_id, _upload(pdf), user_id)

    assert len(sheets) == 1
    sheet = sheets[0]
    assert sheet.sheet_number == "M-401"
    assert sheet.sheet_title == "Ventilation Layout"
    assert sheet.scale == "1:50"
    assert sheet.revision == "C"
    assert sheet.discipline == "Mechanical"
    assert sheet.revision_date is None
    assert sheet.previous_version_id is None
    assert sheet.is_current is True


async def test_the_scale_read_off_a_page_stops_at_the_end_of_its_line(session: AsyncSession) -> None:
    """A scale followed by another line does not swallow the newline.

    The scale pattern's character class used to include ``\\s``, which matches a
    newline, so the capture did not stop at the end of the line the label is on
    and the trailing ``\\S*`` took the first token of the next one. On a title
    block where anything follows the scale - which is the normal case, since the
    scale is rarely the last thing on a drawing - the stored value was the scale
    plus that token, and it is the stored value the detail drawer prints in its
    Scale field. This page puts REV C directly under the scale, which is the
    arrangement that produced ``"1:50\\nREV"``.
    """
    project_id, user_id = await _seed_project(session)
    pdf = _pdf_with_pages([["SHEET NO: M-401", "SCALE: 1:50", "REV C"]])

    sheets = await SheetService(session).split_pdf_to_sheets(project_id, _upload(pdf), user_id)

    assert sheets[0].scale == "1:50"
    # The revision was always read correctly; only the scale over-reached.
    assert sheets[0].revision == "C"


def test_the_scale_pattern_is_bounded_to_the_label_s_own_line() -> None:
    """The same case stated at the pattern, with no PDF toolchain involved.

    The split-level test above proves the value that reaches the stored row is
    right, but it can only do so through reportlab's layout and pdfplumber's
    line joining, either of which could change the exact text for reasons that
    have nothing to do with this pattern. This one pins the cause directly.

    Deliberately equalities, not substrings. The pre-existing scale tests all
    assert ``"1:100" in result["scale"]``, which is why a value carrying an
    extra line went unnoticed for as long as it did.
    """
    assert detect_sheet_info("SCALE: 1:50\nREV C")["scale"] == "1:50"
    assert detect_sheet_info("SCALE: 1:50\r\nREV C")["scale"] == "1:50"
    # Nothing after the label, so nothing there was ever to over-reach into.
    assert detect_sheet_info("SCALE: 1:50")["scale"] == "1:50"
    # Padding around the value belongs to the layout, not to the scale.
    assert detect_sheet_info("SCALE:   1:50   \nREV C")["scale"] == "1:50"


def test_a_scale_beside_its_neighbours_on_one_row_takes_only_its_own_cell() -> None:
    """The common real case: a title block row arrives as one joined line.

    A title block lays its fields out in columns, and the text extractor joins
    the cells sharing a visual row into a single line separated by runs of
    spaces. Bounding the capture to the line is therefore not enough on its own,
    because the line holds three fields. Both break signals are exercised here:
    the column gap, and a following label separated by only one space.
    """
    row = "SCALE: 1:50    DRAWN: AB    DATE: 2026-01-14"
    assert detect_sheet_info(row)["scale"] == "1:50"

    # A single space before the next label, so the column gap says nothing and
    # the label itself has to be what ends the value.
    assert detect_sheet_info("SCALE: 1:50 DRAWN: AB")["scale"] == "1:50"

    # The scale sitting in the middle of a row rather than at its start.
    assert detect_sheet_info("SHEET NO: A-101   SCALE: 1:100   REV: B")["scale"] == "1:100"


def test_a_scale_written_as_words_is_read_as_written() -> None:
    """Not every drawing carries a ratio, and the written forms must survive.

    NTS is the ordinary way to say a detail is not drawn to scale, so a change
    that reads only ratios would lose the field on a large share of real sheets.
    ``AS NOTED`` is the case that decides the shape of the break rule: it has a
    space inside the value, so a rule that ended the value at the first space
    would store ``AS``.
    """
    assert detect_sheet_info("SCALE: NTS")["scale"] == "NTS"
    assert detect_sheet_info("SCALE: N.T.S.")["scale"] == "N.T.S."
    assert detect_sheet_info("SCALE: VARIES")["scale"] == "VARIES"
    assert detect_sheet_info("SCALE: AS NOTED")["scale"] == "AS NOTED"
    assert detect_sheet_info("SCALE: AS NOTED   DRAWN: AB")["scale"] == "AS NOTED"
    assert detect_sheet_info("SCALE: NTS\nREV C")["scale"] == "NTS"


def test_a_sheet_title_beside_a_neighbouring_field_does_not_absorb_it() -> None:
    """The title pattern had the same fault as the scale, and keeps a wider bound.

    ``(.+?)(?:\\n|$)`` captures to the end of the joined row, so a title sharing
    a row with the drawn-by cell was stored carrying that cell, up to the 500
    character column limit.

    The title is free text, so unlike the scale it is NOT cut at a run of
    spaces: wide letter spacing inside a single cell produces the same run, and
    cutting there would truncate a real title. Only a following label ends it.
    That asymmetry is deliberate and this pins both halves of it.
    """
    joined = "SHEET TITLE: Floor Plan Level 2    DRAWN: AB"
    assert detect_sheet_info(joined)["sheet_title"] == "Floor Plan Level 2"

    # A gap inside the title itself is kept, because it is not a field boundary.
    spaced = "SHEET TITLE: Floor  Plan  Level 2\nREV C"
    assert detect_sheet_info(spaced)["sheet_title"] == "Floor  Plan  Level 2"


def test_an_imperial_scale_survives_the_labelled_pattern() -> None:
    """A labelled imperial scale is stored whole rather than cut at the equals.

    A second fault in the same pattern, found while fixing the first and not
    covered by any test. ``=`` was absent from the character class, so on
    ``SCALE: 1/4" = 1'-0"`` the class stopped at the space before the equals and
    the trailing ``\\S*`` took only the equals itself, storing ``1/4" =``. The
    third pattern in the list reads the imperial form correctly, but it never
    ran: the labelled pattern is tried first and matched, and the loop breaks on
    the first match. So the imperial form was only ever read correctly on a page
    that does not label it.
    """
    assert detect_sheet_info('SCALE: 1/4" = 1\'-0"')["scale"] == '1/4" = 1\'-0"'
    assert detect_sheet_info('SCALE: 1/4" = 1\'-0"\nREV C')["scale"] == '1/4" = 1\'-0"'
    # Unlabelled, which is the case the third pattern was carrying on its own.
    assert detect_sheet_info('1/4" = 1\'-0"')["scale"] == '1/4" = 1\'-0"'


def test_a_scale_label_with_its_value_on_the_next_line_still_reads() -> None:
    """Bounding the capture to one line must not lose a value set below the label.

    Some title blocks put the field name in one cell and the value in the cell
    under it, which reaches the text extractor as two lines. The labelled
    pattern now declines that, correctly, because what follows the label on its
    own line is nothing. The unlabelled ratio pattern picks it up instead, so
    the value still arrives; this pins that the fallback is doing that work,
    rather than the bound silently costing a page its scale.
    """
    assert detect_sheet_info("SCALE:\n1:50")["scale"] == "1:50"


async def test_a_page_with_no_readable_number_is_kept_with_a_null_number(session: AsyncSession) -> None:
    """An unreadable title block yields a row, not a refusal and not a guess.

    The page is stored with ``sheet_number`` and ``discipline`` null rather
    than dropped or given an invented number, which is why the register falls
    back to labelling such a row by its page.
    """
    project_id, user_id = await _seed_project(session)
    pdf = _pdf_with_pages(
        [
            ["SHEET NO: A-201", "SHEET TITLE: Floor Plan Level 2"],
            ["GENERAL NOTES", "SEE THE SPECIFICATION"],
        ]
    )

    sheets = await SheetService(session).split_pdf_to_sheets(project_id, _upload(pdf), user_id)

    assert len(sheets) == 2
    unreadable = sheets[1]
    assert unreadable.page_number == 2
    assert unreadable.sheet_number is None
    assert unreadable.discipline is None
    assert unreadable.sheet_title is None


async def test_a_second_split_of_the_same_file_creates_a_second_full_set(session: AsyncSession) -> None:
    """Re-splitting duplicates the register. Nothing dedupes, by construction.

    Each call creates its own parent ``Document`` and a fresh row per page,
    all flagged current, with no uniqueness on the project and sheet number or
    on the document and page. This is what the endpoint does today; the test
    pins it so a change to it is visible rather than silent.
    """
    project_id, user_id = await _seed_project(session)
    pdf = _pdf_with_pages(
        [
            ["SHEET NO: A-201", "SHEET TITLE: Floor Plan Level 2"],
            ["SHEET NO: A-202", "SHEET TITLE: Floor Plan Level 3"],
        ]
    )

    service = SheetService(session)
    first = await service.split_pdf_to_sheets(project_id, _upload(pdf), user_id)
    second = await service.split_pdf_to_sheets(project_id, _upload(pdf), user_id)

    assert len(first) == 2
    assert len(second) == 2

    rows = list((await session.execute(select(Sheet).where(Sheet.project_id == project_id))).scalars().all())
    assert len(rows) == 4
    # Two parent documents, so the duplicates are distinguishable only by
    # document, never by sheet number.
    assert len({r.document_id for r in rows}) == 2
    assert sorted(str(r.sheet_number) for r in rows) == ["A-201", "A-201", "A-202", "A-202"]
    # Every row claims to be the current revision of its sheet.
    assert all(r.is_current for r in rows)

    documents = list((await session.execute(select(Document).where(Document.project_id == project_id))).scalars().all())
    assert len(documents) == 2


# ── Aggregation over the register ─────────────────────────────────────────


async def test_listing_reports_the_total_behind_the_page(session: AsyncSession) -> None:
    """The row count and the register's size are different numbers.

    ``list_for_project`` counts the filtered set before paginating, so a caller
    that counts the rows it received is not counting the register. The route
    returns only the rows and drops this total, and the index page asks for
    ``limit=500``, which is the schema maximum.
    """
    project_id, _user_id = await _seed_project(session)
    for page in (1, 2, 3):
        await _seed_sheet(session, project_id, page_number=page, sheet_number=f"A-10{page}", discipline="Architectural")

    listed, total = await SheetService(session).list_sheets(project_id, limit=2)

    assert len(listed) == 2
    assert total == 3


async def test_distinct_disciplines_collapses_rows_and_drops_the_unset_ones(session: AsyncSession) -> None:
    """The discipline list counts disciplines, not sheets, and skips the nulls.

    Five rows over two named disciplines return two values. The rows with no
    discipline contribute nothing here, while the insights band buckets them
    under a visible "not set" slice, so the two surfaces do not agree on how
    many groups the register has.
    """
    project_id, _user_id = await _seed_project(session)
    await _seed_sheet(session, project_id, page_number=1, sheet_number="A-101", discipline="Architectural")
    await _seed_sheet(session, project_id, page_number=2, sheet_number="A-102", discipline="Architectural")
    await _seed_sheet(session, project_id, page_number=3, sheet_number="S-201", discipline="Structural")
    await _seed_sheet(session, project_id, page_number=4, sheet_number=None, discipline=None)
    await _seed_sheet(session, project_id, page_number=5, sheet_number="X-999", discipline=None)

    disciplines = await SheetService(session).get_disciplines(project_id)

    assert disciplines == ["Architectural", "Structural"]

    _listed, total = await SheetService(session).list_sheets(project_id)
    assert total == 5

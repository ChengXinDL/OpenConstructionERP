"""PG: the Project-Files -> takeoff document link.

Opening a PDF from the /files area must land on a REAL ``TakeoffDocument``
rather than on the ``oe_documents_document`` id, because every takeoff artefact
(measurements, page scales, extracted text, AI runs) keys on the takeoff id.
The bridge is ``TakeoffDocument.source_document_id`` plus the find-or-create in
``TakeoffService.get_or_create_takeoff_from_source``.

These tests run against a REAL PostgreSQL cluster because the properties worth
pinning are all database-level and cannot be observed on the mock-repository
suite in ``tests/modules/takeoff/test_from_source.py``:

* the ``uq_takeoff_document_project_source`` unique index is what actually
  stops a concurrent double-open from minting two rows (#369) - the mock
  implements find-or-create in Python and stays green with the index dropped;
* that index is deliberately plain rather than partial, which only works
  because PostgreSQL treats NULLs as distinct - SQLite would not prove it;
* deleting the source document is a cross-module interaction between
  ``DocumentService`` and the takeoff tables.

Gated by ``OE_TEST_DB=pg`` (see conftest).
"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.modules.documents.models import Document
from app.modules.documents.service import DocumentService
from app.modules.projects.models import Project
from app.modules.takeoff.models import TakeoffDocument, TakeoffMeasurement
from app.modules.takeoff.router import create_takeoff_from_source
from app.modules.takeoff.service import TakeoffService
from app.modules.users.models import User

# Bytes that are NOT a parseable PDF. Every reuse-path test passes these as the
# "source content": if the find-or-create ever stops short-circuiting and falls
# through to the real upload/parse path, the test fails loudly instead of
# quietly succeeding for the wrong reason.
NOT_A_PDF = b"this should never reach the parser"


def _real_pdf_on_disk(name: str) -> str:
    """Write a genuinely valid one-page PDF under the uploads root.

    The access test needs the source blob to be present and readable, otherwise
    the route would 404 on the missing file for a reason that has nothing to do
    with permissions - and the test would pass even with the access check torn
    out. A real file makes the refusal attributable to the access check alone.
    """
    import fitz

    from app.modules.documents.service import UPLOAD_BASE

    base = Path(UPLOAD_BASE)
    base.mkdir(parents=True, exist_ok=True)
    path = base / f"takeoff-src-test-{uuid.uuid4().hex}-{name}"
    doc = fitz.open()
    doc.new_page()
    path.write_bytes(doc.tobytes())
    doc.close()
    return str(path)


async def _seed(session, *, with_blob: bool = False) -> tuple[User, Project, Document]:
    """Insert an owner, a project, and one Project-Files document.

    ``with_blob`` also writes a real PDF to disk and points the document at it.
    """
    owner = User(email=f"takeoff-src-{uuid.uuid4().hex[:8]}@example.com", hashed_password="x")
    session.add(owner)
    await session.flush()

    project = Project(name="From-source link", owner_id=owner.id, currency="EUR")
    session.add(project)
    await session.flush()

    source = Document(
        project_id=project.id,
        name="A-201 Floor Plan.pdf",
        category="drawing",
        mime_type="application/pdf",
        file_path=_real_pdf_on_disk("A-201.pdf") if with_blob else "",
        uploaded_by=str(owner.id),
    )
    session.add(source)
    await session.flush()
    return owner, project, source


def _takeoff_doc(project: Project, owner: User, *, source_id: str | None) -> TakeoffDocument:
    return TakeoffDocument(
        filename="A-201 Floor Plan.pdf",
        pages=1,
        size_bytes=1024,
        project_id=project.id,
        owner_id=owner.id,
        source_document_id=source_id,
    )


@pytest.mark.asyncio
async def test_reopening_a_project_file_reuses_the_document_and_its_measurements(pg_session):
    """A second open returns the first open's document, measurements included.

    This is the deliberate product decision: a takeoff is a work product, not a
    viewing session, so reopening the same drawing from /files must not strand
    the quantities already measured on it behind a fresh document id.
    """
    owner, project, source = await _seed(pg_session)

    first = _takeoff_doc(project, owner, source_id=str(source.id))
    pg_session.add(first)
    await pg_session.flush()

    measurement = TakeoffMeasurement(
        project_id=project.id,
        document_id=str(first.id),
        page=1,
        type="area",
        measurement_value=42,
        measurement_unit="m2",
    )
    pg_session.add(measurement)
    await pg_session.flush()

    service = TakeoffService(pg_session)
    second = await service.get_or_create_takeoff_from_source(
        source_document_id=str(source.id),
        source_project_id=str(project.id),
        filename="A-201 Floor Plan.pdf",
        content=NOT_A_PDF,
        size_bytes=len(NOT_A_PDF),
        owner_id=str(owner.id),
    )

    assert second.id == first.id, "reopening the same source minted a new takeoff document"

    rows = (
        (await pg_session.execute(select(TakeoffMeasurement).where(TakeoffMeasurement.document_id == str(second.id))))
        .scalars()
        .all()
    )
    assert len(rows) == 1, "the reused document lost the measurements taken on the first open"
    assert rows[0].measurement_value == 42


@pytest.mark.asyncio
async def test_unique_index_rejects_a_duplicate_source_link(pg_session):
    """Two takeoff documents cannot share one (project, source document).

    The database-level guard behind #369: the find-or-create does an unlocked
    SELECT then INSERT, so two concurrent opens can both miss. Without this
    index the loser's measurements strand on an unreachable duplicate row.
    """
    owner, project, source = await _seed(pg_session)

    pg_session.add(_takeoff_doc(project, owner, source_id=str(source.id)))
    await pg_session.flush()

    pg_session.add(_takeoff_doc(project, owner, source_id=str(source.id)))
    with pytest.raises(IntegrityError):
        await pg_session.flush()
    await pg_session.rollback()


@pytest.mark.asyncio
async def test_direct_uploads_without_a_source_never_collide(pg_session):
    """Many plain uploads coexist in one project - NULL source ids stay distinct.

    ``uq_takeoff_document_project_source`` is deliberately a plain (not partial)
    unique index so the startup auto-migrate heal, which skips partial indexes,
    still materialises it. That is only safe because PostgreSQL treats NULLs as
    distinct, so the constraint binds from-source rows and never ordinary
    uploads. If that ever changed, direct upload would break for every project.
    """
    owner, project, _ = await _seed(pg_session)

    pg_session.add(_takeoff_doc(project, owner, source_id=None))
    pg_session.add(_takeoff_doc(project, owner, source_id=None))
    pg_session.add(_takeoff_doc(project, owner, source_id=None))
    await pg_session.flush()

    rows = (
        (
            await pg_session.execute(
                select(TakeoffDocument).where(
                    TakeoffDocument.project_id == project.id,
                    TakeoffDocument.source_document_id.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 3


@pytest.mark.asyncio
async def test_deleting_the_source_leaves_the_takeoff_document_intact(pg_session):
    """Deleting the /files document must not destroy takeoff work built on it.

    ``source_document_id`` is a plain column, not a cascading FK, and the
    takeoff document owns its own copy of the bytes, so the delete is
    survivable by design: the takeoff document and its measurements remain
    readable. The reference goes stale, which the next open handles as a clean
    404 (pinned separately below) rather than a 500.

    DECISION RECORD - this test pins CURRENT behaviour, deliberately, and the
    behaviour depends on a known defect. The takeoff document survives the
    delete precisely *because* the from-source path copies the PDF bytes into
    the takeoff upload directory instead of referencing the stored blob, so the
    source document and the takeoff document own independent copies. That copy
    is a real defect (it doubles disk for every project file opened in takeoff),
    and the planned fix - referencing the blob zero-copy, with a copy-on-delete
    hook in ``DocumentService.delete_document`` - would keep this test's
    assertions true while changing the mechanism underneath them.

    So: this test is a decision record, not an accident. If you are implementing
    the zero-copy change and this test fails, you have removed the copy WITHOUT
    adding the delete hook, and you have just orphaned every measurement built
    on a deleted project file. That is the one outcome strictly worse than the
    duplication being fixed. The assertions here stay valid under both designs;
    only a half-finished migration between them can break it.
    """
    owner, project, source = await _seed(pg_session)
    source_id = source.id

    doc = _takeoff_doc(project, owner, source_id=str(source_id))
    pg_session.add(doc)
    await pg_session.flush()
    takeoff_id = doc.id

    pg_session.add(
        TakeoffMeasurement(
            project_id=project.id,
            document_id=str(takeoff_id),
            page=1,
            type="area",
            measurement_value=17,
            measurement_unit="m2",
        )
    )
    await pg_session.flush()

    await DocumentService(pg_session).delete_document(source_id, user_id=str(owner.id))

    # Drop the identity map before asserting. ``session.get`` would happily
    # return the still-cached Python object for a row the database has already
    # deleted, so these assertions must be forced through real SELECTs -
    # otherwise a cascading delete would slip past this test unnoticed.
    pg_session.expire_all()

    remaining_source = (await pg_session.execute(select(Document).where(Document.id == source_id))).scalars().all()
    assert remaining_source == [], "source document was not deleted"

    survivors = (
        (await pg_session.execute(select(TakeoffDocument).where(TakeoffDocument.id == takeoff_id))).scalars().all()
    )
    assert len(survivors) == 1, "deleting the source destroyed the takeoff document"

    rows = (
        (await pg_session.execute(select(TakeoffMeasurement).where(TakeoffMeasurement.document_id == str(takeoff_id))))
        .scalars()
        .all()
    )
    assert len(rows) == 1, "deleting the source orphaned the measurements"
    assert rows[0].measurement_value == 17


@pytest.mark.asyncio
async def test_reopening_a_deleted_source_is_a_clean_404(pg_session):
    """A stale source id returns 404, never an unhandled 500.

    A dangling reference that crashes on next open would be a worse bug than
    the id-namespace mixup this whole bridge exists to fix.
    """
    owner, project, source = await _seed(pg_session)
    source_id = source.id

    await DocumentService(pg_session).delete_document(source_id, user_id=str(owner.id))

    with pytest.raises(HTTPException) as exc:
        await create_takeoff_from_source(
            source_document_id=str(source_id),
            user_id=str(owner.id),
            service=TakeoffService(pg_session),
            session=pg_session,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_the_link_does_not_widen_access_to_another_users_project(pg_session):
    """An outsider cannot read a project file through the takeoff bridge.

    The takeoff route must be no wider than the documents module's own read
    scoping: it resolves the source row, then runs the same
    ``verify_project_access`` the documents download route runs, against the
    project taken from the stored row rather than from anything the caller
    sends. The refusal is 404 (not 403) so a probed UUID cannot be used to test
    for existence.
    """
    _owner, _project, source = await _seed(pg_session, with_blob=True)

    outsider = User(email=f"outsider-{uuid.uuid4().hex[:8]}@example.com", hashed_password="x")
    pg_session.add(outsider)
    await pg_session.flush()
    assert outsider.role != "admin", "outsider must not hold the admin bypass"

    try:
        with pytest.raises(HTTPException) as exc:
            await create_takeoff_from_source(
                source_document_id=str(source.id),
                user_id=str(outsider.id),
                service=TakeoffService(pg_session),
                session=pg_session,
            )
        assert exc.value.status_code == 404

        linked = (
            (
                await pg_session.execute(
                    select(TakeoffDocument).where(TakeoffDocument.source_document_id == str(source.id))
                )
            )
            .scalars()
            .all()
        )
        assert linked == [], "a refused open still created a takeoff document"
    finally:
        # The seeded blob lives in the real uploads root: the database rolls
        # back after each test, the filesystem does not. Remove it so a run
        # does not leave a stray PDF in the developer's data dir.
        Path(source.file_path).unlink(missing_ok=True)

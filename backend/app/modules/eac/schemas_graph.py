# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Request/response schemas for the EAC block-graph API.

These mirror the shapes the visual editor already holds in
``frontend/src/features/eac/canvas/useBlockCanvasStore.ts``. Field names are
snake_case on the wire (the codebase convention) while the editor's own objects
are camelCase; the mapping is spelled out in the block and connection schemas
below so the frontend adapter is mechanical rather than guesswork.

One shape is deliberately absent: ``CanvasBlock.expanded``. The store documents
it as pure UI state that does not even enter the undo history, so it is not the
server's business whether one estimator had a parameter panel folded open.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.modules.eac.models import (
    BLOCK_COLORS,
    GRAPH_VALIDATION_STATUSES,
    OUTPUT_MODES,
    SLOT_DATA_TYPES,
    SLOT_DIRECTIONS,
)

# ── Slot ─────────────────────────────────────────────────────────────────────


class BlockSlot(BaseModel):
    """One connection handle on a block. Mirrors ``SlotDefinition`` in ``dnd.ts``.

    ``dataType`` and the direction keep their camelCase editor spelling here
    because the whole slot object is stored and returned verbatim; renaming
    them would force the canvas to translate every slot on every load.
    """

    model_config = ConfigDict(extra="allow")

    id: str = Field(min_length=1, max_length=64)
    label: str = Field(default="", max_length=255)
    direction: str
    dataType: str  # noqa: N815 - verbatim editor field name
    multi: bool | None = None

    @field_validator("direction")
    @classmethod
    def _known_direction(cls, value: str) -> str:
        if value not in SLOT_DIRECTIONS:
            raise ValueError(f"direction must be one of {SLOT_DIRECTIONS}, got '{value}'")
        return value

    @field_validator("dataType")
    @classmethod
    def _known_data_type(cls, value: str) -> str:
        if value not in SLOT_DATA_TYPES:
            raise ValueError(f"dataType must be one of {SLOT_DATA_TYPES}, got '{value}'")
        return value


# ── Block ────────────────────────────────────────────────────────────────────


class BlockPosition(BaseModel):
    """Canvas coordinates. Mirrors ``CanvasBlock.position``."""

    x: float = 0.0
    y: float = 0.0


class BlockWrite(BaseModel):
    """A block as the editor sends it.

    ``client_id`` is ``CanvasBlock.id`` - the id the editor generated and the id
    its wires reference. It round-trips untouched; the server never renames a
    block the estimator is still looking at.
    """

    client_id: str = Field(min_length=1, max_length=64)
    kind: str = Field(min_length=1, max_length=64)
    color: str = "selector"
    title: str = Field(default="", max_length=255)
    position: BlockPosition = Field(default_factory=BlockPosition)
    slots: list[BlockSlot] = Field(default_factory=list)
    params: dict[str, Any] = Field(default_factory=dict)

    @field_validator("color")
    @classmethod
    def _known_color(cls, value: str) -> str:
        if value not in BLOCK_COLORS:
            raise ValueError(f"color must be one of {BLOCK_COLORS}, got '{value}'")
        return value


class BlockRead(BlockWrite):
    """A block as the API returns it, with its place in the ordered set."""

    ordinal: int


# ── Connection ───────────────────────────────────────────────────────────────


class ConnectionWrite(BaseModel):
    """A wire as the editor sends it. Mirrors ``CanvasConnection``.

    The editor's camelCase names map straight across::

        sourceBlockId -> source_block_client_id
        sourceSlotId  -> source_slot_id
        targetBlockId -> target_block_client_id
        targetSlotId  -> target_slot_id
        dataType      -> data_type
    """

    client_id: str = Field(min_length=1, max_length=64)
    source_block_client_id: str = Field(min_length=1, max_length=64)
    source_slot_id: str = Field(min_length=1, max_length=64)
    target_block_client_id: str = Field(min_length=1, max_length=64)
    target_slot_id: str = Field(min_length=1, max_length=64)
    data_type: str = "any"

    @field_validator("data_type")
    @classmethod
    def _known_data_type(cls, value: str) -> str:
        if value not in SLOT_DATA_TYPES:
            raise ValueError(f"data_type must be one of {SLOT_DATA_TYPES}, got '{value}'")
        return value


class ConnectionRead(ConnectionWrite):
    """A wire as the API returns it."""

    ordinal: int


# ── Validation report ────────────────────────────────────────────────────────


class GraphFinding(BaseModel):
    """One failing validation result, as persisted on the graph row."""

    rule_id: str
    severity: str
    message: str
    element_ref: str | None = None
    suggestion: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class GraphValidationReport(BaseModel):
    """The outcome of running the ``eac_graph`` rule set over a graph.

    ``score`` is the validation engine's own severity-weighted number, passed
    through untouched, and it is ``None`` whenever the engine says so - an
    empty canvas checks nothing, and a report with no compliance results has no
    quality signal at all. Substituting ``1.0`` there would paint a green light
    on a methodology that was never examined, which is exactly what the engine
    documents itself as refusing to do.
    """

    status: str
    score: float | None = None
    findings: list[GraphFinding] = Field(default_factory=list)


# ── Graph ────────────────────────────────────────────────────────────────────


class GraphBody(BaseModel):
    """The blocks and wires themselves, shared by create, update and validate."""

    blocks: list[BlockWrite] = Field(default_factory=list)
    connections: list[ConnectionWrite] = Field(default_factory=list)


class GraphCreate(GraphBody):
    """Create a new block graph."""

    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    output_mode: str = "boolean"
    rule_id: uuid.UUID | None = None
    ruleset_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None
    tags: list[str] = Field(default_factory=list)

    @field_validator("output_mode")
    @classmethod
    def _known_output_mode(cls, value: str) -> str:
        if value not in OUTPUT_MODES:
            raise ValueError(f"output_mode must be one of {OUTPUT_MODES}, got '{value}'")
        return value


class GraphUpdate(BaseModel):
    """Update a block graph.

    Every field is optional so a rename does not have to resend the canvas.
    ``blocks`` and ``connections`` are a **whole-snapshot replace**, matching the
    editor's own ``loadGraph({blocks, connections})``: send both or neither.
    Sending neither leaves the canvas exactly as it was.

    ``expected_revision`` is the optimistic-concurrency guard. When present and
    stale, the write is refused with 409 rather than silently overwriting an
    edit made in another tab.
    """

    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    output_mode: str | None = None
    rule_id: uuid.UUID | None = None
    ruleset_id: uuid.UUID | None = None
    tags: list[str] | None = None
    blocks: list[BlockWrite] | None = None
    connections: list[ConnectionWrite] | None = None
    expected_revision: int | None = None

    @field_validator("output_mode")
    @classmethod
    def _known_output_mode(cls, value: str | None) -> str | None:
        if value is not None and value not in OUTPUT_MODES:
            raise ValueError(f"output_mode must be one of {OUTPUT_MODES}, got '{value}'")
        return value


class GraphDuplicate(BaseModel):
    """Duplicate a graph under a new name."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    project_id: uuid.UUID | None = None


class GraphSummary(BaseModel):
    """A graph without its blocks - what a list view needs."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str | None
    output_mode: str
    rule_id: uuid.UUID | None
    ruleset_id: uuid.UUID | None
    project_id: uuid.UUID | None
    tags: list[str]
    revision: int
    validation_status: str
    block_count: int = 0
    connection_count: int = 0
    created_at: datetime
    updated_at: datetime


class GraphRead(GraphSummary):
    """A graph with its full canvas, ready to hand to ``loadGraph``."""

    blocks: list[BlockRead] = Field(default_factory=list)
    connections: list[ConnectionRead] = Field(default_factory=list)
    validation: GraphValidationReport


__all__ = [
    "BLOCK_COLORS",
    "GRAPH_VALIDATION_STATUSES",
    "BlockPosition",
    "BlockRead",
    "BlockSlot",
    "BlockWrite",
    "ConnectionRead",
    "ConnectionWrite",
    "GraphBody",
    "GraphCreate",
    "GraphDuplicate",
    "GraphFinding",
    "GraphRead",
    "GraphSummary",
    "GraphUpdate",
    "GraphValidationReport",
]

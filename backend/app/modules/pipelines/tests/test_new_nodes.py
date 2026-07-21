# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Unit tests for the newer Pipeline Builder node runners.

Each test builds a :class:`NodeContext` directly (params + a single upstream
envelope) and calls the runner, then asserts on the returned envelope. The
runners under test are pure - they read the wire rows and never touch the
database - except ``source.validation_findings``, which is exercised with a
tiny fake session so no real database is needed. Gates are checked on both
their pass path and their stop (raise) path.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.core.pipeline.registry import NodeContext, node_registry
from app.modules.pipelines.pipeline_nodes import (
    _run_flow_tee,
    _run_gate_non_empty,
    _run_gate_threshold,
    _run_source_validation_findings,
    _run_transform_compute,
    _run_transform_group,
    _run_transform_rename,
)


def _ctx(params: dict[str, Any], upstream: dict[str, Any], *, db: Any = None) -> NodeContext:
    """Build a linear single-input NodeContext for a runner under test."""
    return NodeContext(
        db=db,
        node_id="n1",
        node_type="test",
        params=params,
        inputs={"up": upstream},
    )


def _rows() -> list[dict[str, Any]]:
    """A small, mixed BOQ-shaped sample used across the pure-runner tests."""
    return [
        {"id": "a", "trade": "concrete", "quantity": "10", "unit_rate": "5"},
        {"id": "b", "trade": "concrete", "quantity": "4", "unit_rate": "20"},
        {"id": "c", "trade": "steel", "quantity": "2", "unit_rate": "100"},
    ]


# ── transform.compute ────────────────────────────────────────────────────


async def test_compute_multiplies_two_fields():
    ctx = _ctx(
        {"target": "line_total", "left": "quantity", "op": "multiply", "right": "unit_rate"},
        {"rows": _rows(), "count": 3},
    )
    out = await _run_transform_compute(ctx)
    assert out["mutated"] is True
    assert [r["line_total"] for r in out["rows"]] == ["50", "80", "200"]


async def test_compute_right_can_be_a_numeric_literal():
    ctx = _ctx(
        {"target": "bumped", "left": "quantity", "op": "add", "right": "1.5"},
        {"rows": _rows()},
    )
    out = await _run_transform_compute(ctx)
    assert out["rows"][0]["bumped"] == "11.5"


async def test_compute_divide_by_zero_yields_none():
    ctx = _ctx(
        {"target": "ratio", "left": "quantity", "op": "divide", "right": "0"},
        {"rows": [{"id": "a", "quantity": "10"}]},
    )
    out = await _run_transform_compute(ctx)
    assert out["rows"][0]["ratio"] is None


async def test_compute_missing_field_is_safe():
    ctx = _ctx(
        {"target": "x", "left": "nope", "op": "add", "right": "also_missing"},
        {"rows": [{"id": "a"}]},
    )
    out = await _run_transform_compute(ctx)
    assert out["rows"][0]["x"] is None


# ── transform.group ──────────────────────────────────────────────────────


async def test_group_counts_and_totals_per_group():
    ctx = _ctx({"by": "trade", "sum_field": "quantity"}, {"rows": _rows()})
    out = await _run_transform_group(ctx)
    by_group = {r["group"]: r for r in out["rows"]}
    assert by_group["concrete"]["count"] == 2
    assert by_group["concrete"]["sum"] == "14"
    assert by_group["steel"]["count"] == 1
    assert out["mutated"] is True


async def test_group_without_sum_field_leaves_sum_none():
    ctx = _ctx({"by": "trade"}, {"rows": _rows()})
    out = await _run_transform_group(ctx)
    assert all(r["sum"] is None for r in out["rows"])
    assert out["count"] == 2


async def test_group_missing_key_buckets_as_none():
    ctx = _ctx({"by": "trade"}, {"rows": [{"id": "a"}, {"id": "b", "trade": "steel"}]})
    out = await _run_transform_group(ctx)
    groups = {r["group"] for r in out["rows"]}
    assert "(none)" in groups


# ── transform.rename ─────────────────────────────────────────────────────


async def test_rename_moves_field_and_drops_original():
    ctx = _ctx({"from": "trade", "to": "discipline"}, {"rows": _rows()})
    out = await _run_transform_rename(ctx)
    first = out["rows"][0]
    assert first["discipline"] == "concrete"
    assert "trade" not in first
    assert out["mutated"] is True


async def test_rename_keep_original_retains_both():
    ctx = _ctx({"from": "trade", "to": "discipline", "keep_original": True}, {"rows": _rows()})
    out = await _run_transform_rename(ctx)
    first = out["rows"][0]
    assert first["trade"] == "concrete"
    assert first["discipline"] == "concrete"


async def test_rename_without_params_is_passthrough():
    ctx = _ctx({}, {"rows": _rows()})
    out = await _run_transform_rename(ctx)
    assert out["rows"] == _rows()


# ── gate.threshold ───────────────────────────────────────────────────────


async def test_threshold_gate_passes_when_within_limit():
    # sum(quantity) = 16, allowed when lte 20 → passes.
    ctx = _ctx({"field": "quantity", "agg": "sum", "op": "lte", "value": 20}, {"rows": _rows(), "count": 3})
    out = await _run_gate_threshold(ctx)
    assert out["aggregate"] == "16"
    assert out["count"] == 3


async def test_threshold_gate_stops_when_limit_broken():
    # sum(quantity) = 16, allowed when lte 10 → fails, must raise.
    ctx = _ctx({"field": "quantity", "agg": "sum", "op": "lte", "value": 10}, {"rows": _rows()})
    with pytest.raises(ValueError, match="Threshold gate failed"):
        await _run_gate_threshold(ctx)


async def test_threshold_gate_avg_and_empty_field_uses_count():
    ctx = _ctx({"agg": "count", "op": "gte", "value": 2}, {"rows": _rows(), "count": 3})
    out = await _run_gate_threshold(ctx)
    assert out["aggregate"] == "3"


async def test_threshold_gate_max_aggregate():
    # max(unit_rate) = 100, allowed when lt 200 → passes.
    ctx = _ctx({"field": "unit_rate", "agg": "max", "op": "lt", "value": 200}, {"rows": _rows()})
    out = await _run_gate_threshold(ctx)
    assert out["aggregate"] == "100"


# ── flow.tee ─────────────────────────────────────────────────────────────


async def test_tee_passes_rows_through_unchanged():
    rows = _rows()
    ctx = _ctx({}, {"rows": rows, "count": 3, "row_ids": ["a", "b", "c"]})
    out = await _run_flow_tee(ctx)
    assert out["rows"] == rows
    assert out["count"] == 3
    assert out["mutated"] is False
    assert out["summary"] == "Passed 3 rows through"


# ── gate.non_empty ───────────────────────────────────────────────────────


async def test_non_empty_gate_passes_with_rows():
    ctx = _ctx({}, {"rows": _rows(), "count": 3})
    out = await _run_gate_non_empty(ctx)
    assert out["count"] == 3


async def test_non_empty_gate_stops_on_zero_rows():
    ctx = _ctx({}, {"rows": [], "count": 0})
    with pytest.raises(ValueError, match="Non-empty gate failed"):
        await _run_gate_non_empty(ctx)


# ── source.validation_findings ───────────────────────────────────────────


class _FakeResult:
    def __init__(self, obj: Any) -> None:
        self._obj = obj

    def scalar_one_or_none(self) -> Any:
        return self._obj


class _FakeReport:
    status = "warnings"
    results = [
        {"rule_id": "boq_quality.zero_price", "status": "warning", "message": "Zero price", "element_ref": "p1"},
        {"rule_id": "din276.kg_required", "status": "error", "message": "Missing KG", "element_ref": "p2"},
        "not-a-dict-should-be-skipped",
    ]


class _FakeSession:
    def __init__(self, report: Any) -> None:
        self._report = report

    async def execute(self, _stmt: Any) -> _FakeResult:
        return _FakeResult(self._report)


async def test_validation_findings_no_project_is_empty():
    ctx = _ctx({}, {}, db=_FakeSession(None))
    ctx.project_id = None
    out = await _run_source_validation_findings(ctx)
    assert out["count"] == 0
    assert out["rows"] == []


async def test_validation_findings_maps_report_results_to_rows():
    ctx = _ctx({"project_id": "11111111-1111-1111-1111-111111111111"}, {}, db=_FakeSession(_FakeReport()))
    out = await _run_source_validation_findings(ctx)
    assert out["count"] == 2  # the non-dict entry is skipped
    ids = {r["id"] for r in out["rows"]}
    assert ids == {"p1", "p2"}
    assert out["rows"][0]["rule_id"] == "boq_quality.zero_price"


async def test_validation_findings_no_report_yet_is_empty():
    ctx = _ctx({"project_id": "11111111-1111-1111-1111-111111111111"}, {}, db=_FakeSession(None))
    out = await _run_source_validation_findings(ctx)
    assert out["count"] == 0
    assert "No validation report" in out["summary"]


# ── registration: the palette now advertises the new node types ──────────


def test_all_new_node_types_are_registered():
    types = {spec.type for spec in node_registry.list()}
    expected = {
        "transform.compute",
        "transform.group",
        "transform.rename",
        "gate.threshold",
        "source.validation_findings",
        "flow.tee",
        "gate.non_empty",
    }
    assert expected <= types

from __future__ import annotations

from extract_controlled_values import ROW_TYPE_ALIASES, infer_unit_alias


def test_chinese_scope_row_type_maps_to_scope() -> None:
    alias = ROW_TYPE_ALIASES["工作内容"]
    assert alias["canonical_row_type_key"] == "scope_of_work"
    assert alias["audit_status"] == "approved"


def test_plant_operator_maps_to_labour_ppp_category() -> None:
    alias = ROW_TYPE_ALIASES["Plant Operator"]
    assert alias["canonical_row_type_key"] == "plant_operator"
    assert alias["ppp_category"] == "labour"


def test_unknown_resource_row_type_stays_reviewable() -> None:
    alias = ROW_TYPE_ALIASES["Resource"]
    assert alias["canonical_row_type_key"] == "resource_unknown"
    assert alias["audit_status"] == "needs_review"


def test_metric_area_alias_is_convertible() -> None:
    alias = infer_unit_alias("M²")
    assert alias["canonical_unit_key"] == "m2"
    assert alias["convertibility"] == "simple_metric"


def test_sinapi_chp_is_not_generic_hour() -> None:
    alias = infer_unit_alias("CHP")
    assert alias["canonical_unit_key"] == "productive_machine_hour"
    assert alias["convertibility"] == "do_not_convert"


def test_compound_basis_goes_to_review() -> None:
    alias = infer_unit_alias("100m3 đất nguyên thổ")
    assert alias["canonical_unit_key"] == "compound_basis"
    assert alias["audit_status"] == "needs_review"

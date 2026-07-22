# DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Pure validation engine for forms and checklists.

This module is deliberately dependency-free - stdlib only, no ORM, no FastAPI,
no app imports - so it can be unit tested on a bare interpreter without the
application graph or a database, and reused unchanged on both the create path
(template integrity) and the complete path (submission completeness).

Two jobs, both first-class in the workflow (nothing is stored or completed
without passing the relevant check):

* :func:`validate_template_fields` - a template is only coherent if every field
  is well formed: a choice field carries options, keys are unique, a rating has
  a sane scale, and there is at least one thing to actually fill in.
* :func:`validate_submission_answers` - a submission may only be *completed* when
  every required field is answered and every provided answer is consistent with
  its field (a choice value that exists, a number that parses, a photo or
  signature actually present where the field demands one).

Both return a list of :class:`FieldIssue` (empty == valid). Callers turn a
non-empty list into an HTTP 422 with the issues attached; the pure layer never
raises for *data* problems so it stays trivially testable.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from dataclasses import field as dataclass_field
from typing import Any

# Branching logic lives in the sibling ``conditional`` module. Prefer the normal
# package import; fall back to loading it from disk when this module is itself
# loaded by file path in the isolated unit tests (no package context), so the
# pure layer stays testable on a bare interpreter - just like the rest of it.
try:
    from .conditional import collect_rule_issues, evaluate_visibility, sanitize_expr
    from .formula import FormulaError, formula_field_issues, list_formula_vars
except ImportError:  # pragma: no cover - exercised only under path-based loading
    import importlib.util as _importlib_util
    import sys as _sys
    from pathlib import Path as _Path

    def _load_sibling(mod_name: str, filename: str):  # noqa: ANN202 - dynamic handle
        if mod_name in _sys.modules:
            return _sys.modules[mod_name]
        path = _Path(__file__).resolve().parent / filename
        spec = _importlib_util.spec_from_file_location(mod_name, path)
        assert spec and spec.loader
        module = _importlib_util.module_from_spec(spec)
        _sys.modules[mod_name] = module
        spec.loader.exec_module(module)
        return module

    _conditional = _load_sibling("forms_conditional", "conditional.py")
    collect_rule_issues = _conditional.collect_rule_issues
    evaluate_visibility = _conditional.evaluate_visibility
    sanitize_expr = _conditional.sanitize_expr

    _formula = _load_sibling("forms_formula", "formula.py")
    FormulaError = _formula.FormulaError
    formula_field_issues = _formula.formula_field_issues
    list_formula_vars = _formula.list_formula_vars

# ── Field vocabulary ─────────────────────────────────────────────────────────

# Every field type a template may compose. Ordered as they appear in the
# builder palette. Keep in lock-step with the frontend FIELD_TYPES list.
FIELD_TYPES: tuple[str, ...] = (
    "section",  # a heading / divider - carries no answer
    "short_text",
    "long_text",
    "number",  # numeric, optional unit
    "single_choice",  # pick one of options
    "multi_choice",  # pick any of options
    "checkbox",  # a single boolean acknowledgement
    "pass_fail_na",  # pass / fail / n/a - the checklist workhorse
    "rating",  # 1..max_rating
    "photo",  # photo evidence (one or more references)
    "signature",  # a captured signature (name + optional image data)
    "date",
    "formula",  # a value computed from other fields (never user-entered)
)

# Types that require a non-empty ``options`` list to mean anything.
CHOICE_TYPES: frozenset[str] = frozenset({"single_choice", "multi_choice"})

# Types that carry no answer - they structure the form but are never filled in.
LAYOUT_TYPES: frozenset[str] = frozenset({"section"})

# Types whose value is derived, not entered: the user never fills them, so they
# are never "required" and their stored value is server-computed, not validated
# against a user answer.
COMPUTED_TYPES: frozenset[str] = frozenset({"formula"})

# Free-text types that support a ``min_length`` / ``pattern`` constraint.
TEXT_TYPES: frozenset[str] = frozenset({"short_text", "long_text"})

# Types that support a numeric ``min`` / ``max`` bound.
BOUNDED_TYPES: frozenset[str] = frozenset({"number"})

# Types that support a free-text ``placeholder``.
PLACEHOLDER_TYPES: frozenset[str] = frozenset({"short_text", "long_text", "number"})

# The pass/fail/NA values a checklist item may take (lower-cased on compare).
PASS_FAIL_VALUES: frozenset[str] = frozenset({"pass", "fail", "na"})

# Template categories. ``custom`` is the catch-all for anything user-defined.
CATEGORIES: tuple[str, ...] = (
    "safety",
    "quality",
    "handover",
    "inspection",
    "commissioning",
    "custom",
)

# Guard rails so a hand-crafted rating scale stays legible.
RATING_MIN_SCALE = 2
RATING_MAX_SCALE = 10
DEFAULT_RATING_SCALE = 5

# Ceiling on field count per template - a builder that lets a user add 5000
# fields is a footgun, not a feature.
MAX_FIELDS_PER_TEMPLATE = 300


# ── Issue model ──────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class FieldIssue:
    """One problem found with a field definition or an answer.

    ``field_index`` locates the field in the ordered list; ``field_key`` is its
    stable key when one exists. ``code`` is a stable machine token (for the UI
    to branch on / translate), ``message`` a plain-English fallback.
    """

    field_index: int
    field_key: str | None
    code: str
    message: str

    def as_dict(self) -> dict[str, Any]:
        """Serialise for an HTTP error payload."""
        return {
            "field_index": self.field_index,
            "field_key": self.field_key,
            "code": self.code,
            "message": self.message,
        }


# ── Helpers ──────────────────────────────────────────────────────────────────

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def slugify(text: str) -> str:
    """Reduce a label to a stable lower-snake key fragment.

    Empty / punctuation-only text yields ``""`` so the caller can fall back to
    a positional key (``field_1``) instead of emitting an empty key.
    """
    slug = _SLUG_RE.sub("_", str(text or "").strip().lower()).strip("_")
    return slug[:60]


def normalize_fields(raw_fields: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return a cleaned copy of ``raw_fields`` with keys and defaults filled.

    Does not validate (that is :func:`validate_template_fields`); it only makes
    the list canonical so persistence and validation see the same shape:

    * a missing / blank ``key`` is derived from the label (``slugify``), then
      de-duplicated with a numeric suffix so keys stay unique;
    * ``required`` is coerced to bool and forced ``False`` for layout fields;
    * ``options`` is coerced to a list of trimmed strings;
    * ``max_rating`` defaults to :data:`DEFAULT_RATING_SCALE` for rating fields.

    The input is never mutated.
    """
    cleaned: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    for idx, raw in enumerate(raw_fields):
        src = dict(raw) if isinstance(raw, dict) else {}
        ftype = str(src.get("type", "")).strip()
        label = str(src.get("label", "")).strip()

        # Derive a stable, unique key.
        key = str(src.get("key", "")).strip()
        if not key:
            key = slugify(label) or f"field_{idx + 1}"
        base_key = key
        suffix = 2
        while key in seen_keys:
            key = f"{base_key}_{suffix}"
            suffix += 1
        seen_keys.add(key)

        field: dict[str, Any] = {
            "key": key,
            "type": ftype,
            "label": label,
            "help_text": str(src.get("help_text", "") or "").strip() or None,
        }

        is_layout = ftype in LAYOUT_TYPES
        field["required"] = bool(src.get("required", False)) and not is_layout

        if ftype in CHOICE_TYPES:
            field["options"] = _clean_options(src.get("options"))
        if ftype == "number":
            unit = str(src.get("unit", "") or "").strip()
            field["unit"] = unit or None
        if ftype == "rating":
            field["max_rating"] = _coerce_rating_scale(src.get("max_rating"))
        if ftype == "formula":
            expr = str(src.get("formula", "") or "").strip()
            if expr:
                field["formula"] = expr

        # Per-field capture config, carried only for the types it applies to so a
        # stored field stays compact (a number never carries a ``pattern``, a
        # section never carries a ``placeholder``).
        if not is_layout and ftype not in COMPUTED_TYPES:
            placeholder = str(src.get("placeholder", "") or "").strip()
            if placeholder and ftype in PLACEHOLDER_TYPES:
                field["placeholder"] = placeholder[:200]
            default = _clean_default(ftype, src.get("default"))
            if default is not None:
                field["default"] = default
            if ftype in BOUNDED_TYPES:
                low = _coerce_number(src.get("min"))
                high = _coerce_number(src.get("max"))
                if low is not None:
                    field["min"] = low
                if high is not None:
                    field["max"] = high
            if ftype in TEXT_TYPES:
                min_length = _coerce_int(src.get("min_length"))
                if min_length is not None and min_length > 0:
                    field["min_length"] = min_length
                pattern = str(src.get("pattern", "") or "").strip()
                if pattern:
                    field["pattern"] = pattern[:300]

        # Carry optional branching rules through, cleaned to a compact JSON-safe
        # shape. Absent / empty rules are simply omitted (the field is
        # unconditionally shown / uses its static ``required`` flag).
        visible_if = sanitize_expr(src.get("visible_if"))
        if visible_if is not None:
            field["visible_if"] = visible_if
        required_if = sanitize_expr(src.get("required_if"))
        if required_if is not None:
            field["required_if"] = required_if

        cleaned.append(field)
    return cleaned


def _clean_options(raw: Any) -> list[str]:
    """Coerce an options value to a list of trimmed, de-duplicated strings."""
    if not isinstance(raw, (list, tuple)):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        text = str(item).strip()
        if text and text not in seen:
            seen.add(text)
            out.append(text)
    return out


def _coerce_rating_scale(raw: Any) -> int:
    """Coerce a rating scale to an int, defaulting when absent / unparseable."""
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_RATING_SCALE
    return value


def _coerce_number(raw: Any) -> float | int | None:
    """Coerce a config bound to a JSON number, or ``None`` when absent/blank."""
    if raw is None or (isinstance(raw, str) and raw.strip() == ""):
        return None
    parsed = _to_float(raw)
    if parsed is None:
        return None
    return int(parsed) if float(parsed).is_integer() else parsed


def _coerce_int(raw: Any) -> int | None:
    """Coerce a config integer (e.g. min_length), or ``None`` when unparseable."""
    parsed = _to_float(raw)
    return None if parsed is None else int(parsed)


def _clean_default(ftype: str, raw: Any) -> Any:
    """Coerce a field default to a JSON-safe value matching the field type.

    Empty strings / empty lists collapse to ``None`` (no default). Multi-choice
    defaults are a list of strings; a checkbox default is a bool; everything else
    is a trimmed string. Choice-option membership is checked separately by the
    template validator, not here.
    """
    if raw is None:
        return None
    if ftype == "checkbox":
        return bool(raw) if isinstance(raw, bool) else str(raw).strip().lower() in ("true", "1", "yes", "on")
    if ftype == "multi_choice":
        if not isinstance(raw, (list, tuple)):
            return None
        picked = [str(v).strip() for v in raw if str(v).strip()]
        return picked or None
    text = str(raw).strip()
    return text[:500] or None


# ── Template integrity ───────────────────────────────────────────────────────


def validate_template_fields(fields: list[dict[str, Any]]) -> list[FieldIssue]:
    """Validate a template's field definitions. Empty list == valid.

    Assumes ``fields`` has been through :func:`normalize_fields` (keys present,
    options coerced) but does not rely on it for safety - it re-checks the
    invariants that matter:

    * at least one and at most :data:`MAX_FIELDS_PER_TEMPLATE` fields;
    * at least one non-layout field (a template of only headers cannot be filled);
    * each field: known type, non-empty label, non-empty unique key;
    * a choice field carries at least two distinct options;
    * a rating field's scale is within [:data:`RATING_MIN_SCALE`,
      :data:`RATING_MAX_SCALE`];
    * every ``visible_if`` / ``required_if`` branching rule is well formed - a
      whitelisted operator, a field that exists, no self reference (see
      :func:`conditional.collect_rule_issues`).
    """
    issues: list[FieldIssue] = []

    if not fields:
        issues.append(FieldIssue(-1, None, "no_fields", "A template needs at least one field."))
        return issues
    if len(fields) > MAX_FIELDS_PER_TEMPLATE:
        issues.append(
            FieldIssue(
                -1,
                None,
                "too_many_fields",
                f"A template may have at most {MAX_FIELDS_PER_TEMPLATE} fields.",
            )
        )

    seen_keys: set[str] = set()
    fillable = 0
    for idx, field in enumerate(fields):
        ftype = str(field.get("type", "")).strip()
        label = str(field.get("label", "")).strip()
        key = str(field.get("key", "")).strip()

        if ftype not in FIELD_TYPES:
            issues.append(FieldIssue(idx, key or None, "unknown_type", f"Unknown field type '{ftype or '(blank)'}'."))
        if not label:
            issues.append(FieldIssue(idx, key or None, "missing_label", "Every field needs a label."))
        if not key:
            issues.append(FieldIssue(idx, None, "missing_key", "Every field needs a key."))
        elif key in seen_keys:
            issues.append(FieldIssue(idx, key, "duplicate_key", f"Duplicate field key '{key}'."))
        else:
            seen_keys.add(key)

        # Only a field the user can actually enter counts as "fillable"; a
        # section is layout and a formula is computed, so a form of only those
        # has nothing to fill in.
        if ftype not in LAYOUT_TYPES and ftype not in COMPUTED_TYPES:
            fillable += 1

        if ftype in CHOICE_TYPES:
            options = field.get("options")
            distinct = _clean_options(options)
            if len(distinct) < 2:
                issues.append(
                    FieldIssue(
                        idx,
                        key or None,
                        "choice_needs_options",
                        "A choice field needs at least two distinct options.",
                    )
                )

        if ftype == "rating":
            scale = _coerce_rating_scale(field.get("max_rating"))
            if not (RATING_MIN_SCALE <= scale <= RATING_MAX_SCALE):
                issues.append(
                    FieldIssue(
                        idx,
                        key or None,
                        "rating_scale",
                        f"A rating scale must be between {RATING_MIN_SCALE} and {RATING_MAX_SCALE}.",
                    )
                )

        _append_config_issues(idx, key or None, field, issues)

    if fillable == 0:
        issues.append(
            FieldIssue(
                -1,
                None,
                "no_fillable_field",
                "A template needs at least one field to fill in, not only section headers.",
            )
        )

    # Branching rules: a bad operator / dangling reference is a template bug,
    # rejected here so it never reaches storage or a submission snapshot.
    issues.extend(FieldIssue(ri.field_index, ri.field_key, ri.code, ri.message) for ri in collect_rule_issues(fields))

    # Formula fields: a broken expression, a reference to a missing field, a self
    # reference or a cycle among formulas is rejected here too.
    issues.extend(FieldIssue(fi, fk, code, msg) for fi, fk, code, msg in formula_field_issues(fields))

    return issues


def _append_config_issues(
    idx: int,
    key: str | None,
    field: dict[str, Any],
    issues: list[FieldIssue],
) -> None:
    """Validate a field's per-field capture config (bounds, length, pattern).

    Reported problems: ``min`` greater than ``max`` on a number field, a negative
    ``min_length``, a ``pattern`` that is not a compilable regular expression, and
    a ``default`` that is not one of a choice field's options.
    """
    ftype = str(field.get("type", "")).strip()

    if ftype in BOUNDED_TYPES:
        low = _coerce_number(field.get("min"))
        high = _coerce_number(field.get("max"))
        if low is not None and high is not None and low > high:
            issues.append(FieldIssue(idx, key, "min_gt_max", "The minimum cannot be greater than the maximum."))

    if ftype in TEXT_TYPES:
        min_length = _coerce_int(field.get("min_length"))
        if min_length is not None and min_length < 0:
            issues.append(FieldIssue(idx, key, "bad_min_length", "Minimum length cannot be negative."))
        pattern = str(field.get("pattern", "") or "").strip()
        if pattern:
            try:
                re.compile(pattern)
            except re.error:
                issues.append(FieldIssue(idx, key, "bad_pattern", "The validation pattern is not a valid regular expression."))

    # A single/multi choice default must be an actual option.
    default = field.get("default")
    if default is not None and ftype in CHOICE_TYPES:
        options = set(_clean_options(field.get("options")))
        picked = default if isinstance(default, (list, tuple)) else [default]
        for item in picked:
            if str(item).strip() and str(item).strip() not in options:
                issues.append(FieldIssue(idx, key, "default_not_option", "The default value is not one of the options."))
                break


# ── Submission completeness / consistency ────────────────────────────────────


@dataclass
class SubmissionCheck:
    """Outcome of validating a submission's answers against its fields."""

    issues: list[FieldIssue] = dataclass_field(default_factory=list)
    answered_required: int = 0
    total_required: int = 0

    @property
    def is_complete(self) -> bool:
        """True when there are no issues (every required field answered, all
        provided answers well formed)."""
        return not self.issues


def validate_submission_answers(
    fields: list[dict[str, Any]],
    answers: dict[str, Any],
) -> SubmissionCheck:
    """Validate ``answers`` against the (snapshotted) template ``fields``.

    Two concerns, both blocking a Complete:

    * completeness - every ``required`` non-layout field has a non-empty answer
      (a required checkbox must be ticked; a required photo / signature field
      must actually carry a photo / signature);
    * consistency - any *provided* answer must be well formed for its type: a
      choice value must be one of the options, a number must parse, a rating
      must sit inside the scale, a pass/fail/na must be one of those three.

    Branching logic is honoured first (see :func:`conditional.evaluate_visibility`):
    a field hidden by a ``visible_if`` rule is skipped entirely - neither required
    nor consistency-checked, so a value left over from an untaken branch never
    blocks completion - and a field a ``required_if`` rule switches on is enforced
    exactly like a statically required one.

    Absent answers to optional (or hidden) fields are fine and never reported.
    """
    check = SubmissionCheck()
    answers = answers or {}
    visibility = evaluate_visibility(fields, answers)

    for idx, field in enumerate(fields):
        ftype = str(field.get("type", "")).strip()
        # Layout fields carry no answer; computed (formula) fields are filled by
        # the server, never the user, so neither is required or value-checked.
        if ftype in LAYOUT_TYPES or ftype in COMPUTED_TYPES:
            continue

        key = str(field.get("key", "")).strip()
        state = visibility.get(key)
        if state is not None and not state["visible"]:
            # Hidden by a branching rule: not required, value ignored.
            continue
        required = state["required"] if state is not None else bool(field.get("required", False))
        value = answers.get(key)
        empty = _is_empty_answer(ftype, value)

        if required:
            check.total_required += 1

        if empty:
            if required:
                check.issues.append(
                    FieldIssue(
                        idx,
                        key or None,
                        "required_missing",
                        f"'{field.get('label') or key}' is required.",
                    )
                )
            continue

        if required:
            check.answered_required += 1

        value_issue = _answer_value_issue(idx, field, value)
        if value_issue is not None:
            check.issues.append(value_issue)

    return check


def _is_empty_answer(ftype: str, value: Any) -> bool:
    """Whether ``value`` counts as "not answered" for a field of ``ftype``.

    A ``checkbox`` is special: an *unticked* box (``False``) is treated as
    empty, so a required acknowledgement checkbox genuinely forces a tick
    rather than accepting the default.
    """
    if value is None:
        return True
    if ftype == "checkbox":
        return value is not True
    if ftype in ("short_text", "long_text", "pass_fail_na", "date", "single_choice"):
        return str(value).strip() == ""
    if ftype == "multi_choice":
        return not (isinstance(value, (list, tuple)) and len([v for v in value if str(v).strip()]) > 0)
    if ftype == "photo":
        # Accept a list of references or a single non-empty reference/marker.
        if isinstance(value, (list, tuple)):
            return len([v for v in value if str(v).strip()]) == 0
        return str(value).strip() == ""
    if ftype == "signature":
        return _signature_is_empty(value)
    if ftype in ("number", "rating"):
        return str(value).strip() == "" if isinstance(value, str) else value is None
    return str(value).strip() == "" if isinstance(value, str) else False


def _signature_is_empty(value: Any) -> bool:
    """A signature is present when it has a signer name or captured image data."""
    if isinstance(value, dict):
        name = str(value.get("name", "") or "").strip()
        data = str(value.get("data", "") or "").strip()
        return not (name or data)
    return str(value or "").strip() == ""


def _answer_value_issue(idx: int, field: dict[str, Any], value: Any) -> FieldIssue | None:
    """Consistency check for a *provided* answer. None == fine.

    Only reached for non-empty answers, so it never doubles up with the
    required-missing check.
    """
    ftype = str(field.get("type", "")).strip()
    key = str(field.get("key", "")).strip() or None

    if ftype == "single_choice":
        options = _clean_options(field.get("options"))
        if str(value).strip() not in options:
            return FieldIssue(idx, key, "invalid_choice", "Answer is not one of the allowed options.")
        return None

    if ftype == "multi_choice":
        options = set(_clean_options(field.get("options")))
        picked = value if isinstance(value, (list, tuple)) else [value]
        for item in picked:
            if str(item).strip() and str(item).strip() not in options:
                return FieldIssue(idx, key, "invalid_choice", f"'{item}' is not one of the allowed options.")
        return None

    if ftype == "pass_fail_na":
        if str(value).strip().lower() not in PASS_FAIL_VALUES:
            return FieldIssue(idx, key, "invalid_pass_fail", "Answer must be pass, fail or n/a.")
        return None

    if ftype == "number":
        number = _to_float(value)
        if number is None:
            return FieldIssue(idx, key, "not_a_number", "Answer must be a number.")
        low = _coerce_number(field.get("min"))
        high = _coerce_number(field.get("max"))
        if low is not None and number < low:
            return FieldIssue(idx, key, "below_min", f"Answer must be at least {low}.")
        if high is not None and number > high:
            return FieldIssue(idx, key, "above_max", f"Answer must be at most {high}.")
        return None

    if ftype in TEXT_TYPES:
        text = str(value)
        min_length = _coerce_int(field.get("min_length"))
        if min_length is not None and min_length > 0 and len(text.strip()) < min_length:
            return FieldIssue(idx, key, "too_short", f"Answer must be at least {min_length} character(s).")
        pattern = str(field.get("pattern", "") or "").strip()
        if pattern:
            try:
                if re.fullmatch(pattern, text) is None:
                    return FieldIssue(idx, key, "pattern_mismatch", "Answer does not match the required format.")
            except re.error:
                # A bad pattern is a template bug (rejected on save); never block a
                # completion over it here.
                return None
        return None

    if ftype == "rating":
        scale = _coerce_rating_scale(field.get("max_rating"))
        rating = _to_float(value)
        if rating is None or not (1 <= rating <= scale) or float(rating).is_integer() is False:
            return FieldIssue(idx, key, "invalid_rating", f"Rating must be a whole number from 1 to {scale}.")
        return None

    return None


def _to_float(value: Any) -> float | None:
    """Parse a numeric answer to float, tolerating a comma decimal. None on fail."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value or "").strip().replace(",", ".")
    if text == "":
        return None
    try:
        return float(text)
    except ValueError:
        return None

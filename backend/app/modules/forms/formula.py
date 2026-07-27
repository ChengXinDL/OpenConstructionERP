# DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Computed (formula) fields for form templates.

A ``formula`` field carries no user input; its value is derived from the answers
already given on the same form via a small arithmetic expression written against
other fields' keys, e.g. ``length * width`` or ``round(area * 1.15, 2)``.

Safety is the whole point. The expression is parsed to an AST and every node is
walked against a minimal allow-list; anything outside that grammar is rejected at
parse time. There is NO ``eval`` / ``exec``, no attribute or subscript access, no
comparisons, no names beyond the field keys the caller supplies, and only the
pure functions ``round`` / ``min`` / ``max``. All arithmetic is ``Decimal`` so
values stay exact. This mirrors the proven approach used by
``app.modules.boq.quantity_formula`` but is kept self-contained (stdlib only, no
app imports) so it unit-tests on a bare interpreter and is loadable by file path
like the rest of the forms pure layer.

Two jobs:

* :func:`validate_formula` / :func:`formula_field_issues` - static checks used on
  the template save path: the grammar is legal, every referenced key exists and
  is a field the formula may read, and no formula field depends on itself
  (directly or through a cycle of formula fields).
* :func:`compute_formulas` - the run-time pass used on the submission complete
  path: resolve every formula field's value from the current answers, in
  dependency order, and fold the results back into the answers map. It never
  raises for *data* problems - a division by zero or a blank operand yields a
  blank value for that field rather than breaking a completion.
"""

from __future__ import annotations

import ast
import math
import re
from collections.abc import Mapping
from decimal import ROUND_HALF_UP, Decimal, DivisionByZero, InvalidOperation
from typing import Any

# Guardrails - a form formula is a short arithmetic expression, never a program.
MAX_FORMULA_LEN = 512
MAX_AST_DEPTH = 32

_NUMERIC_STR_RE = re.compile(r"^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$")


class FormulaError(ValueError):
    """Base class for every formula problem (all are 4xx-worthy)."""


class FormulaSyntaxError(FormulaError):
    """The formula is empty, too long, unparsable, or uses a banned construct."""


class FormulaMathError(FormulaError):
    """The formula is well-formed but cannot be evaluated (e.g. div by zero)."""


class UnknownVariableError(FormulaError):
    """The formula references a name the caller did not supply."""


# ── Parser / safety walk ──────────────────────────────────────────────────────

# Only these node types may appear anywhere in a formula. Everything else (Call
# to a non-allow-listed name, Attribute, Subscript, Compare, BoolOp, Pow, Mod,
# IfExp, containers, comprehensions, ...) is rejected before evaluation.
_ALLOWED_BINOPS = (ast.Add, ast.Sub, ast.Mult, ast.Div)
_ALLOWED_UNARYOPS = (ast.UAdd, ast.USub)

# The only function calls a formula may contain. All are pure and Decimal-safe.
_ALLOWED_FUNCS = frozenset({"round", "min", "max"})


def _strip_lead(expr: str) -> str:
    text = (expr or "").strip()
    if text.startswith("="):  # tolerate a spreadsheet-style leading '='
        text = text[1:].strip()
    return text


def _parse(formula: str) -> ast.Expression:
    text = _strip_lead(formula)
    if not text:
        raise FormulaSyntaxError("empty formula")
    if len(text) > MAX_FORMULA_LEN:
        raise FormulaSyntaxError(f"formula too long (>{MAX_FORMULA_LEN} chars)")
    try:
        tree = ast.parse(text, mode="eval")
    except (SyntaxError, ValueError) as exc:
        raise FormulaSyntaxError(f"invalid formula: {text!r}") from exc
    return tree


def _check_safe(tree: ast.Expression) -> None:
    """Reject any node type outside the minimal arithmetic grammar."""

    def walk(node: ast.AST, depth: int) -> None:
        if depth > MAX_AST_DEPTH:
            raise FormulaSyntaxError("formula nested too deeply")
        if isinstance(node, ast.Expression):
            walk(node.body, depth + 1)
            return
        if isinstance(node, ast.Constant):
            if isinstance(node.value, bool) or not isinstance(node.value, (int, float)):
                raise FormulaSyntaxError(f"unsupported literal: {node.value!r}")
            if isinstance(node.value, float) and not math.isfinite(node.value):
                raise FormulaSyntaxError("non-finite numeric literal")
            return
        if isinstance(node, ast.Name):
            if not isinstance(node.ctx, ast.Load):
                raise FormulaSyntaxError("names are read-only in a formula")
            return
        if isinstance(node, ast.BinOp):
            if not isinstance(node.op, _ALLOWED_BINOPS):
                raise FormulaSyntaxError("only + - * / are allowed")
            walk(node.left, depth + 1)
            walk(node.right, depth + 1)
            return
        if isinstance(node, ast.UnaryOp):
            if not isinstance(node.op, _ALLOWED_UNARYOPS):
                raise FormulaSyntaxError("only unary + / - are allowed")
            walk(node.operand, depth + 1)
            return
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name) or node.func.id not in _ALLOWED_FUNCS:
                raise FormulaSyntaxError("only round / min / max function calls are allowed")
            if node.keywords:
                raise FormulaSyntaxError("function keyword arguments are not allowed")
            name = node.func.id
            n_args = len(node.args)
            if name == "round" and n_args not in (1, 2):
                raise FormulaSyntaxError("round takes 1 or 2 arguments")
            if name in ("min", "max") and n_args < 1:
                raise FormulaSyntaxError(f"{name} needs at least one argument")
            for arg in node.args:
                if isinstance(arg, ast.Starred):
                    raise FormulaSyntaxError("star-arguments are not allowed")
                walk(arg, depth + 1)
            return
        raise FormulaSyntaxError(f"unsupported expression: {type(node).__name__}")

    walk(tree, 0)


def validate_formula(formula: str) -> None:
    """Parse + safety-check a formula. Raise :class:`FormulaSyntaxError` if bad.

    Does NOT evaluate (no variables needed), so it is safe to call at
    create/update time to reject a malformed formula as a 4xx up front.
    """
    _check_safe(_parse(formula))


def list_formula_vars(formula: str) -> list[str]:
    """Return the variable (field-key) names a formula references, first-seen.

    Function-position names (the ``round`` in ``round(x)``) are excluded, so an
    allow-listed call never looks like an undeclared reference.
    """
    tree = _parse(formula)
    _check_safe(tree)
    func_names = {id(n.func) for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
    ordered = sorted(
        ((n.lineno, n.col_offset, n.id) for n in ast.walk(tree) if isinstance(n, ast.Name) and id(n) not in func_names),
        key=lambda item: (item[0], item[1]),
    )
    seen: list[str] = []
    for _lineno, _col, name in ordered:
        if name not in seen:
            seen.append(name)
    return seen


# ── Value coercion ─────────────────────────────────────────────────────────────


def is_numeric_value(value: Any) -> bool:
    """True when ``value`` is a finite number or a plain numeric string.

    Booleans are not numeric. A comma decimal (``"22,5"``) is accepted, matching
    the number-field parser in ``validation``.
    """
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        return math.isfinite(value)
    if isinstance(value, str):
        return bool(_NUMERIC_STR_RE.match(value.strip().replace(",", ".")))
    return False


def _to_decimal(value: Any) -> Decimal:
    """Coerce a numeric value/string to Decimal via ``str`` (exact, no float)."""
    try:
        return Decimal(str(value).strip().replace(",", "."))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise FormulaMathError(f"not a number: {value!r}") from exc


# ── Evaluation ─────────────────────────────────────────────────────────────────


def _eval(node: ast.AST, variables: Mapping[str, Decimal], depth: int) -> Decimal:
    if depth > MAX_AST_DEPTH:
        raise FormulaSyntaxError("formula nested too deeply")
    if isinstance(node, ast.Constant):
        return _to_decimal(node.value)
    if isinstance(node, ast.Name):
        if node.id in variables:
            return variables[node.id]
        raise UnknownVariableError(f"unknown variable: {node.id!r}")
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, _ALLOWED_UNARYOPS):
        val = _eval(node.operand, variables, depth + 1)
        return val if isinstance(node.op, ast.UAdd) else -val
    if isinstance(node, ast.BinOp) and isinstance(node.op, _ALLOWED_BINOPS):
        left = _eval(node.left, variables, depth + 1)
        right = _eval(node.right, variables, depth + 1)
        try:
            if isinstance(node.op, ast.Add):
                return left + right
            if isinstance(node.op, ast.Sub):
                return left - right
            if isinstance(node.op, ast.Mult):
                return left * right
            if right == 0:  # Div
                raise FormulaMathError("division by zero")
            return left / right
        except (InvalidOperation, DivisionByZero, ArithmeticError) as exc:
            raise FormulaMathError(f"arithmetic error: {exc}") from exc
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
        name = node.func.id
        args = [_eval(arg, variables, depth + 1) for arg in node.args]
        try:
            if name == "min":
                return min(args)
            if name == "max":
                return max(args)
            if name == "round":
                ndigits = int(args[1]) if len(args) == 2 else 0
                if ndigits < 0:
                    raise FormulaMathError("round digits must be >= 0")
                quantum = Decimal(1).scaleb(-ndigits)
                return args[0].quantize(quantum, rounding=ROUND_HALF_UP)
        except (InvalidOperation, DivisionByZero, ArithmeticError) as exc:
            raise FormulaMathError(f"arithmetic error: {exc}") from exc
    # Unreachable after _check_safe, but never fall through to eval.
    raise FormulaSyntaxError(f"unsupported expression: {type(node).__name__}")


def evaluate_formula(formula: str, variables: Mapping[str, Any]) -> Decimal:
    """Evaluate ``formula`` against ``variables`` and return an exact Decimal.

    ``variables`` maps field key -> numeric value (Decimal / int / float /
    numeric string). Raises :class:`FormulaSyntaxError` for a banned/broken
    grammar, :class:`UnknownVariableError` for an unsupplied name, and
    :class:`FormulaMathError` for division by zero or a non-finite result.
    """
    tree = _parse(formula)
    _check_safe(tree)
    resolved: dict[str, Decimal] = {k: _to_decimal(v) for k, v in variables.items()}
    result = _eval(tree.body, resolved, 0)
    if not result.is_finite():
        raise FormulaMathError("formula produced a non-finite result")
    return result


# ── Static template checks ─────────────────────────────────────────────────────


def formula_field_issues(fields: list[dict[str, Any]]) -> list[tuple[int, str | None, str, str]]:
    """Statically validate every ``formula`` field's expression.

    Returns a flat list of ``(field_index, field_key, code, message)`` tuples,
    shaped so the caller (``validation.validate_template_fields``) can wrap each
    in its own ``FieldIssue`` without translation. Empty list == all formulas are
    coherent. Checks:

    * the formula is present and uses only the legal grammar;
    * every referenced name is the key of another field in the template;
    * a formula never reads its own field;
    * no cycle exists among formula fields (A reads B reads A).
    """
    issues: list[tuple[int, str | None, str, str]] = []
    known_keys = {
        str(f.get("key", "")).strip() for f in fields or [] if isinstance(f, dict) and str(f.get("key", "")).strip()
    }
    # Adjacency among formula fields only, to detect reference cycles.
    formula_deps: dict[str, set[str]] = {}
    formula_index: dict[str, int] = {}

    for idx, field in enumerate(fields or []):
        if not isinstance(field, dict) or str(field.get("type", "")).strip() != "formula":
            continue
        key = str(field.get("key", "")).strip() or None
        expr = str(field.get("formula", "") or "").strip()
        if not expr:
            issues.append((idx, key, "formula_missing", "A computed field needs a formula."))
            continue
        try:
            refs = list_formula_vars(expr)
        except FormulaError as exc:
            issues.append((idx, key, "formula_invalid", f"Invalid formula: {exc}"))
            continue
        deps: set[str] = set()
        for ref in refs:
            if ref not in known_keys:
                issues.append((idx, key, "formula_unknown_ref", f"A formula refers to unknown field '{ref}'."))
            elif key is not None and ref == key:
                issues.append((idx, key, "formula_self_reference", "A formula cannot refer to its own field."))
            else:
                deps.add(ref)
        if key is not None:
            formula_deps[key] = deps
            formula_index[key] = idx

    for key in _cyclic_formula_keys(formula_deps):
        issues.append((formula_index[key], key, "formula_cycle", "Formula fields reference each other in a loop."))
    return issues


def _cyclic_formula_keys(deps: dict[str, set[str]]) -> list[str]:
    """Return the formula keys that take part in a dependency cycle.

    Only edges between formula fields matter (a formula reading a plain number
    field is never a cycle), so ``deps`` is restricted to formula-to-formula
    edges here before the walk.
    """
    formula_keys = set(deps)
    graph = {k: {d for d in v if d in formula_keys} for k, v in deps.items()}
    state: dict[str, int] = {}  # 0=unvisited, 1=on-stack, 2=done
    in_cycle: set[str] = set()

    def visit(node: str, stack: list[str]) -> None:
        state[node] = 1
        stack.append(node)
        for nxt in graph.get(node, ()):
            if state.get(nxt, 0) == 0:
                visit(nxt, stack)
            elif state.get(nxt) == 1:
                # Back-edge: everything from nxt up the stack is in the cycle.
                if nxt in stack:
                    in_cycle.update(stack[stack.index(nxt) :])
        stack.pop()
        state[node] = 2

    for key in formula_keys:
        if state.get(key, 0) == 0:
            visit(key, [])
    return sorted(in_cycle)


# ── Run-time compute pass ──────────────────────────────────────────────────────


def compute_formulas(
    fields: list[dict[str, Any]],
    answers: dict[str, Any],
    *,
    blank_as_zero: bool = True,
) -> dict[str, Any]:
    """Return a copy of ``answers`` with every ``formula`` field's value filled in.

    Formula fields are resolved in dependency order so a formula that reads
    another formula sees the computed value. A blank / non-numeric operand is
    treated as ``0`` when ``blank_as_zero`` (so a running total works before the
    whole form is filled); set it ``False`` to leave a formula blank until all its
    inputs are numeric. A formula that cannot be evaluated (division by zero, a
    reference cycle) yields ``None`` for that field rather than raising, so this
    can never break a submission.

    The returned values are plain ``float`` (JSON-friendly), or ``None`` when a
    formula could not resolve.
    """
    result = dict(answers or {})
    order = _formula_eval_order(fields)
    for key, expr, idx in order:
        del idx  # ordering only
        variables = _formula_variables(fields, result, blank_as_zero=blank_as_zero)
        try:
            value = evaluate_formula(expr, variables)
        except FormulaError:
            result[key] = None
            continue
        result[key] = _decimal_to_json(value)
    return result


def _formula_eval_order(fields: list[dict[str, Any]]) -> list[tuple[str, str, int]]:
    """Order formula fields so dependencies compute first (cycles pushed last).

    Returns ``(key, formula_expr, field_index)`` tuples. A malformed formula is
    skipped (it is a template-validation error caught elsewhere).
    """
    formulas: dict[str, tuple[str, int]] = {}
    deps: dict[str, set[str]] = {}
    for idx, field in enumerate(fields or []):
        if not isinstance(field, dict) or str(field.get("type", "")).strip() != "formula":
            continue
        key = str(field.get("key", "")).strip()
        expr = str(field.get("formula", "") or "").strip()
        if not key or not expr:
            continue
        try:
            refs = set(list_formula_vars(expr))
        except FormulaError:
            continue
        formulas[key] = (expr, idx)
        deps[key] = refs

    ordered: list[tuple[str, str, int]] = []
    placed: set[str] = set()
    # Simple stable Kahn-style pass, capped so a cycle cannot loop forever; any
    # keys left over (cyclic) are appended in field order and will resolve to
    # None at eval time.
    remaining = dict(formulas)
    for _ in range(len(formulas)):
        progressed = False
        for key in list(remaining):
            formula_deps = {d for d in deps.get(key, set()) if d in formulas}
            if formula_deps <= placed:
                expr, idx = remaining.pop(key)
                ordered.append((key, expr, idx))
                placed.add(key)
                progressed = True
        if not progressed:
            break
    for key in sorted(remaining, key=lambda k: formulas[k][1]):
        expr, idx = formulas[key]
        ordered.append((key, expr, idx))
    return ordered


def _formula_variables(
    fields: list[dict[str, Any]],
    answers: dict[str, Any],
    *,
    blank_as_zero: bool,
) -> dict[str, Decimal]:
    """Build the variable map a formula sees: every field key -> numeric answer.

    Numeric answers (number / rating / a numeric-string text answer / a computed
    formula value) map to a Decimal. A blank or non-numeric answer maps to ``0``
    when ``blank_as_zero``; otherwise the key is omitted so a formula reading it
    raises :class:`UnknownVariableError` and yields a blank result.
    """
    out: dict[str, Decimal] = {}
    for field in fields or []:
        if not isinstance(field, dict):
            continue
        key = str(field.get("key", "")).strip()
        if not key:
            continue
        value = answers.get(key)
        if is_numeric_value(value):
            out[key] = _to_decimal(value)
        elif blank_as_zero:
            out[key] = Decimal(0)
    return out


def _decimal_to_json(value: Decimal) -> float | int:
    """Render a Decimal result as an int when whole, else a float, for JSON."""
    if value == value.to_integral_value():
        return int(value)
    return float(value)

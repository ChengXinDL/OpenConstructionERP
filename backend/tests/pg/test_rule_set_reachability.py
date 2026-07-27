"""Every rule set a module asks the engine for must resolve to real rules.

A rule set is a name, and nothing checks that the name means anything. Rules
register into the set named by their ``standard`` unless the registration
passes an explicit list, so renaming a constant, or writing a rule whose
``standard`` does not match the set its module requests, leaves the module
calling ``validate(rule_sets=["something"])`` against an empty set. The call
succeeds. The report comes back clean. Nothing ran.

That is not hypothetical: three ``ai_takeoff`` rules shipped with full i18n
messages in three languages and never executed once, because no caller ever
passed that set name. The rules were eventually deleted, but the shape that
hid them is still here, and it is invisible to every other kind of test. A
behaviour test for a dormant rule passes by asserting the absence of a
finding, which is exactly what a dormant rule produces.

Registration happens along two routes and the check has to know both, or it
reports its own blind spot as a defect. Core rules land in the registry when
``register_builtin_rules`` runs. Module rules land when the module loader
awaits that package's ``on_startup`` hook, which no test process does. So the
first route is checked by asking the live registry and the second by reading
the source: a set counts as reachable if some module registers into it and the
package exposes the startup hook that performs the registration.

These tests live in the PG lane because that lane is a merge gate and the
default unit lane is not. The check itself needs no database.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from app.core.validation.engine import rule_registry
from app.core.validation.rules import register_builtin_rules

MODULES_DIR = Path(__file__).resolve().parents[2] / "app" / "modules"

#: Suffix that marks a module-level constant as a rule set name.
RULE_SET_SUFFIX = "_RULE_SET"


def _string_constants(tree: ast.Module) -> dict[str, str]:
    """Map module-level ``NAME = "value"`` string constants by name."""
    out: dict[str, str] = {}
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign) or not isinstance(node.value, ast.Constant):
            continue
        if not isinstance(node.value.value, str):
            continue
        for target in node.targets:
            if isinstance(target, ast.Name):
                out[target.id] = node.value.value
    return out


def _parsed_modules() -> dict[Path, ast.Module]:
    """Parse every module source once.

    Parsing rather than importing keeps a module that fails to import for an
    unrelated reason from quietly dropping its rule sets out of the check.
    """
    trees: dict[Path, ast.Module] = {}
    for path in sorted(MODULES_DIR.rglob("*.py")):
        try:
            trees[path] = ast.parse(path.read_text(encoding="utf-8"))
        except SyntaxError:  # pragma: no cover - a broken file fails elsewhere
            continue
    return trees


def _declared_rule_sets(trees: dict[Path, ast.Module]) -> dict[str, list[str]]:
    """Collect ``*_RULE_SET`` string constants declared by backend modules.

    Returns:
        Rule set name mapped to the module-relative paths declaring it.
    """
    found: dict[str, set[str]] = {}
    for path, tree in trees.items():
        for name, value in _string_constants(tree).items():
            if name.endswith(RULE_SET_SUFFIX):
                found.setdefault(value, set()).add(path.relative_to(MODULES_DIR).as_posix())
    return {name: sorted(paths) for name, paths in sorted(found.items())}


def _statically_registered(trees: dict[Path, ast.Module]) -> set[str]:
    """Rule set names some module passes to ``rule_registry.register``.

    Only the second positional argument is read, because that is the whole
    signature: ``register(rule, rule_sets)``. Both a literal and a reference to
    a constant declared in the same file are resolved; anything else is left
    out rather than guessed at, so this set is a lower bound.
    """
    registered: set[str] = set()
    for path, tree in trees.items():
        consts = _string_constants(tree)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or len(node.args) < 2:
                continue
            func = node.func
            if not isinstance(func, ast.Attribute) or func.attr != "register":
                continue
            if not isinstance(func.value, ast.Name) or func.value.id != "rule_registry":
                continue
            sets_arg = node.args[1]
            if not isinstance(sets_arg, (ast.List, ast.Tuple)):
                continue
            for element in sets_arg.elts:
                if isinstance(element, ast.Constant) and isinstance(element.value, str):
                    registered.add(element.value)
                elif isinstance(element, ast.Name) and element.id in consts:
                    registered.add(consts[element.id])
        del path
    return registered


def _packages_with_startup_hook(trees: dict[Path, ast.Module]) -> set[str]:
    """Module package names whose ``__init__.py`` defines ``on_startup``."""
    out: set[str] = set()
    for path, tree in trees.items():
        if path.name != "__init__.py":
            continue
        for node in tree.body:
            if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)) and (node.name == "on_startup"):
                out.add(path.parent.name)
    return out


@pytest.fixture(scope="module")
def trees() -> dict[Path, ast.Module]:
    """Parse the module sources once for the whole file."""
    return _parsed_modules()


@pytest.fixture(scope="module", autouse=True)
def _builtin_rules() -> None:
    """Register the built-in rules once for the whole module."""
    register_builtin_rules()


def test_modules_declare_rule_sets(trees: dict[Path, ast.Module]) -> None:
    """The discovery itself must find something.

    Without this, a refactor that renames the constant convention would turn
    every assertion below into a vacuous pass over an empty list.
    """
    declared = _declared_rule_sets(trees)
    assert len(declared) >= 4, (
        "no module rule set constants were discovered, so the reachability "
        f"check below would assert nothing. Found: {declared}"
    )


def test_every_declared_rule_set_has_rules(trees: dict[Path, ast.Module]) -> None:
    """No module may request a rule set that nothing registers into."""
    declared = _declared_rule_sets(trees)
    by_module = _statically_registered(trees)
    hooked = _packages_with_startup_hook(trees)

    dormant: dict[str, str] = {}
    for name, paths in declared.items():
        if rule_registry.has_rules(name):
            continue
        if name not in by_module:
            dormant[name] = f"declared in {', '.join(paths)}, nothing registers into it"
            continue
        owners = {p.split("/")[0] for p in paths}
        if not owners & hooked:
            dormant[name] = f"declared in {', '.join(paths)}, registered but no on_startup hook runs the registration"

    assert not dormant, (
        "these rule sets are requested by a module but resolve to no rules, so "
        "validation runs and finds nothing: " + "; ".join(f"{name} ({why})" for name, why in dormant.items())
    )


@pytest.mark.parametrize(
    "rule_set",
    ["procurement", "subcontract", "submittal", "rfq_issue", "rfq_award", "boq_quality"],
)
def test_known_rule_set_is_reachable(rule_set: str) -> None:
    """Pin the core sets whose reachability has been questioned before.

    These four modules were listed in an audit as having no validation
    coverage. They do. Naming them here means the next person gets the answer
    from a test rather than from another read of the registry, and a rename
    that breaks one says which module lost its validation.
    """
    assert rule_registry.has_rules(rule_set), (
        f"rule set {rule_set!r} resolves to no rules, so every validation "
        "request for it reports a clean pass without running anything"
    )


def test_resolve_reports_an_unknown_set_as_unsupported() -> None:
    """The engine must not silently treat an unknown set as having passed.

    This is the guard that makes the tests above meaningful: they rely on
    ``has_rules`` telling the truth about an empty set.
    """
    supported, unsupported = rule_registry.resolve_rule_sets(["boq_quality", "a_rule_set_nobody_registered"])
    assert supported == ["boq_quality"]
    assert unsupported == ["a_rule_set_nobody_registered"]

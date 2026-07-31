# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Pin which test trees a blocking push lane actually runs.

A test that no lane names does not fail. It reports nothing at all, and an
absent signal is indistinguishable from a green one when you are reading a
list of check marks. Several trees under ``backend/tests`` are in exactly
that position: they are reached only by the bare ``pytest`` in the nightly
full suite, so a break in them is invisible on the commit that caused it.

This does not argue that every tree belongs in the push lane. Some of them
genuinely should not be there, because the push lane has a time budget. What
it argues is that the split should be a decision somebody wrote down, not an
accident of which paths happened to get typed into a workflow file. So the
map below is pinned. Moving a tree between classes is allowed and is
sometimes the right change, but it has to be an edit to this file, which
means it shows up in review instead of drifting.

The workflow files are read as text. Asking GitHub what it ran would be a
better source and is not available from a test, so the honest limit of this
guard is that it checks the configuration and not the runner.
"""

from __future__ import annotations

import re
import shlex
from pathlib import Path

import pytest
import yaml

BACKEND = Path(__file__).resolve().parents[2]
TESTS = BACKEND / "tests"
WORKFLOWS = BACKEND.parent / ".github" / "workflows"

# Trees the release and tag workflows own are out of scope here: this is
# about what gates a commit to main, not about what publishes an artifact.
RELEASE_WORKFLOWS = frozenset(
    {
        "release.yml",
        "release-signing.yml",
        "desktop-release.yml",
        "pypi-publish.yml",
    }
)

ROOT_FILES = "tests (root files)"

PUSH_FULL = "push, full"
PUSH_FILTERED = "push, -k filtered"
PUSH_PATH_FILTERED = "push, only when its own paths change"
ON_DEMAND = "nightly or manual only"
UNNAMED = "no lane names it"

# What each tree is gated by today. Read this as the current contract, not as
# an endorsement of it: PUSH_FILTERED in particular means the tree is named
# but that a -k narrows it to a small slice, which is much closer to
# ON_DEMAND than the workflow file makes it look.
EXPECTED: dict[str, str] = {
    "tests/unit": PUSH_FULL,
    "tests/pg": PUSH_FULL,
    "tests/integration": PUSH_FILTERED,
    "tests/modules": PUSH_FILTERED,
    "tests/eval": PUSH_PATH_FILTERED,
    "tests/benchmarks": ON_DEMAND,
    "tests/perf": ON_DEMAND,
    ROOT_FILES: ON_DEMAND,
}

_PYTEST_CALL = re.compile(r"(?:^|\s|&&|\|\||;)(?:python\s+-m\s+)?pytest\b(?P<args>.*)")


def _test_trees() -> set[str]:
    """Every tree under ``backend/tests`` that holds at least one test file.

    Root-level test modules are reported under a single synthetic name,
    because they are gated as a group and there is no directory to name.
    """
    trees: set[str] = set()
    if any(TESTS.glob("test_*.py")):
        trees.add(ROOT_FILES)
    for child in sorted(TESTS.iterdir()):
        if not child.is_dir() or child.name.startswith((".", "__")):
            continue
        if any(child.rglob("test_*.py")) or any(child.rglob("*_test.py")):
            trees.add(f"tests/{child.name}")
    return trees


class Invocation:
    """One ``pytest`` command found in one workflow step."""

    def __init__(self, workflow: str, job: str, args: list[str], *, blocking: bool) -> None:
        self.workflow = workflow
        self.job = job
        self.blocking = blocking
        self.paths = [a for a in args if a.startswith("tests")]
        self.filtered = "-k" in args

    @property
    def whole_tree(self) -> bool:
        """A pytest with no path argument collects everything under testpaths."""
        return not self.paths


def _split_args(raw: str) -> list[str]:
    """Tokenise a shell argument string, tolerating GitHub expressions."""
    # ${{ matrix.shard }} is not shell syntax and shlex would keep the braces
    # as an opaque token, which is harmless: we only look at paths and -k.
    try:
        return shlex.split(raw, posix=True)
    except ValueError:
        return raw.split()


def _invocations() -> list[Invocation]:
    """Every pytest call in every workflow that a commit to main can trigger."""
    found: list[Invocation] = []
    for path in sorted(WORKFLOWS.glob("*.yml")):
        if path.name in RELEASE_WORKFLOWS:
            continue
        doc = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(doc, dict):
            continue
        for job_name, job in (doc.get("jobs") or {}).items():
            if not isinstance(job, dict):
                continue
            job_blocking = job.get("continue-on-error") is not True
            for step in job.get("steps") or []:
                if not isinstance(step, dict):
                    continue
                run = step.get("run")
                if not isinstance(run, str):
                    continue
                blocking = job_blocking and step.get("continue-on-error") is not True
                for line in run.splitlines():
                    match = _PYTEST_CALL.search(line)
                    if match is None:
                        continue
                    found.append(
                        Invocation(
                            path.name,
                            job_name,
                            _split_args(match.group("args")),
                            blocking=blocking,
                        )
                    )
    return found


def _push_triggered(name: str) -> tuple[bool, bool]:
    """Whether a workflow runs on push to main, and whether paths narrow it."""
    doc = yaml.safe_load((WORKFLOWS / name).read_text(encoding="utf-8"))
    # PyYAML resolves an unquoted `on:` key to the boolean True.
    triggers = doc.get("on", doc.get(True)) or {}
    if isinstance(triggers, str):
        triggers = {triggers: None}
    if isinstance(triggers, list):
        triggers = dict.fromkeys(triggers)
    push = triggers.get("push")
    if push is None and "push" not in triggers:
        return False, False
    narrowed = isinstance(push, dict) and bool(push.get("paths") or push.get("paths-ignore"))
    return True, narrowed


def _classify(tree: str, invocations: list[Invocation]) -> str:
    """Rank a tree by the strongest coverage any blocking push lane gives it."""
    best = UNNAMED
    rank = {UNNAMED: 0, ON_DEMAND: 1, PUSH_PATH_FILTERED: 2, PUSH_FILTERED: 3, PUSH_FULL: 4}
    target = "tests" if tree == ROOT_FILES else tree
    for call in invocations:
        if not call.whole_tree and not any(
            target == p or target.startswith(f"{p}/") or p.startswith(f"{target}/") for p in call.paths
        ):
            continue
        # The root modules sit beside the tree directories, so a lane naming
        # tests/unit does not reach them. Only a bare pytest does.
        if tree == ROOT_FILES and not call.whole_tree:
            continue
        if not call.blocking:
            found = ON_DEMAND
        else:
            on_push, narrowed = _push_triggered(call.workflow)
            if not on_push:
                found = ON_DEMAND
            elif call.filtered:
                found = PUSH_FILTERED
            elif narrowed:
                found = PUSH_PATH_FILTERED
            else:
                found = PUSH_FULL
        if rank[found] > rank[best]:
            best = found
    return best


@pytest.fixture(scope="module")
def invocations() -> list[Invocation]:
    return _invocations()


def test_the_workflows_were_actually_parsed(invocations: list[Invocation]) -> None:
    """A broken parse would make every assertion below vacuously agree."""
    assert len(invocations) >= 5, (
        f"only {len(invocations)} pytest invocations found in {WORKFLOWS}. "
        "The workflow parse is broken, so the coverage map below means nothing."
    )
    assert any(c.whole_tree for c in invocations), "no lane runs the whole tree"
    assert any(c.paths for c in invocations), "no lane names an explicit test path"


def test_every_test_tree_has_a_recorded_gate(invocations: list[Invocation]) -> None:
    """A tree nobody thought about is the failure mode this guard exists for."""
    unrecorded = sorted(_test_trees() - set(EXPECTED))
    assert not unrecorded, (
        "test trees with no recorded CI classification: "
        + ", ".join(unrecorded)
        + ". Add each to EXPECTED with the class it genuinely has. If it is "
        f"{ON_DEMAND!r}, that is allowed, but say so on purpose."
    )


def test_the_expected_map_has_no_dead_entries() -> None:
    """A pin for a tree that no longer exists quietly stops checking anything."""
    stale = sorted(set(EXPECTED) - _test_trees())
    assert not stale, f"EXPECTED names trees that hold no tests: {stale}"


@pytest.mark.parametrize("tree", sorted(EXPECTED))
def test_tree_is_gated_as_recorded(tree: str, invocations: list[Invocation]) -> None:
    """The gate a tree has must be the gate somebody wrote down for it."""
    actual = _classify(tree, invocations)
    assert actual == EXPECTED[tree], (
        f"{tree} is gated as {actual!r}, but this file records {EXPECTED[tree]!r}. "
        "Either the workflow change was not intended, or it was and this line "
        "should change with it. Weakening a gate is a decision, not a detail."
    )

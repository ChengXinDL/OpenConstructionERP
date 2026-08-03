"""Demo seed data must not name real trading companies or design practices.

``scripts/check_no_brand_tokens.py`` is the repo-wide gate for this, and it
deliberately cannot express three kinds of name. Its docstring states the
constraint it is protecting: the gate must never fire on an unrelated word, so
tokens that are also ordinary English are left out and handled by review. On top
of that it has a five character floor, and it hashes one maximal ``[a-z0-9]+``
run at a time, so it has no way to describe a brand that is two ordinary words
side by side.

Real firms reached users through exactly those three holes. A four letter
contractor name is under the floor. A practice whose name is also an English
verb is in the excluded class. A developer named after a London dock is two
common nouns. All three shipped in every wheel up to 14.2.1, in
``app/scripts/seed_demo_4d5d.py`` and ``app/scripts/seed_demo_estimates.py``,
because the demo sweep that cleaned ``core/demo_packs`` never reached the
sibling ``app/scripts`` directory.

This test closes those holes without weakening the repo-wide gate, by narrowing
the surface instead of the pattern. It reads only demo seed sources, so a token
that would be ambiguous across the whole repository is far less ambiguous here.
That is what lets the floor drop to four characters and lets ordinary words and
two-word phrases be named.

**The surface is narrow, not prose-free, and the difference matters when you
add a hash.** Contact and bidder rows are the shape this test was built for, but
``core/demo_packs`` also holds hand-authored BOQ tables carrying position
descriptions, tax notes and scope text, which is prose by any measure. Twenty
six of those thirty one packs are excluded from ``ruff format`` for exactly that
reason, see ``[tool.ruff.format]`` in ``pyproject.toml``. Measured 2026-08-03
across the 74 scanned files: 132 397 tokens inside the length window and 144 427
adjacent word pairs, of which the packs contribute 61 801 pairs. So an ordinary
English word, or two ordinary words that also read as a sentence fragment, has a
real chance of appearing here innocently.

That is a cost to pay knowingly rather than a reason to drop the packs. The one
real firm this test's denylist has caught in shipped data, a contractor in a
sitework tender, was in ``demo_packs/condo-toronto.py``. Dropping the packs
would remove the highest-yield surface to protect against a failure that is
loud, located and one line to fix.

Before adding a hash for anything that is also ordinary English, grep the
lowercased string across the scanned set and confirm it does not already occur
as text. A hash that fires on a BOQ description is a false positive nobody can
diagnose, because the literal is not in the file to compare against.

Brand-safe by the same construction as the gate: only SHA-256 of the lowercased
token or phrase is stored, never the literal string, so this file does not put a
brand name in the repo and does not itself trip the repo-wide gate.

To extend, add a hash::

    python -c "import hashlib;print(hashlib.sha256(b'<lowercased>').hexdigest())"
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[2]
_APP = _BACKEND / "app"

# Real contractors, consultancies, materials producers and design practices that
# have appeared in demo data. Hashes only, one lowercased token each.
_DENY_TOKENS: frozenset[str] = frozenset(
    {
        "4e44ac61bc0519ecccc8ae9c2dae453f13ca786a647087c7a2266a6ec5232c94",
        "09c7945dc8a40843b498d79e60716cf57772480d518db5afbbd2d6ab880826fa",
        "480a07f18d2fdbf6a82e04e94e02c32f3a9488c4f317c24a4c13619b9572b30b",
        "814c02272c6b9021e615b6b50b4fce0b3f5197fd870585c3bb661bc0158ff7d0",
        "5fdde7b0e721c43a4bc5c3a34e960a047a4809b34a900a8a88912deb4bf1902a",
        "6bc6bf03af18e61486d26f7d92439715ba438be7ac7911d387eadbfc53e795d8",
        "2b171c81fb670e258f432925425cbc28ae815992baece4fd6dec6172c648f20e",
        "17c3a324486be8f84436b3835df56de14c8928f73504319e93c018e6fbd0205b",
        "b4d969421ab34a7895fc58810b7f1ffc93520b10c9cc6c403ca607b9f29f8c04",
        "ad05969625c093458a9e1df667770ccf71a19b58159126854bd4bda44f0fdaba",
        "c2b9f8fa621a7daaec397af14d827f0c017f3f83b4a58bc73cd313af40f79ad2",
        "5fda8083a1784f7ebb246f2d52001eaaf75e1ce06437f297e12b5e5843659f81",
        "ebd3ce5ea305e181fa74e0d21e700c5ad851651396637f621160e149b1d61cc3",
        "20613c35da218fd86e0f18d6b736cbc2b2b037ed4acfd37e1517cd0983118b85",
        "0ec1e6a8c587e38297c7a7fcf2face9abacf9a9bbd28b57f68d046bfbd5b95cf",
        "20920c3de23ff769ee1c1113c409113c10f7c9d752b55660c3e6b8137589e66a",
        "fda1bdcc3e8d94633b84d1ec2277cb3400d298a431259af0d46479732d98c15d",
        "8ee321501d985290acf5cc0e140ec72a524877e15a6a561c3be997a0ea1a407a",
        "f38f6d7164bf334b3282eda983dcb8d5b69e2e14ffa7b4a83532d61aa7ee03be",
        "52fdaf64a84889c55cc04e5337c0afaabe225a9643385b411fdf2082dfac3208",
        "463d049002ce9578dab985b8969b96b7698948206d8ada916bf2676863316dab",
        "e3c7e82d53a1ce84c284f43915a66bf147c75b2a8baf3f2d476bd2ecd754590c",
        "65266ec0e12375d08a468a83da9d63a57eaaa9a24c3e5cd055ad706598310752",
        # The two halves of one coined-looking pair. Neither was on any list
        # while it shipped, because the pair was searched as a phrase and a
        # coined pair is unique by construction, so the query came back empty.
        # Searched apart, each half is a live contractor. Removing them from the
        # data is not the same as remembering them, which is what these are for.
        "467813f7cf203871621e08b72ee4c210215b1f6a4af0e27da53a3cb490fe8bdf",
        "e186dc4cc7fad46dc412de303e24ee681bfe746267c6488d4af0267122f9f6d7",
        # Two ordinary words that are also busy construction brands: a bird
        # several UK builders are named after, and a green-industry compound a
        # live landscaping firm trades under. Both stay here rather than in the
        # repo-wide gate, which promises never to fire on an ordinary word.
        # Checked before hashing, per the note above: neither occurs as text
        # anywhere in the repository. One near miss, a coined name that starts
        # with the bird, is safe only because the rule hashes maximal runs and
        # so reads it as a single longer token.
        "07f15cde5b181425db8524becd96263d600c9652c7de5b89fe1a644f8fd0724b",
        "620380dbf70857c10410a5aa1a6ac0c343ad530e43080b2a1a83f96d0241b458",
    }
)

# Brands that are two ordinary words in sequence. No single-token rule can
# describe these, which is why the repo-wide gate is blind to them. The last
# two are regional nicknames a city's contractors name themselves after, so
# several live firms answer to each. They read as invented until searched, and
# they were waved through on exactly that impression once already.
_DENY_PHRASES: frozenset[str] = frozenset(
    {
        "d1f9da0816d42c1c8a7d06f4985fef19ef93f9e79fe864157c80537aca5099c3",
        "0085aae38d1d88ead679bc7fedd28c1c2d3f9eccde2c7977579773aef6fe2756",
        "08f91c27a450f7e3eb316c94c85622de10b70e96f2fd10ae1cc7443997b275a2",
    }
)

# One collision found in this sweep is deliberately absent from both sets. A
# four letter English noun that is also a surname turned up as a one-man
# groundworks contractor and as a registered company, so the demo name carrying
# it was rewritten. The token itself stays off the list: it is ordinary HVAC
# vocabulary, it would fire on a fan or damper description in the pack BOQ
# tables, and a hash that fires on prose is the false positive the docstring
# above warns about. Rewriting the datum is the whole remedy here.

# Four, not five: the shortest name that reached users was four characters, and
# the repo-wide gate's floor is the reason nothing saw it.
_MIN_LEN = 4
_MAX_LEN = 16
_TOKEN_RE = re.compile(r"[a-z0-9]+")
_WORD_RE = re.compile(r"[a-z]+")


def _seed_sources() -> list[Path]:
    """Every source that writes demo records a user can read on screen.

    The set is deliberately read off the disk rather than off ``git ls-files``,
    so it differs between a developer machine and a clean checkout. Two seeders
    matching ``seed_demo*.py`` are ignored by ``.gitignore`` and exist only
    locally: 74 files here, 72 in CI, measured 2026-08-03. That asymmetry is the
    point. Those two files reach neither pre-commit nor CI by any other route,
    and a name that lands in them is a name a developer can still put on screen
    when seeding a demo estate by hand.
    """
    found = sorted(
        {
            *(_APP / "scripts").glob("seed_demo*.py"),
            *(_APP / "scripts").glob("seed_flagship*.py"),
            *(_APP / "core" / "demo_packs").glob("*.py"),
            *(_APP / "core").glob("demo_projects.py"),
            *_APP.glob("modules/*/seed.py"),
        }
    )
    assert found, f"no demo seed sources under {_APP} - the globs have gone stale"
    return found


def _masked(text: str) -> str:
    """First and last character plus length, so a failure locates without reprinting."""
    return f"{text[0]}{'*' * (len(text) - 2)}{text[-1]} (len {len(text)})"


def test_the_seed_source_globs_still_reach_the_files_that_leaked() -> None:
    """A rename or a move would make every other assertion here vacuous."""
    names = {p.name for p in _seed_sources()}
    for expected in ("seed_demo_4d5d.py", "seed_demo_estimates.py", "demo_projects.py"):
        assert expected in names, f"{expected} is no longer in the scanned set"
    # Deliberately far below both real counts, because the count is machine
    # dependent by design, see _seed_sources. This guards against a glob that
    # stops matching, not against the two file difference between CI and a
    # developer checkout.
    assert len(_seed_sources()) > 40, "the scanned set shrank unexpectedly"


def test_no_demo_seed_source_names_a_real_firm() -> None:
    hits: list[str] = []
    for path in _seed_sources():
        rel = path.relative_to(_BACKEND).as_posix()
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            lowered = line.lower()
            for token in _TOKEN_RE.findall(lowered):
                if _MIN_LEN <= len(token) <= _MAX_LEN:
                    if hashlib.sha256(token.encode()).hexdigest() in _DENY_TOKENS:
                        hits.append(f"{rel}:{number}: firm token {_masked(token)}")
            # Two ordinary words in sequence, which no token rule can express.
            words = _WORD_RE.findall(lowered)
            for first, second in zip(words, words[1:], strict=False):
                phrase = f"{first} {second}"
                if hashlib.sha256(phrase.encode()).hexdigest() in _DENY_PHRASES:
                    hits.append(f"{rel}:{number}: firm phrase {_masked(phrase)}")

    assert not hits, "demo data names real companies:\n" + "\n".join(hits)

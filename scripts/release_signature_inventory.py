#!/usr/bin/env python3
"""Report which published releases carry which signature, for all four mechanisms.

"Signed" is not one property of a release. This project has four independent
mechanisms, they are produced by different jobs, they protect different things,
and a release can carry any subset of them:

    1. git tag object signature   the tag itself, GPG or SSH, verifiable with
                                  `git tag -v`. Says who cut the tag.
    2. Sigstore / cosign          a detached signature over a SHA256SUMS
                                  manifest of the published assets, produced by
                                  release-signing.yml. Says these are the bytes
                                  we shipped.
    3. macOS Developer ID         codesign with a Developer ID certificate plus
       and notarisation           Apple notarisation and a stapled ticket. What
                                  Gatekeeper accepts without a warning.
    4. Windows Authenticode       a certificate on the .exe and .msi. What
                                  SmartScreen reads.

The reason this script exists rather than a table in a document: the table went
stale the moment it was written, and a stale inventory of guarantees is worse
than none, because it is quoted. The document states the rule and carries the
command; this produces the numbers on demand.

What is measured and what is not, stated plainly because the difference is the
whole point:

    Mechanism 1 is measured, locally, from the tag objects in this clone. It
    cannot be measured from the GitHub API at all: the releases endpoint says
    nothing about tag objects, so a run that only talked to the API would
    report "nothing missing" for the mechanism where everything is missing.

    Mechanism 2 is measured from the published asset list. The three assets
    either exist on the release or they do not.

    Mechanisms 3 and 4 are NOT derivable from an asset list. A .dmg is a .dmg
    whether or not it is notarised, and nothing in its name or size says. So
    they are answered from the credentials: no Developer ID certificate and no
    notarisation credentials means no build could have been notarised, and no
    AZURE_KV_* secrets means no installer could have been Authenticode signed.
    That is an argument from the cause rather than an observation of the
    effect, and it is labelled as such everywhere it appears. To observe the
    effect you must download an artifact and run `codesign -dv --verbose=4` or
    `signtool verify /pa` against it.

Usage::

    python scripts/release_signature_inventory.py            # summary
    python scripts/release_signature_inventory.py --all      # every release
    python scripts/release_signature_inventory.py --json     # machine readable

Needs the `gh` CLI, authenticated. Run from anywhere inside a clone.

Exit codes:
    0  the inventory was produced
    1  the inventory could not be trusted (short fetch, gh missing, and under
       --strict, any mechanism that could not be measured)
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
REPO = "datadrivenconstruction/OpenConstructionERP"

# A short page reads exactly like a healthy inventory: every row present is
# correct, and the missing rows are invisible. Auth expiry and rate limiting
# both produce it. So the fetch is asserted against a floor rather than
# trusted, and the floor is dated so a reader can tell a stale constant from a
# real shortfall.
MIN_RELEASES = 240  # measured 243 on 2026-08-12
MIN_TAGS = 320  # measured 325 on 2026-08-12

# release-signing.yml uploads exactly these three, and all three are needed:
# the manifest, the signature over it, and the certificate to check it with.
COSIGN_TRIO = ("SHA256SUMS", "SHA256SUMS.sig", "SHA256SUMS.pem")

WINDOWS_SUFFIXES = (".exe", ".msi")
MACOS_SUFFIXES = (".dmg", ".app.tar.gz")
DESKTOP_SUFFIXES = (*WINDOWS_SUFFIXES, *MACOS_SUFFIXES, ".AppImage", ".deb", ".rpm")

WINDOWS_SECRETS = (
    "AZURE_KV_URL",
    "AZURE_KV_CERT_NAME",
    "AZURE_KV_CLIENT_ID",
    "AZURE_KV_CLIENT_SECRET",
    "AZURE_KV_TENANT_ID",
)

# A credential is "wired" when the step that runs the signing TOOL receives it,
# not when its name appears somewhere in the file. The distinction is not
# academic: the macOS status step added to desktop-release.yml names all four
# APPLE_* secrets in order to report that they are absent, and a detector that
# grepped for the names read that as "notarisation is configured" - the exact
# false claim the status step exists to prevent. So each mechanism is tied to
# the step that consumes it, identified by the action it uses or the command it
# runs, and only that step's env is inspected.
#
# (uses-prefix, invoked command, alternative credential sets the tool accepts)
#
# The command is matched as an INVOCATION, not as a mention. Matching the text
# "azuresigntool" anywhere in a step picked out the preflight step, whose
# comment explains what azuresigntool would do with empty secrets, and reported
# the preflight as the signing tool. That reads as "Windows signing is wired"
# because the preflight is, of course, handed all five names.
#
# Notarisation takes either an app specific password or an App Store Connect
# API key, so alternatives are a list. Only one set has to be complete.
CONSUMERS = {
    "macOS Developer ID signing": (
        "tauri-apps/tauri-action",
        None,
        (("APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD", "APPLE_SIGNING_IDENTITY"),),
    ),
    "macOS notarisation": (
        "tauri-apps/tauri-action",
        None,
        (
            ("APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"),
            ("APPLE_API_ISSUER", "APPLE_API_KEY", "APPLE_API_KEY_PATH"),
        ),
    ),
    "Windows Authenticode": (None, "azuresigntool", (WINDOWS_SECRETS,)),
}


@dataclass
class Release:
    """One published GitHub release and what can be observed about it."""

    tag: str
    published_at: str
    draft: bool
    prerelease: bool
    assets: list[str] = field(default_factory=list)

    @property
    def has_cosign(self) -> bool:
        return all(name in self.assets for name in COSIGN_TRIO)

    @property
    def partial_cosign(self) -> bool:
        present = [name for name in COSIGN_TRIO if name in self.assets]
        return 0 < len(present) < len(COSIGN_TRIO)

    def _any(self, suffixes: tuple[str, ...]) -> bool:
        return any(a.endswith(suffixes) for a in self.assets)

    @property
    def has_desktop(self) -> bool:
        return self._any(DESKTOP_SUFFIXES)

    @property
    def has_windows(self) -> bool:
        return self._any(WINDOWS_SUFFIXES)

    @property
    def has_macos(self) -> bool:
        return self._any(MACOS_SUFFIXES)


def die(message: str) -> None:
    """Fail loudly. Every caller of this is a case where a partial answer would read as a whole one."""
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def run(args: list[str], *, cwd: Path | None = None) -> str:
    result = subprocess.run(args, capture_output=True, text=True, cwd=cwd, check=False)
    if result.returncode != 0:
        die(f"{' '.join(args[:2])} failed with exit {result.returncode}: {result.stderr.strip()[:400]}")
    return result.stdout


def fetch_releases() -> list[Release]:
    """Every release, with its asset names, from the GitHub API."""
    if shutil.which("gh") is None:
        die("the gh CLI is not on PATH, and the release list cannot be read without it")

    raw = run(
        [
            "gh",
            "api",
            f"repos/{REPO}/releases?per_page=100",
            "--paginate",
            "--jq",
            ".[] | {tag: .tag_name, published_at: .published_at, draft: .draft, "
            "prerelease: .prerelease, assets: [.assets[].name]}",
        ]
    )
    releases = [
        Release(
            tag=d["tag"],
            published_at=(d["published_at"] or "")[:10],
            draft=d["draft"],
            prerelease=d["prerelease"],
            assets=d["assets"],
        )
        for line in raw.splitlines()
        if line.strip()
        for d in [json.loads(line)]
    ]

    if len(releases) < MIN_RELEASES:
        die(
            f"only {len(releases)} releases came back and at least {MIN_RELEASES} were expected. "
            "A short page looks exactly like a healthy inventory, so this refuses to report one. "
            "Check `gh auth status` and the API rate limit, then run it again."
        )
    return releases


def fetch_secret_names() -> list[str] | None:
    """The NAMES of the configured Actions secrets, never their values.

    Returns None when the listing could not be read, which is not the same
    answer as an empty list and must never be reported as one: a token without
    the admin scope gets 403, and a 403 rendered as "no secrets are configured"
    would be a confident claim produced by a permission error.
    """
    result = subprocess.run(
        ["gh", "api", f"repos/{REPO}/actions/secrets", "--jq", ".secrets[].name"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return None
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def fetch_tag_signatures() -> dict[str, str] | None:
    """Map tag name to its signature state, read from the tag objects in this clone.

    Returns None when there is no usable clone, which the caller must report as
    unmeasured rather than as clean.
    """
    if shutil.which("git") is None or not (REPO_ROOT / ".git").exists():
        return None

    # contents:signature is empty for an unsigned annotated tag and does not
    # exist at all for a lightweight one, which cannot carry a signature by
    # construction. Both are reported, because "91 tags could never have been
    # signed" is a different fact from "234 were not signed".
    out = run(
        ["git", "for-each-ref", "--format=%(refname:short)%09%(objecttype)%09%(contents:signature)", "refs/tags"],
        cwd=REPO_ROOT,
    )
    states: dict[str, str] = {}
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) < 2 or not parts[0]:
            continue
        name, objecttype = parts[0], parts[1]
        signature = parts[2] if len(parts) > 2 else ""
        if "BEGIN PGP SIGNATURE" in signature or "BEGIN SSH SIGNATURE" in signature:
            states[name] = "signed"
        elif objecttype == "tag":
            states[name] = "annotated, unsigned"
        else:
            states[name] = "lightweight, cannot be signed"
    return states or None


def invokes(script: str, command: str) -> bool:
    """True when a shell block actually CALLS command, rather than mentioning it.

    A command is invoked when it opens a line. Prose about the tool lives in
    comments, and a comment never starts with the bare command name.
    """
    for raw in script.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        head = line.split()[0]
        if head == command:
            return True
    return False


def find_consumer(
    uses_prefix: str | None, command: str | None, alternatives: tuple[tuple[str, ...], ...]
) -> dict[str, object]:
    """Locate the step that runs a signing tool and report which credentials reach it.

    Answers three situations that a name grep collapses into one: no such step
    exists, the step exists but is handed none of the credentials, or the step
    exists and receives a complete set.
    """
    try:
        import yaml  # noqa: PLC0415
    except ImportError:
        return {"parsed": False}

    for path in sorted((REPO_ROOT / ".github" / "workflows").glob("*.yml")):
        try:
            doc = yaml.safe_load(path.read_text(encoding="utf-8", errors="replace"))
        except yaml.YAMLError:
            continue
        for job_name, job in (doc or {}).get("jobs", {}).items():
            for step in job.get("steps") or []:
                uses = str(step.get("uses") or "")
                matched = (uses_prefix and uses.startswith(uses_prefix)) or (
                    command and invokes(str(step.get("run") or ""), command)
                )
                if not matched:
                    continue
                env_keys = set((step.get("env") or {}).keys())
                scored = [
                    {
                        "set": alt,
                        "receives": [n for n in alt if n in env_keys],
                        "missing": [n for n in alt if n not in env_keys],
                    }
                    for alt in alternatives
                ]
                best = max(scored, key=lambda s: len(s["receives"]))
                return {
                    "parsed": True,
                    "file": path.name,
                    "job": job_name,
                    "step": step.get("name", "<unnamed>"),
                    "alternatives": scored,
                    "receives": best["receives"],
                    "missing": best["missing"],
                    "complete": any(not s["missing"] for s in scored),
                }
    return {"parsed": True}


def mentioned_anywhere(names: tuple[str, ...]) -> dict[str, list[str]]:
    """Which files merely name each credential. Kept separate from find_consumer on purpose."""
    found: dict[str, list[str]] = {n: [] for n in names}
    for path in sorted((REPO_ROOT / ".github" / "workflows").glob("*.yml")):
        text = path.read_text(encoding="utf-8", errors="replace")
        for name in names:
            if f"secrets.{name}" in text:
                found[name].append(path.name)
    return found


def eras(releases: list[Release]) -> list[tuple[bool, list[Release]]]:
    """Split releases, newest first, into contiguous runs that agree about cosign.

    A single "carried from X onward" boundary was the wrong shape and said so
    out loud: it produced a 190 tag exception list. Signing here has two
    separate working periods with a long dead stretch between them, and runs
    describe that in three lines where a boundary could not describe it at all.
    """
    # Sort on the date only. Python's sort is stable, so releases sharing a date
    # keep the API's newest-first order; adding the tag as a tiebreak would sort
    # them as strings and put v2.9.9 after v2.9.42.
    ordered = sorted(releases, key=lambda r: r.published_at, reverse=True)
    out: list[tuple[bool, list[Release]]] = []
    for r in ordered:
        if out and out[-1][0] == r.has_cosign:
            out[-1][1].append(r)
        else:
            out.append((r.has_cosign, [r]))
    return out


def bar(count: int, total: int, width: int = 28) -> str:
    filled = 0 if total == 0 else round(width * count / total)
    return "#" * filled + "." * (width - filled)


def report(releases: list[Release], tag_states: dict[str, str] | None, show_all: bool, strict: bool) -> int:
    unmeasured: list[str] = []
    desktop = [r for r in releases if r.has_desktop]
    print("=" * 100)
    print(f"RELEASE SIGNATURE INVENTORY  {REPO}")
    print(f"{len(releases)} published releases, {len(desktop)} of them carrying desktop installers")
    print("=" * 100)

    # ---------------------------------------------------------------- 1
    print("\n[1] GIT TAG OBJECT SIGNATURE      measured locally, from the tag objects in this clone")
    if tag_states is None:
        unmeasured.append("git tag signatures")
        print("    NOT MEASURED. No usable clone was found, and this mechanism is invisible to the")
        print("    GitHub API, so nothing here should be read as 'none missing'.")
    else:
        signed = sorted(n for n, s in tag_states.items() if s == "signed")
        annotated = [n for n, s in tag_states.items() if s == "annotated, unsigned"]
        lightweight = [n for n, s in tag_states.items() if s.startswith("lightweight")]
        if len(tag_states) < MIN_TAGS:
            print(f"    WARNING: only {len(tag_states)} tags are present locally, expected at least {MIN_TAGS}.")
            print("    Run `git fetch --tags` first, or these counts are of a partial clone.")
        print(f"    signed                      {len(signed):>4}  {bar(len(signed), len(tag_states))}")
        print(f"    annotated, unsigned         {len(annotated):>4}  {bar(len(annotated), len(tag_states))}")
        print(f"    lightweight, cannot sign    {len(lightweight):>4}  {bar(len(lightweight), len(tag_states))}")
        print(f"    RULE: {'no tag in this repository is signed' if not signed else 'signed: ' + ', '.join(signed)}")

    # ---------------------------------------------------------------- 2
    print("\n[2] SIGSTORE / COSIGN             measured from the published asset list")
    full = [r for r in releases if r.has_cosign]
    partial = [r for r in releases if r.partial_cosign]
    print(f"    all three assets            {len(full):>4}  {bar(len(full), len(releases))}")
    print(
        f"    none of the three           {len(releases) - len(full) - len(partial):>4}"
        f"  {bar(len(releases) - len(full) - len(partial), len(releases))}"
    )
    if partial:
        print(f"    PARTIAL, investigate        {len(partial):>4}  {', '.join(r.tag for r in partial)}")
    if full:
        runs = eras(releases)
        current_has, current = runs[0]
        newest, oldest = current[0], current[-1]
        span = newest.tag if len(current) == 1 else f"{oldest.tag} through {newest.tag}"
        state = "carry it" if current_has else "lack it"
        print(f"    RULE: the {len(current)} most recent releases ({span}) {state},")
        print(f"          from {oldest.published_at}.")
        earlier = [r for group in runs[1:] for r in group[1]]
        earlier_full = [r for r in earlier if r.has_cosign]
        print(f"          Before that: {len(earlier)} releases, {len(earlier_full)} of them attested, in")
        print(f"          {len(runs) - 1} alternating stretches. It is patchy rather than absent, so an")
        print("          older release having no signature is not evidence that anything went wrong.")
        if not show_all:
            print("          Run with --all to see every stretch.")
        else:
            for has, group in runs:
                newest, oldest = group[0], group[-1]
                span = newest.tag if len(group) == 1 else f"{oldest.tag} through {newest.tag}"
                plural = "release" if len(group) == 1 else "releases"
                dates = oldest.published_at if len(group) == 1 else f"{oldest.published_at} to {newest.published_at}"
                mark = "SIGNED  " if has else "unsigned"
                print(f"      {mark} {len(group):>3} {plural:<9} {span:<30} {dates}")
    desktop_full = [r for r in full if r.has_desktop]
    print(f"    of the {len(full)} attested releases, {len(desktop_full)} carry desktop installers")

    # ---------------------------------------------------------------- 3 and 4
    print("\n[3] and [4]  MACOS SIGNING AND NOTARISATION, WINDOWS AUTHENTICODE")
    print("    NOT observable from an asset list: a .dmg is a .dmg whether or not it is notarised.")
    print("    Answered from whether the pipeline hands the credentials to the tool that would use")
    print("    them, which is an argument from the cause. To observe the effect on a given release,")
    print("    download the artifact and run `codesign -dv --verbose=4` or `signtool verify /pa`.")
    mac_releases = [r for r in desktop if r.has_macos]
    win_releases = [r for r in desktop if r.has_windows]
    print(f"    releases carrying macOS artifacts {len(mac_releases):>4}   Windows artifacts {len(win_releases):>4}")

    secret_names = fetch_secret_names()
    if secret_names is None:
        unmeasured.append("which secrets are configured")
        print("\n    CONFIGURED SECRETS: not readable with this token. Read nothing into that;")
        print("    it is a permission answer, not a count of zero.")
    else:
        listed = ", ".join(sorted(secret_names)) or "none at all"
        print(f"\n    CONFIGURED SECRETS ({len(secret_names)}): {listed}")
        print("    Names only. This is what turns the verdicts below from an inference into a")
        print("    measurement: a credential that is not in this list held no value at any point")
        print("    a release was cut.")

    for label, (uses_prefix, command, alternatives) in CONSUMERS.items():
        found = find_consumer(uses_prefix, command, alternatives)
        print(f"\n    {label}")
        if not found.get("parsed"):
            print("      NOT MEASURED: PyYAML is not installed, so the workflows could not be parsed.")
            unmeasured.append(f"{label} wiring")
            continue
        if "file" not in found:
            print(f"      no step in any workflow runs {uses_prefix or command}, so nothing produces this.")
            continue
        print(f"      consumer: {found['file']} / {found['job']} / {found['step']}")
        for alt in found["alternatives"]:
            got = ", ".join(alt["receives"]) or "nothing"
            gap = ", ".join(alt["missing"]) or "-"
            print(f"      credentials {' + '.join(alt['set'])}")
            print(f"        receives {got}; missing {gap}")
        if found["complete"] and secret_names is not None:
            absent = [n for n in found["receives"] if n not in secret_names]
            if absent:
                print(f"      RULE: wired, but {len(absent)} of its credentials are not configured secrets")
                print(f"      ({', '.join(absent)}), so no release has ever carried this. The pipeline is")
                print("      ready and the certificate is the missing piece.")
            else:
                print("      RULE: wired and configured. Confirm on an artifact before claiming it: this")
                print("      says the inputs exist, not that a signature came out.")
        elif found["complete"]:
            print("      RULE: wired. Whether a given release carries it depends on whether those")
            print("      secrets held values at the time, which could not be read here.")
        elif not found["receives"]:
            print("      RULE: the tool runs on every build and is handed none of the credentials, so")
            print("      no release can carry this. That is a wiring gap, not a configuration gap:")
            print("      populating the secrets alone would change nothing.")
        else:
            print("      RULE: partially wired. Treat as not producing this until a full set is passed in.")
        every = tuple(dict.fromkeys(n for alt in alternatives for n in alt))
        mentions = {n: f for n, f in mentioned_anywhere(every).items() if f and n not in found["receives"]}
        if mentions:
            named = ", ".join(f"{n} in {', '.join(f)}" for n, f in mentions.items())
            print(f"      named elsewhere without reaching the tool: {named}")
    unmeasured.append("macOS and Windows signatures on the individual published artifacts")

    # ---------------------------------------------------------------- detail
    if show_all:
        print("\n" + "=" * 100)
        print("PER RELEASE. tag / date / cosign / desktop / windows / macos")
        print("=" * 100)
        for r in releases:
            tagsig = (tag_states or {}).get(r.tag, "?")
            flags = [
                "cosign" if r.has_cosign else ("PARTIAL" if r.partial_cosign else "-"),
                "desktop" if r.has_desktop else "-",
                "win" if r.has_windows else "-",
                "mac" if r.has_macos else "-",
            ]
            print(f"  {r.tag:<14} {r.published_at:<12} {'  '.join(f'{f:<8}' for f in flags)} tag: {tagsig}")

    print("\n" + "-" * 100)
    print("Regenerate this with:  python scripts/release_signature_inventory.py")
    print("Do not copy the numbers above into a document. Copy the command.")
    if unmeasured:
        print(f"Not measured here: {'; '.join(unmeasured)}.")
    print("-" * 100)

    if strict and tag_states is None:
        die("--strict was given and at least one mechanism could not be measured")
    return 0


def emit_json(releases: list[Release], tag_states: dict[str, str] | None) -> int:
    payload = {
        "repo": REPO,
        "releases": len(releases),
        "tag_signatures_measured": tag_states is not None,
        "wiring": {label: find_consumer(*spec) for label, spec in ((k, v) for k, v in CONSUMERS.items())},
        "detail": [
            {
                "tag": r.tag,
                "published_at": r.published_at,
                "cosign": r.has_cosign,
                "cosign_partial": r.partial_cosign,
                "desktop": r.has_desktop,
                "windows": r.has_windows,
                "macos": r.has_macos,
                "tag_signature": (tag_states or {}).get(r.tag),
            }
            for r in releases
        ],
    }
    print(json.dumps(payload, indent=2))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--all", action="store_true", help="print every release, not just the summary")
    parser.add_argument("--json", action="store_true", help="machine readable output")
    parser.add_argument("--strict", action="store_true", help="fail if any mechanism could not be measured")
    args = parser.parse_args()

    releases = fetch_releases()
    tag_states = fetch_tag_signatures()
    if args.json:
        return emit_json(releases, tag_states)
    return report(releases, tag_states, show_all=args.all, strict=args.strict)


if __name__ == "__main__":
    raise SystemExit(main())

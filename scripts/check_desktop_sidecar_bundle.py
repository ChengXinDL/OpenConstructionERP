#!/usr/bin/env python3
"""Check that a built desktop sidecar carries a usable embedded PostgreSQL.

The sidecar is a PyInstaller onefile executable: everything it needs is packed
into an archive appended to the binary and extracted to a temporary directory at
launch. If a file did not make it into that archive, nothing says so until a user
runs the installer on their own machine and the app stops at "Starting the local
database".

That is what happened in issue #419. The hook that collects the embedded
PostgreSQL tree used PyInstaller's ``collect_data_files``, which excludes every
suffix in ``importlib.machinery.all_suffixes()``. On Linux and macOS that list
contains ``.so``, the exact suffix PostgreSQL gives its own loadable modules, so
dict_snowball, plpgsql and the encoding converters were dropped from the bundle.
On Windows those same modules are named ``.dll`` and came through, so the
Windows installer worked and the break looked like a Linux-only mystery.

The hook now walks the tree itself and refuses to build without those modules.
This script is the second half: it reads the archive of the executable that was
actually produced and confirms the files are in it. A guard on the input and a
guard on the output catch different things - the hook cannot see a file that a
later build stage strips, and this cannot see a file the hook never offered.

Usage:
    python scripts/check_desktop_sidecar_bundle.py desktop/dist/openconstructionerp-server
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Every entry is a PostgreSQL loadable module the embedded cluster needs before
# it can serve a single query. initdb loads dict_snowball while running
# snowball_create.sql and creates the plpgsql extension during bootstrap; the
# server loads pgoutput and libpqwalreceiver on any replication path. Names are
# suffix-free because the same module is dict_snowball.so on Linux and macOS and
# dict_snowball.dll on Windows.
REQUIRED_PG_MODULES = ("dict_snowball", "plpgsql")

# The executables the sidecar spawns. Present on every platform, and their
# absence means the pginstall tree was collected into the wrong place rather
# than not at all, which is a different failure with the same symptom.
REQUIRED_PG_BINARIES = ("initdb", "postgres", "pg_ctl")


def _archive_names(executable: Path) -> set[str]:
    """Every entry name inside the onefile archive appended to `executable`."""
    from PyInstaller.archive.readers import CArchiveReader

    return set(CArchiveReader(str(executable)).toc)


def _basename_stems(names: set[str]) -> set[str]:
    """Map every archive entry to its suffix-free basename."""
    stems = set()
    for name in names:
        base = name.replace("\\", "/").rsplit("/", 1)[-1]
        stems.add(base.split(".")[0])
    return stems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("executable", type=Path, help="the built onefile sidecar")
    args = parser.parse_args()

    if not args.executable.is_file():
        print(f"sidecar bundle check FAILED: {args.executable} is not a file")
        return 1

    names = _archive_names(args.executable)
    if not names:
        print(f"sidecar bundle check FAILED: {args.executable} has an empty archive")
        return 1

    stems = _basename_stems(names)
    missing_modules = [m for m in REQUIRED_PG_MODULES if m not in stems]
    missing_binaries = [b for b in REQUIRED_PG_BINARIES if b not in stems]

    if missing_modules or missing_binaries:
        print(f"sidecar bundle check FAILED: {args.executable}")
        if missing_modules:
            print(f"  PostgreSQL modules absent: {', '.join(missing_modules)}")
            print("  The embedded cluster cannot run initdb without them (issue #419).")
        if missing_binaries:
            print(f"  PostgreSQL executables absent: {', '.join(missing_binaries)}")
        print(f"  {len(names)} entries were found in the archive.")
        return 1

    # Report where the modules landed, so a layout change is visible in the log
    # even when the check passes. PostgreSQL resolves $libdir relative to its own
    # executable, so the modules being present is necessary but not sufficient:
    # they also have to sit under lib/ next to bin/.
    snowball = sorted(n for n in names if "dict_snowball" in n)
    print(f"sidecar bundle OK: {args.executable}")
    print(f"  {len(names)} archive entries")
    print(f"  dict_snowball at {snowball[0] if snowball else '?'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

# PyInstaller hook for pixeltable-pgserver.
#
# The desktop sidecar runs the whole app on an embedded PostgreSQL 16 cluster
# booted from this package's bundled binaries. The binaries live in a
# ``pginstall/`` directory next to the Python module: ``bin/`` holds postgres,
# initdb, pg_ctl and friends, ``lib/postgresql/`` is PostgreSQL's own module
# directory (the one it calls ``$libdir``), and ``share/`` holds the bootstrap
# SQL and timezone data. PyInstaller does not see any of it, because it is
# plain data next to the package rather than imported modules, so without this
# hook the frozen sidecar starts, tries to spawn postgres, and dies with
# "postgres executable not found".
#
# We walk the pginstall tree ourselves rather than handing it to
# ``collect_data_files``. That helper is documented to return "all files that
# are not shared libraries / binary python extensions", and it decides what a
# shared library is purely from the file suffix: it excludes every suffix in
# ``importlib.machinery.all_suffixes()``. On Linux that list contains ``.so``,
# and that is exactly how PostgreSQL names its own loadable modules there, so
# the helper silently dropped every one of them - dict_snowball.so, plpgsql.so,
# vector.so, the encoding conversion modules. Windows and macOS name the same
# modules ``.dll`` and ``.dylib``, neither of which is a Python extension
# suffix, so both of those builds came through intact. Checked against the real
# wheels: 33 of 1659 pginstall files are dropped from the manylinux one and 0 of
# 1655 from the macOS one. That asymmetry is issue #419: on Ubuntu based
# distributions the desktop app failed at "Starting the local database" because
# initdb runs snowball_create.sql during bootstrap and could not load
# $libdir/dict_snowball. The versioned support libraries (libpq.so.5) were never
# affected either, because a name ending in ".so.5" does not match the ".so"
# suffix, which is why the cluster got as far as running initdb.
#
# The guard at the bottom fails the build rather than shipping an installer
# whose database cannot initialise. A missing module here does not surface until
# a user runs the app on their own machine, which is the worst place to find it.

import os
import sys

from PyInstaller.utils.hooks import collect_data_files, get_package_paths

_PACKAGE = "pixeltable_pgserver"

# pkg_base is the directory the package sits in, so a dest computed relative to
# it reproduces the "pixeltable_pgserver/pginstall/..." layout that pg_ctl and
# PostgreSQL's own path resolution expect. PostgreSQL derives $libdir from the
# location of its executable, so bin/ and lib/ have to keep their relative
# positions inside the extracted bundle.
_pkg_base, _pkg_dir = get_package_paths(_PACKAGE)
_pginstall = os.path.join(_pkg_dir, "pginstall")

# Anything outside pginstall/ is ordinary package data and the helper handles it
# correctly; only the PostgreSQL tree needs the manual walk.
datas = [
    (src, dest)
    for src, dest in collect_data_files(_PACKAGE, include_py_files=False)
    if not os.path.abspath(src).startswith(_pginstall + os.sep)
]
binaries = []


def _is_shared_object(name):
    """True for a loadable library under any of the three platform conventions."""
    return name.endswith((".so", ".dylib")) or ".so." in name or ".dylib." in name


_bin_prefix = os.path.join(_pginstall, "bin") + os.sep
_collected_names = set()

for dirpath, dirnames, filenames in os.walk(_pginstall):
    dirnames[:] = [d for d in dirnames if d != "__pycache__"]
    for name in sorted(filenames):
        src = os.path.join(dirpath, name)
        dest = os.path.relpath(dirpath, _pkg_base)
        _collected_names.add(name)
        if sys.platform == "win32":
            # Windows ignores the executable bit, so plain data collection
            # preserves the tree without dragging the PG executables through PE
            # import analysis, which can duplicate or misplace their DLLs.
            datas.append((src, dest))
            continue
        # On Linux and macOS the extracted postgres / initdb / pg_ctl must be
        # runnable and the loadable modules must keep their permissions.
        # PyInstaller sets the executable bit only on entries it collects as
        # binaries, so those go through that list and the rest stays data.
        is_executable = src.startswith(_bin_prefix) or _is_shared_object(name)
        (binaries if is_executable else datas).append((src, dest))

# initdb loads dict_snowball while running snowball_create.sql, and the
# bootstrap creates the plpgsql extension, so a bundle without these two cannot
# produce a working cluster no matter what else made it in.
_REQUIRED_MODULES = ("dict_snowball", "plpgsql")
_missing = [
    stem
    for stem in _REQUIRED_MODULES
    if not any(name.split(".")[0] == stem for name in _collected_names)
]
if _missing:
    raise SystemExit(
        f"hook-{_PACKAGE}: the PostgreSQL module directory under {_pginstall} is "
        f"missing {', '.join(_missing)}. The embedded cluster cannot initialise "
        f"without them, so the build is stopped here rather than shipping an "
        f"installer that fails at first launch. See issue #419."
    )

hiddenimports = [_PACKAGE]

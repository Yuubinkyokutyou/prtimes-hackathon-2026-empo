"""Small, dependency-free loader for local ``.env`` configuration."""

from __future__ import annotations

import os
import re
from pathlib import Path


_ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def load_env_file(path: Path, *, override: bool = False) -> tuple[str, ...]:
    """Load simple KEY=VALUE pairs without logging secret values.

    Existing process variables win by default, matching common dotenv behavior.
    The MVP intentionally supports only literal values; shell interpolation and
    command substitution are never evaluated.
    """

    if not path.is_file():
        return ()

    loaded: list[str] = []
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.strip()
        if not _ASSIGNMENT.fullmatch(name):
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        if override or name not in os.environ:
            os.environ[name] = value
            loaded.append(name)
    return tuple(loaded)


__all__ = ["load_env_file"]

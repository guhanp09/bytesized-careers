"""Print what a production deployment has to supply.

    python -m scripts.print_config_contract

For whoever is filling in environment variables before a release, so that job
does not start with reading a Python module. Generated from
`app.core.config_contract` on every run rather than written out anywhere, because
a checklist maintained by hand goes stale silently and this one is checked by
tests the moment a setting is added.

Prints names only. It never reads a value and never touches an environment, so it
is safe to run and paste anywhere.
"""

from __future__ import annotations

from app.core.config import Settings
from app.core.config_contract import (
    CONFIG_CONTRACT,
    Enforcement,
    Requirement,
    fields_with_requirement,
)

_HEADINGS: dict[Requirement, tuple[str, str]] = {
    Requirement.CORE_REQUIRED: (
        "MUST BE SET — production refuses to boot without these",
        "Not advice. Something raises.",
    ),
    Requirement.FEATURE_CONDITIONAL: (
        "SET IF YOU WANT THE FEATURE",
        "Absent means the feature is off, and off is a complete, safe state.",
    ),
    Requirement.OPTIONAL_DEVELOPMENT: (
        "SAFE TO LEAVE ALONE",
        "Defaults are production-safe. Bounded, so tuning cannot go badly wrong.",
    ),
    Requirement.TEST_ONLY: (
        "DEVELOPMENT AND QA ONLY",
        "Cannot take effect in production even if set there.",
    ),
}


def _alias(field_name: str) -> str:
    alias = Settings.model_fields[field_name].alias
    return alias or field_name.upper()


def _wrap(text: str, width: int = 76, indent: str = "      ") -> str:
    words = text.split()
    lines: list[str] = []
    current = indent
    for word in words:
        if len(current) + len(word) + 1 > width and current.strip():
            lines.append(current)
            current = indent
        current = f"{current}{word} " if current.strip() else f"{indent}{word} "
    if current.strip():
        lines.append(current)
    return "\n".join(line.rstrip() for line in lines)


def render() -> str:
    out: list[str] = ["", "PRODUCTION CONFIGURATION CONTRACT", ""]

    for requirement, (heading, subtitle) in _HEADINGS.items():
        names = fields_with_requirement(requirement)
        out.append(f"{heading}  ({len(names)})")
        out.append(f"  {subtitle}")
        out.append("")
        for name in names:
            entry = CONFIG_CONTRACT[name]
            marker = (
                " [needs an explicit acknowledgement]"
                if entry.enforcement is Enforcement.ACKNOWLEDGEMENT
                else ""
            )
            out.append(f"  {_alias(name)}{marker}")
            out.append(_wrap(entry.why))
            out.append("")
        out.append("")

    return "\n".join(out)


if __name__ == "__main__":  # pragma: no cover - operator entry point
    print(render())

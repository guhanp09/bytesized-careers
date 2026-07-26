"""One canonical deterministic scenario generator.

Produces language-neutral JSON manifests read by two thin consumers: the backend
QA restore path and frontend Mock mode. Neither consumer authors content, which
is the property that stops a TypeScript fixture and a Python seed drifting apart.
"""

from .generator import SCENARIO_SEEDS, generate, manifest_json, write_all
from .schema import MANIFEST_VERSION, SCENARIO_NAMES, Manifest, scenario_id
from .validation import ManifestError, check_backend_enums, check_version, validate

__all__ = [
    "MANIFEST_VERSION",
    "SCENARIO_NAMES",
    "SCENARIO_SEEDS",
    "Manifest",
    "ManifestError",
    "check_backend_enums",
    "check_version",
    "generate",
    "manifest_json",
    "scenario_id",
    "validate",
    "write_all",
]

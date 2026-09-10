"""Local artifact validation, independent of server release admission."""

import json
import platform
from importlib.metadata import version
from pathlib import Path

from preparation_evidence import preparation_identity
from preparation_security import preparation_transport_config


def validate_runtime():
    identity = preparation_identity()
    _, object_origin = preparation_transport_config()
    packages = {}
    for requirement in Path(__file__).with_name("requirements.preparation.txt").read_text().splitlines():
        if not requirement or requirement.startswith("#"):
            continue
        name, expected = requirement.split("==")
        actual = version(name)
        if actual != expected:
            raise ValueError("Preparation package differs from the artifact lock: " + name)
        packages[name] = actual
    return {
        "service": "speedster-preparation",
        "capabilities": ["PREPARE_SIDE"],
        "preparationIdentity": identity,
        "transport": {"authentication": "BEARER_REQUIRED", "objectOrigin": object_origin, "redirects": False},
        "runtime": {"system": platform.system(), "machine": platform.machine(), "packages": packages},
    }


if __name__ == "__main__":
    print(json.dumps(validate_runtime(), sort_keys=True))

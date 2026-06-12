"""Dump the OpenAPI document to JSON without running a server.

Usage: python -m app.scripts.dump_openapi [output.json]
Consumed by scripts/gen-types.mjs to regenerate the shared TypeScript types.
"""

import json
import sys

from ..main import app


def main() -> None:
    out_path = sys.argv[1] if len(sys.argv) > 1 else "openapi.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(app.openapi(), f, indent=2)
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()

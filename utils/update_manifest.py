#!/usr/bin/env python3
"""Regenerate manifest.json from the folder structure.

Run this after adding / renaming / removing entities:

    python3 utils/update_manifest.py

The manifest only stores names; all paths are derived by convention:
    Units/<name> Data/<name>_data.json  +  <name>_image.png
    Equipments/<name> Data/<name>_data.json  +  <name>_image.png
    Traits/<name> Data/<name>_data.json  +  <name>_image.png

Fails (exit 1) if any entity folder is missing its JSON or image, so a
broken entry can never reach the site.
"""
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

CATEGORIES = [
    ("units", "Units"),
    ("equipments", "Equipments"),
    ("traits", "Traits"),
]


def scan(folder: str):
    """Return sorted entity names, validating that JSON + image both exist."""
    root = REPO / folder
    names, errors = [], []
    if not root.is_dir():
        return names, [f"missing folder: {folder}/"]
    for entry in sorted(root.iterdir()):
        if not entry.is_dir() or not entry.name.endswith(" Data"):
            continue
        name = entry.name[: -len(" Data")]
        js = entry / f"{name}_data.json"
        img = entry / f"{name}_image.png"
        if not js.is_file():
            errors.append(f"{folder}/{entry.name}: missing {js.name}")
        if not img.is_file():
            errors.append(f"{folder}/{entry.name}: missing {img.name}")
        names.append(name)
    return names, errors


def main() -> int:
    manifest, errors = {}, []
    for key, folder in CATEGORIES:
        names, errs = scan(folder)
        manifest[key] = names
        errors += errs

    if errors:
        print("REFUSING TO WRITE manifest.json - structural errors:")
        for e in errors:
            print("  -", e)
        return 1

    out = REPO / "manifest.json"
    out.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(
        "manifest.json updated: "
        + ", ".join(f"{k}={len(v)}" for k, v in manifest.items())
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

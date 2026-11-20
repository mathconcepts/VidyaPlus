"""Rebrand DeepTutor's UI text at build time, so no DeepTutor file is ever hand-edited.

DeepTutor's locale files are keyed by the English text, so only VALUES change here;
keys stay exactly as upstream ships them and every upgrade keeps working.

    python3 -I rebrand_locales.py brand.json <assembled>/web/locales

brand.json:
  name            replacement for the product name in UI text
  keep_upstream   strings that must keep saying "DeepTutor" (attribution, licence notes)
  overrides       optional {"<lang>/<file>.json": {"<key>": "<value>"}} exact overrides
"""
import json
import pathlib
import re
import sys

brand = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
root = pathlib.Path(sys.argv[2])
name = brand["name"]
keep = set(brand.get("keep_upstream", []))
overrides = brand.get("overrides", {})
word = re.compile(r"\bDeepTutor\b")

changed = 0


def walk(node):
    global changed
    if isinstance(node, dict):
        return {k: walk(v) for k, v in node.items()}
    if isinstance(node, list):
        return [walk(v) for v in node]
    if isinstance(node, str) and node not in keep and word.search(node):
        changed += 1
        return word.sub(name, node)
    return node


for f in sorted(root.rglob("*.json")):
    data = walk(json.loads(f.read_text(encoding="utf-8")))
    rel = f.relative_to(root).as_posix()
    for k, v in overrides.get(rel, {}).items():
        data[k] = v
    f.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

print(f"rebrand_locales: {changed} UI strings now say {name!r}")

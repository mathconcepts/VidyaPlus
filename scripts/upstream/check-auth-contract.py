#!/usr/bin/env python3
"""Plan T15: the Exam Brain's one coupling to DeepTutor is GET /api/auth/status
read with the `dt_token` cookie. This check reads the pinned DeepTutor source
(no imports, no running app) and fails if that contract moved.

Checks:
  1. auth.py sets _COOKIE_NAME = "dt_token"
  2. a GET "/status" route returns AuthStatusResponse and reads the cookie
  3. AuthStatusResponse has enabled: bool, authenticated: bool, user_id: str | None
  4. the web client's generated contract still lists "/api/auth/status"

Usage: scripts/upstream/check-auth-contract.py [deeptutor-root]
Exit 0 = contract holds; 1 = it moved (message says what).
"""
import ast, pathlib, sys

root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "upstream/deeptutor")
auth = root / "deeptutor/api/routers/auth.py"
contract = root / "web/contracts/generated/api.ts"
problems = []

try:
    tree = ast.parse(auth.read_text(encoding="utf-8"))
except FileNotFoundError:
    print(f"AUTH CONTRACT BROKEN: {auth} is missing"); sys.exit(1)

cookie = None
for node in tree.body:
    if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == "_COOKIE_NAME" for t in node.targets):
        if isinstance(node.value, ast.Constant):
            cookie = node.value.value
if cookie != "dt_token":
    problems.append(f'_COOKIE_NAME is {cookie!r}, expected "dt_token"')

fields = {}
for node in tree.body:
    if isinstance(node, ast.ClassDef) and node.name == "AuthStatusResponse":
        for item in node.body:
            if isinstance(item, ast.AnnAssign) and isinstance(item.target, ast.Name):
                fields[item.target.id] = ast.unparse(item.annotation).replace(" ", "")
expect = {"enabled": "bool", "authenticated": "bool", "user_id": "str|None"}
for name, ann in expect.items():
    if fields.get(name) != ann:
        problems.append(f"AuthStatusResponse.{name} is {fields.get(name)!r}, expected {ann!r}")

route_ok = False
for node in tree.body:
    if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
        for dec in node.decorator_list:
            src = ast.unparse(dec)
            if src.startswith("router.get(") and "'/status'" in src and "AuthStatusResponse" in src:
                args = ast.unparse(node.args)
                route_ok = "_COOKIE_NAME" in args and "Cookie(" in args
if not route_ok:
    problems.append('no GET "/status" route returning AuthStatusResponse that reads the dt_token cookie')

try:
    if '"/api/auth/status"' not in contract.read_text(encoding="utf-8"):
        problems.append(f"{contract} no longer lists /api/auth/status")
except FileNotFoundError:
    problems.append(f"{contract} is missing")

if problems:
    print("AUTH CONTRACT BROKEN (the Exam Brain reads /api/auth/status with dt_token):")
    for p in problems:
        print("  - " + p)
    sys.exit(1)
print("OK: DeepTutor /api/auth/status + dt_token contract holds.")

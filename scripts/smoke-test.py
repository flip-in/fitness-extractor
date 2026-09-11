#!/usr/bin/env python3
"""Smoke-test a running fitness-extractor backend.

Exercises every route, checking status codes and that responses carry real
data — a route that matches but returns nothing still fails.

Talks only to the HTTP API so it can target any deployment:

    ./scripts/smoke-test.py                          # localhost:3000
    ./scripts/smoke-test.py http://nas:3000          # the NAS
    API_KEY=... ./scripts/smoke-test.py http://nas:3000

Flags:
    --allow-empty   a database with no workouts passes (first deploy)
    --dashboard     also require GET / to serve the dashboard's index.html

The key is read from the root .env unless API_KEY is set in the environment.
Exits non-zero if any check fails, so it works as a deploy gate.
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request

ARGS = sys.argv[1:]
ALLOW_EMPTY = "--allow-empty" in ARGS
DASHBOARD = "--dashboard" in ARGS
POSITIONAL = [a for a in ARGS if not a.startswith("--")]
BASE = (POSITIONAL[0] if POSITIONAL else "http://localhost:3000").rstrip("/")
USER = "00000000-0000-0000-0000-000000000001"

KEY = os.environ.get("API_KEY")
if not KEY:
    env = os.path.join(os.path.dirname(__file__), "..", ".env")
    try:
        with open(env) as f:
            m = re.search(r"^API_KEY=(.*)$", f.read(), re.M)
            KEY = m.group(1).strip() if m else None
    except FileNotFoundError:
        pass
if not KEY:
    sys.exit("No API key: set API_KEY or provide a root .env")


def call(path, key=KEY, method="GET", body=None):
    req = urllib.request.Request(BASE + path, method=method)
    if key:
        req.add_header("X-API-Key", key)
    if body is not None:
        req.add_header("Content-Type", "application/json")
        req.data = json.dumps(body).encode()
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            try:
                return r.status, json.loads(raw)
            except ValueError:
                return r.status, raw[:80].decode(errors="replace")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw[:80].decode(errors="replace")
    except Exception as e:  # noqa: BLE001 - report any transport failure as a result
        return None, f"CONNECTION FAILED: {e}"


results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{'  — ' + detail if detail else ''}")


print(f"Target: {BASE}\n")

# Discover real ids from the API so this works against any deployment.
# 90 is the endpoint's maximum; anything larger is rejected as out of range.
status, body = call("/api/dashboard/recent?days=90")
data = body.get("data", {}) if isinstance(body, dict) else {}
workouts = data.get("workouts") or []
rings = data.get("activity_rings") or []
wid = workouts[0]["id"] if workouts else None
wid_route = next((w["id"] for w in workouts if w.get("has_route")), None)
ring_date = rings[0]["date"][:10] if rings else None

print("Routing and params")
status, body = call("/api/health", key=None)
check(
    "GET /api/health (no auth)",
    status == 200 and isinstance(body, dict) and body.get("database") == "connected",
    str(status),
)

check(
    "GET /api/dashboard/recent (querystring)",
    status == 200 and (len(workouts) > 0 or ALLOW_EMPTY),
    f"{len(workouts)} workouts" + (" (empty allowed)" if ALLOW_EMPTY else ""),
)

if wid:
    status, body = call(f"/api/workouts/{wid}")
    check("GET /api/workouts/:id", status == 200 and bool(body), str(status))
else:
    check("GET /api/workouts/:id", ALLOW_EMPTY, "no workouts to test against")

if DASHBOARD:
    req = urllib.request.Request(BASE + "/")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            html = r.read(4096).decode(errors="replace")
            ok = r.status == 200 and "<div id=\"root\"" in html
            detail = str(r.status)
    except Exception as e:  # noqa: BLE001
        ok, detail = False, str(e)
    check("GET / serves dashboard (SPA)", ok, detail)

if wid_route:
    status, body = call(f"/api/workouts/{wid_route}/route")
    route = (body.get("route") if isinstance(body, dict) else None) or {}
    pts = route.get("points") or []
    check(
        "GET /api/workouts/:id/route (nested param)",
        status == 200 and len(pts) > 0,
        f"{len(pts)} points",
    )

if ring_date:
    status, body = call(f"/api/activity-rings/{ring_date}")
    check("GET /api/activity-rings/:date", status == 200 and bool(body), str(status))

status, body = call(
    "/api/health-metrics/HKQuantityTypeIdentifierHeartRate"
    "?start_date=2020-01-01&end_date=2100-01-01"
)
check("GET /api/health-metrics/:metricType", status == 200 and bool(body), str(status))

# Heatmap: whole-world cells at the coarsest zoom, the counting status, and the sidebar
# list. The app counts uncounted routes at startup (reconcile), so right after a deploy
# the status may still be running; otherwise every route must be counted and, when any
# is, there must be cells.
status, body = call("/api/heatmap/status")
hstat = body.get("data", {}) if isinstance(body, dict) else {}
rebuild = hstat.get("rebuild") or {}
counting = bool(rebuild.get("running"))
n_routes = hstat.get("routes", 0)
n_rast = hstat.get("rasterized_workouts", 0)
check(
    "GET /api/heatmap/status",
    status == 200 and isinstance(rebuild, dict),
    f"{n_rast}/{n_routes} routes counted" + (" (counting)" if counting else ""),
)
check(
    "heatmap counts every route",
    ALLOW_EMPTY or counting or n_rast == n_routes,
    f"rasterized={n_rast} routes={n_routes}",
)
status, body = call("/api/heatmap/cells?z=8&bbox=-180,-85,180,85")
heat = body.get("data", {}) if isinstance(body, dict) else {}
n_cells = sum(len(v) // 3 for v in heat.get("cells", {}).values())
check(
    "GET /api/heatmap/cells",
    status == 200
    and isinstance(heat.get("cells"), dict)
    and (ALLOW_EMPTY or counting or n_rast == 0 or n_cells > 0),
    f"{n_cells} cells at z8",
)
status, body = call("/api/heatmap/cells?z=12&bbox=0,0,1,1")
check("heatmap unsupported zoom -> 400", status == 400, str(status))
# The world tile: a vector tile whenever anything is counted, 204 when nothing is.
status, body = call("/api/heatmap/tiles/0/0/0.mvt")
check(
    "GET /api/heatmap/tiles/0/0/0.mvt",
    # call() hands back non-JSON bodies as a (truncated) string; empty for a 204.
    (status == 200 and isinstance(body, str) and len(body) > 0)
    if n_cells > 0
    else status in (200, 204),
    f"{status}, {'protobuf body' if body else 'empty body'}",
)
status, body = call("/api/heatmap/tiles/15/0/0.mvt")
check("heatmap tile beyond max zoom -> 400", status == 400, str(status))
status, body = call("/api/heatmap/tiles/1foo/0/0.mvt")
check("heatmap tile non-integer coord -> 400", status == 400, str(status))
status, body = call("/api/heatmap/workouts")
heat_workouts = (body.get("data", {}) or {}).get("workouts") if isinstance(body, dict) else None
check(
    "GET /api/heatmap/workouts",
    status == 200 and isinstance(heat_workouts, list),
    f"{len(heat_workouts or [])} routed workouts",
)

status, body = call("/api/dashboard/favorites")
favs = (body.get("data", {}).get("workouts") if isinstance(body, dict) else None)
check(
    "GET /api/dashboard/favorites",
    status == 200 and isinstance(favs, list),
    f"{len(favs)} favorites" if isinstance(favs, list) else str(status),
)

if wid:
    # Re-assert the current flag: exercises the write path without changing state.
    current = bool(workouts[0].get("is_favorite"))
    status, body = call(
        f"/api/workouts/{wid}/favorite", method="PUT", body={"is_favorite": current}
    )
    check(
        "PUT /api/workouts/:id/favorite (idempotent)",
        status == 200 and isinstance(body, dict) and body.get("success") is True,
        str(status),
    )
    status, _ = call(f"/api/workouts/{wid}/favorite", method="PUT", body={"is_favorite": "yes"})
    check("non-boolean is_favorite -> 400", status == 400, str(status))
else:
    check("PUT /api/workouts/:id/favorite", ALLOW_EMPTY, "no workouts to test against")

status, body = call(f"/api/sync/anchors/{USER}/workouts")
check(
    "GET /api/sync/anchors/:userId/:dataType (two params)",
    status in (200, 404),
    str(status),
)

print("\nValidation")
status, _ = call("/api/activity-rings/not-a-date")
check("malformed date -> 400", status == 400, str(status))

status, _ = call("/api/dashboard/recent?days=99999")
check("out-of-range days -> 400", status == 400, str(status))

status, _ = call("/api/health-metrics/HKQuantityTypeIdentifierHeartRate")
check("missing required dates -> 400", status == 400, str(status))

print("\nAuth")
status, _ = call("/api/dashboard/recent?days=7", key="wrong-key")
check("bad API key rejected", status in (401, 403), str(status))

status, _ = call("/api/dashboard/recent?days=7", key=None)
check("missing API key rejected", status in (401, 403), str(status))

print("\nUnknown route")
status, _ = call("/api/does-not-exist")
check("unknown path -> 404", status == 404, str(status))

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
if failed:
    print("FAILURES:")
    for name, _, detail in failed:
        print(f"  - {name} ({detail})")
    sys.exit(1)

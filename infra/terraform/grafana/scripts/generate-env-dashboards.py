#!/usr/bin/env python3
"""Generate DressMe Production / Staging Grafana dashboard JSON.

Run from repo:
  python3 infra/terraform/grafana/scripts/generate-env-dashboards.py

Outputs:
  infra/terraform/grafana/dashboards/dressme-prod.json
  infra/terraform/grafana/dashboards/dressme-stg.json

Cloudflare Free Adaptive Analytics limits (verified against the zone):
  - max query span ~30d (4w2d); no datetimeDay_ASC enum
  - edgeTimeToFirstByteMs not entitled; use avg.originResponseDurationMs
  - year windows use CloudWatch/Prometheus instead of Cloudflare GraphQL
"""

from __future__ import annotations

import json
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parents[1] / "dashboards"

# source: "cf" = Infinity GraphQL; "cw" = CloudWatch via Prometheus (CF Free retention)
WINDOWS = [
    {
        "title": "Last hour",
        "time_from": "now-1h",
        "source": "cf",
        "dim": "datetimeMinute",
        "order_by": "datetimeMinute_ASC",
    },
    {
        "title": "Last day",
        "time_from": "now-1d",
        "source": "cf",
        "dim": "datetimeHour",
        "order_by": "datetimeHour_ASC",
    },
    {
        "title": "Last week",
        "time_from": "now-7d",
        "source": "cf",
        "dim": "datetimeHour",
        "order_by": "datetimeHour_ASC",
    },
    {
        # CF Free maxDuration ≈ 30d; label stays "Last month"
        "title": "Last month",
        "time_from": "now-30d",
        "source": "cf",
        "dim": "datetimeHour",
        "order_by": "datetimeHour_ASC",
    },
    {
        "title": "Last year",
        "time_from": "now-365d",
        "source": "cw",
        "dim": None,
        "order_by": None,
    },
]

# Traffic / errors / latency: half prior height (7→4), twice prior width (4→8).
# 3 panels per row (24-wide grid); 5 windows → 2 rows (3 + 2).
METRIC_PANEL_H = 4
METRIC_PANEL_W = 8
METRIC_PANELS_PER_ROW = 3


def metric_grid_pos(index: int, y_start: int) -> dict:
    row, col = divmod(index, METRIC_PANELS_PER_ROW)
    return {
        "h": METRIC_PANEL_H,
        "w": METRIC_PANEL_W,
        "x": col * METRIC_PANEL_W,
        "y": y_start + row * METRIC_PANEL_H,
    }


def metric_section_height() -> int:
    rows = (len(WINDOWS) + METRIC_PANELS_PER_ROW - 1) // METRIC_PANELS_PER_ROW
    return rows * METRIC_PANEL_H

ENVS = {
    "prod": {
        "uid": "dressme-prod",
        "title": "DressMe — Production",
        "environment": "prod",
        "host": "dressme.7oas7er.com",
        "probe_job": "dressme-prod-site",
        "probe_job_api": "dressme-prod-health",
        "cf_name": "prod-dressme-site-distribution",
    },
    "stg": {
        "uid": "dressme-stg",
        "title": "DressMe — Staging",
        "environment": "stg",
        "host": "dressme-stg.7oas7er.com",
        "probe_job": "dressme-stg-site",
        "probe_job_api": "dressme-stg-health",
        "cf_name": "stg-dressme-site-distribution",
    },
}


def ts_field(unit: str = "short", *, bars: bool = False) -> dict:
    if bars:
        custom = {
            "drawStyle": "bars",
            "lineWidth": 1,
            "fillOpacity": 80,
            "spanNulls": False,
            "showPoints": "never",
            "barAlignment": 0,
        }
    else:
        custom = {
            "drawStyle": "line",
            "lineWidth": 2,
            "fillOpacity": 10,
            "spanNulls": False,
            "showPoints": "auto",
        }
    return {
        "defaults": {
            "unit": unit,
            "custom": custom,
        },
        "overrides": [],
    }


def ts_options() -> dict:
    return {
        "legend": {"displayMode": "list", "placement": "bottom", "showLegend": True},
        "tooltip": {"mode": "multi", "sort": "none"},
    }


def row(panel_id: int, title: str, y: int) -> dict:
    return {
        "type": "row",
        "title": title,
        "gridPos": {"h": 1, "w": 24, "x": 0, "y": y},
        "id": panel_id,
        "collapsed": False,
    }


def cf_infinity(
    ref_id: str,
    *,
    dataset: str,
    columns: list[dict],
    query_body: str,
    root_selector: str,
    fmt: str = "timeseries",
) -> dict:
    """Infinity GraphQL target. Query must live in url_options.body_graphql_query."""
    return {
        "refId": ref_id,
        "type": "graphql",
        "source": "url",
        "format": fmt,
        "url": "https://api.cloudflare.com/client/v4/graphql",
        "url_options": {
            "method": "POST",
            "data": query_body,
            "body_type": "graphql",
            "body_content_type": "application/json",
            "body_graphql_query": query_body,
        },
        "parser": "backend",
        "root_selector": root_selector,
        "columns": columns,
        "filters": [],
        "data": "",
    }


def cf_graphql(
    ref_id: str,
    host: str,
    dim: str,
    order_by: str,
    columns: list[dict],
    extra_filter: str = "",
    avg_fields: list[str] | None = None,
    sum_fields: list[str] | None = None,
    *,
    limit: int = 2000,
    fmt: str = "timeseries",
    eyeball: bool = False,
) -> dict:
    avg_block = ""
    if avg_fields:
        inner = "\n".join(f"          {f}" for f in avg_fields)
        avg_block = f"\n        avg {{\n{inner}\n        }}"
    sum_block = ""
    if sum_fields:
        inner = "\n".join(f"          {f}" for f in sum_fields)
        sum_block = f"\n        sum {{\n{inner}\n        }}"
    eyeball_line = '          requestSource: "eyeball"\n' if eyeball else ""
    data = (
        "query {\n"
        "  viewer {\n"
        '    zones(filter: { zoneTag: "${cf_zone}" }) {\n'
        "      httpRequestsAdaptiveGroups(\n"
        f"        limit: {limit}\n"
        f"        orderBy: [{order_by}]\n"
        "        filter: {\n"
        '          datetime_geq: "${__from:date:iso}"\n'
        '          datetime_leq: "${__to:date:iso}"\n'
        f'          clientRequestHTTPHost: "{host}"\n'
        f"{eyeball_line}"
        f"{extra_filter}"
        "        }\n"
        "      ) {\n"
        "        count"
        f"{sum_block}"
        f"{avg_block}\n"
        f"        dimensions {{ {dim} }}\n"
        "      }\n"
        "    }\n"
        "  }\n"
        "}"
    )
    return cf_infinity(
        ref_id,
        dataset="httpRequestsAdaptiveGroups",
        columns=columns,
        query_body=data,
        root_selector="data.viewer.zones.0.httpRequestsAdaptiveGroups",
        fmt=fmt,
    )


def cf_firewall_events(ref_id: str, host: str) -> dict:
    data = (
        "query {\n"
        "  viewer {\n"
        '    zones(filter: { zoneTag: "${cf_zone}" }) {\n'
        "      firewallEventsAdaptive(\n"
        "        limit: 50\n"
        "        orderBy: [datetime_DESC]\n"
        "        filter: {\n"
        '          datetime_geq: "${__from:date:iso}"\n'
        '          datetime_leq: "${__to:date:iso}"\n'
        f'          clientRequestHTTPHost: "{host}"\n'
        "        }\n"
        "      ) {\n"
        "        datetime\n"
        "        action\n"
        "        source\n"
        "        clientIP\n"
        "        clientCountryName\n"
        "        clientRequestPath\n"
        "        edgeResponseStatus\n"
        "        description\n"
        "      }\n"
        "    }\n"
        "  }\n"
        "}"
    )
    return cf_infinity(
        ref_id,
        dataset="firewallEventsAdaptive",
        columns=[
            {"selector": "datetime", "text": "time", "type": "timestamp"},
            {"selector": "action", "text": "action", "type": "string"},
            {"selector": "source", "text": "source", "type": "string"},
            {"selector": "clientIP", "text": "clientIP", "type": "string"},
            {"selector": "clientCountryName", "text": "country", "type": "string"},
            {"selector": "clientRequestPath", "text": "path", "type": "string"},
            {"selector": "edgeResponseStatus", "text": "status", "type": "number"},
            {"selector": "description", "text": "description", "type": "string"},
        ],
        query_body=data,
        root_selector="data.viewer.zones.0.firewallEventsAdaptive",
        fmt="table",
    )


def traffic_panel(panel_id: int, cfg: dict, win: dict, grid_pos: dict) -> dict:
    host, cf_name = cfg["host"], cfg["cf_name"]
    title, time_from = win["title"], win["time_from"]
    if win["source"] == "cw":
        return {
            "id": panel_id,
            "type": "timeseries",
            "title": title,
            "description": (
                f"CloudFront requests ({cf_name}). Cloudflare Adaptive Analytics on Free "
                "only retain ~30 days, so the year window uses CloudWatch."
            ),
            "gridPos": grid_pos,
            "timeFrom": time_from,
            "datasource": {"type": "prometheus", "uid": "${datasource}"},
            "fieldConfig": ts_field(bars=True),
            "options": ts_options(),
            "targets": [
                {
                    "refId": "A",
                    "expr": (
                        f'sum(rate(aws_cloudfront_requests_sum{{project="dressme", '
                        f'Name="{cf_name}"}}[1h]))'
                    ),
                    "legendFormat": "requests",
                }
            ],
        }
    dim, order_by = win["dim"], win["order_by"]
    return {
        "id": panel_id,
        "type": "timeseries",
        "title": title,
        "description": f"Cloudflare edge requests ({host}), fixed range {time_from}.",
        "gridPos": grid_pos,
        "timeFrom": time_from,
        "datasource": {"type": "yesoreyeram-infinity-datasource", "uid": "${infinity}"},
        "fieldConfig": ts_field(bars=True),
        "options": ts_options(),
        "targets": [
            cf_graphql(
                "A",
                host,
                dim,
                order_by,
                [
                    {"selector": f"dimensions.{dim}", "text": "Time", "type": "timestamp"},
                    {"selector": "count", "text": "requests", "type": "number"},
                ],
            )
        ],
    }


def error_series_colors() -> list[dict]:
    """4xx = yellow (ref A), 5xx = red (ref B).

    Infinity timeseries frames often expose a generic value field name, so name/regexp
    matchers miss; byFrameRefID matches the query targets reliably. byName covers the
    CloudWatch year panel legend formats as a fallback.
    """
    yellow = {"mode": "fixed", "fixedColor": "yellow"}
    red = {"mode": "fixed", "fixedColor": "red"}
    return [
        {
            "matcher": {"id": "byFrameRefID", "options": "A"},
            "properties": [{"id": "color", "value": yellow}],
        },
        {
            "matcher": {"id": "byFrameRefID", "options": "B"},
            "properties": [{"id": "color", "value": red}],
        },
        {
            "matcher": {"id": "byName", "options": "4xx"},
            "properties": [{"id": "color", "value": yellow}],
        },
        {
            "matcher": {"id": "byName", "options": "4xx %"},
            "properties": [{"id": "color", "value": yellow}],
        },
        {
            "matcher": {"id": "byName", "options": "5xx"},
            "properties": [{"id": "color", "value": red}],
        },
        {
            "matcher": {"id": "byName", "options": "5xx %"},
            "properties": [{"id": "color", "value": red}],
        },
    ]


def errors_panel(panel_id: int, cfg: dict, win: dict, grid_pos: dict) -> dict:
    host, cf_name = cfg["host"], cfg["cf_name"]
    title, time_from = win["title"], win["time_from"]
    if win["source"] == "cw":
        field = ts_field("percent", bars=True)
        field["overrides"] = error_series_colors()
        return {
            "id": panel_id,
            "type": "timeseries",
            "title": title,
            "description": (
                f"CloudFront 4xx/5xx error rates ({cf_name}). Year window uses CloudWatch "
                "(rates %, not request counts) because CF Free Adaptive max span is ~30d."
            ),
            "gridPos": grid_pos,
            "timeFrom": time_from,
            "datasource": {"type": "prometheus", "uid": "${datasource}"},
            "fieldConfig": field,
            "options": ts_options(),
            "targets": [
                {
                    "refId": "A",
                    "expr": (
                        f'avg(aws_cloudfront_4xx_error_rate_average{{project="dressme", '
                        f'Name="{cf_name}"}})'
                    ),
                    "legendFormat": "4xx %",
                },
                {
                    "refId": "B",
                    "expr": (
                        f'avg(aws_cloudfront_5xx_error_rate_average{{project="dressme", '
                        f'Name="{cf_name}"}})'
                    ),
                    "legendFormat": "5xx %",
                },
            ],
        }

    dim, order_by = win["dim"], win["order_by"]

    def cols(label: str) -> list[dict]:
        return [
            {"selector": f"dimensions.{dim}", "text": "Time", "type": "timestamp"},
            {"selector": "count", "text": label, "type": "number"},
        ]

    field = ts_field(bars=True)
    field["overrides"] = error_series_colors()
    return {
        "id": panel_id,
        "type": "timeseries",
        "title": title,
        "description": f"Cloudflare edge 4xx and 5xx counts ({host}), fixed range {time_from}.",
        "gridPos": grid_pos,
        "timeFrom": time_from,
        "datasource": {"type": "yesoreyeram-infinity-datasource", "uid": "${infinity}"},
        "fieldConfig": field,
        "options": ts_options(),
        "targets": [
            cf_graphql(
                "A",
                host,
                dim,
                order_by,
                cols("4xx"),
                extra_filter=(
                    "          edgeResponseStatus_geq: 400\n"
                    "          edgeResponseStatus_leq: 499\n"
                ),
            ),
            cf_graphql(
                "B",
                host,
                dim,
                order_by,
                cols("5xx"),
                extra_filter=(
                    "          edgeResponseStatus_geq: 500\n"
                    "          edgeResponseStatus_leq: 599\n"
                ),
            ),
        ],
    }


def latency_panel(panel_id: int, cfg: dict, win: dict, grid_pos: dict) -> dict:
    """CloudFront OriginLatency + Cloudflare originResponseDurationMs (Free has no edge TTFB)."""
    host, cf_name = cfg["host"], cfg["cf_name"]
    title, time_from = win["title"], win["time_from"]
    origin_target = {
        "refId": "A",
        "datasource": {"type": "prometheus", "uid": "${datasource}"},
        "expr": (
            f'avg(aws_cloudfront_origin_latency_average{{project="dressme", '
            f'Name="{cf_name}"}})'
        ),
        "legendFormat": "CF OriginLatency",
    }

    if win["source"] == "cw":
        return {
            "id": panel_id,
            "type": "timeseries",
            "title": title,
            "description": (
                f"CloudFront OriginLatency ({cf_name}). Cloudflare edge TTFB is not available "
                "on Free Adaptive Analytics; year window is CloudWatch-only."
            ),
            "gridPos": grid_pos,
            "timeFrom": time_from,
            "datasource": {"type": "prometheus", "uid": "${datasource}"},
            "fieldConfig": ts_field("ms", bars=True),
            "options": ts_options(),
            "targets": [origin_target],
        }

    dim, order_by = win["dim"], win["order_by"]
    return {
        "id": panel_id,
        "type": "timeseries",
        "title": title,
        "description": (
            f"CloudFront OriginLatency ({cf_name}) and Cloudflare "
            f"avg.originResponseDurationMs ({host}). Free plan does not expose edge TTFB."
        ),
        "gridPos": grid_pos,
        "timeFrom": time_from,
        "datasource": {"type": "datasource", "uid": "-- Mixed --"},
        "fieldConfig": ts_field("ms", bars=True),
        "options": ts_options(),
        "targets": [
            origin_target,
            {
                **cf_graphql(
                    "B",
                    host,
                    dim,
                    order_by,
                    [
                        {
                            "selector": f"dimensions.{dim}",
                            "text": "Time",
                            "type": "timestamp",
                        },
                        {
                            "selector": "avg.originResponseDurationMs",
                            "text": "CF origin duration",
                            "type": "number",
                        },
                    ],
                    avg_fields=["originResponseDurationMs"],
                ),
                "datasource": {
                    "type": "yesoreyeram-infinity-datasource",
                    "uid": "${infinity}",
                },
            },
        ],
    }


def build_dashboard(env_key: str) -> dict:
    cfg = ENVS[env_key]
    env = cfg["environment"]
    host = cfg["host"]
    job = cfg["probe_job"]
    cf_name = cfg["cf_name"]
    next_id = 1
    panels: list[dict] = []
    y = 0

    def nid() -> int:
        nonlocal next_id
        i = next_id
        next_id += 1
        return i

    panels.append(
        row(
            nid(),
            "Traffic — requests (CF Adaptive ≤30d; year = CloudWatch)",
            y,
        )
    )
    y += 1
    for i, win in enumerate(WINDOWS):
        panels.append(traffic_panel(nid(), cfg, win, metric_grid_pos(i, y)))
    y += metric_section_height()

    panels.append(
        row(nid(), "Errors — 4xx / 5xx (CF counts ≤30d; year = CloudWatch rates)", y)
    )
    y += 1
    for i, win in enumerate(WINDOWS):
        panels.append(errors_panel(nid(), cfg, win, metric_grid_pos(i, y)))
    y += metric_section_height()

    panels.append(
        row(
            nid(),
            "Latency — CF OriginLatency + CF origin duration (no Free edge TTFB)",
            y,
        )
    )
    y += 1
    for i, win in enumerate(WINDOWS):
        panels.append(latency_panel(nid(), cfg, win, metric_grid_pos(i, y)))
    y += metric_section_height()

    panels.append(row(nid(), "Synthetics — availability", y))
    y += 1
    # Same tile size as traffic/errors/latency (h=4, w=8; 3 per row).
    # DressMe also probes /api/health (in addition to the site).
    api_job = cfg["probe_job_api"]

    def uptime_stat(title: str, probe_job: str, grid_idx: int) -> dict:
        return {
            "id": nid(),
            "type": "stat",
            "title": title,
            "description": f"Average probe_success for {probe_job}",
            "gridPos": metric_grid_pos(grid_idx, y),
            "datasource": {"type": "prometheus", "uid": "${datasource}"},
            "fieldConfig": {
                "defaults": {
                    "unit": "percentunit",
                    "min": 0,
                    "max": 1,
                    "thresholds": {
                        "mode": "absolute",
                        "steps": [
                            {"color": "red", "value": None},
                            {"color": "yellow", "value": 0.95},
                            {"color": "green", "value": 0.99},
                        ],
                    },
                },
                "overrides": [],
            },
            "options": {
                "reduceOptions": {"calcs": ["mean"], "fields": "", "values": False},
                "colorMode": "background",
                "graphMode": "none",
                "textMode": "value_and_name",
            },
            "targets": [
                {
                    "refId": "A",
                    "expr": f'avg(probe_success{{project="dressme", job="{probe_job}"}})',
                    "legendFormat": "uptime",
                }
            ],
        }

    panels.append(uptime_stat(f"{env} site", job, 0))
    panels.append(uptime_stat(f"{env} /api/health", api_job, 1))

    synth_charts = [
        (
            2,
            "Probe success",
            f'probe_success{{project="dressme", environment="{env}"}}',
            "short",
            "{{job}} / {{probe}}",
            None,
        ),
        (
            3,
            "Probe duration",
            f'probe_duration_seconds{{project="dressme", environment="{env}"}}',
            "s",
            "{{job}} / {{probe}}",
            None,
        ),
        (
            4,
            "HTTP status code",
            f'probe_http_status_code{{project="dressme", environment="{env}"}}',
            "short",
            "{{job}} / {{probe}}",
            None,
        ),
        (
            5,
            "HTTP phase latency",
            (
                f'avg by (phase) (probe_http_duration_seconds{{project="dressme", '
                f'environment="{env}"}})'
            ),
            "s",
            "{{phase}}",
            {"mode": "normal", "group": "A"},
        ),
    ]
    for idx, title, expr, unit, legend, stacking in synth_charts:
        defaults: dict = {
            "unit": unit,
            "custom": {
                "drawStyle": "line",
                "lineWidth": 2,
                "fillOpacity": 10,
                "spanNulls": False,
                "showPoints": "never" if stacking else "auto",
            },
        }
        if stacking:
            defaults["custom"]["stacking"] = stacking
        if "success" in title.lower():
            defaults["min"] = 0
            defaults["max"] = 1
        panels.append(
            {
                "id": nid(),
                "type": "timeseries",
                "title": title,
                **(
                    {"description": "DNS / connect / TLS / processing / transfer"}
                    if title == "HTTP phase latency"
                    else {}
                ),
                "gridPos": metric_grid_pos(idx, y),
                "datasource": {"type": "prometheus", "uid": "${datasource}"},
                "fieldConfig": {"defaults": defaults, "overrides": []},
                "options": ts_options(),
                "targets": [{"refId": "A", "expr": expr, "legendFormat": legend}],
            }
        )
    panels.append(
        {
            "id": nid(),
            "type": "logs",
            "title": "Synthetic check logs",
            "description": "Loki logs from Synthetic Monitoring agents for this environment",
            "gridPos": metric_grid_pos(6, y),
            "datasource": {"type": "loki", "uid": "${loki}"},
            "options": {
                "showTime": True,
                "showLabels": True,
                "showCommonLabels": False,
                "wrapLogMessage": True,
                "prettifyLogMessage": False,
                "enableLogDetails": True,
                "dedupStrategy": "none",
                "sortOrder": "Descending",
            },
            "targets": [
                {
                    "refId": "A",
                    "expr": (
                        f'{{source="synthetic-monitoring-agent", project="dressme", '
                        f'environment="{env}"}}'
                    ),
                    "queryType": "range",
                }
            ],
        }
    )
    # 7 tiles (2 stats + 4 charts + logs) → 3 rows at h=4
    y += METRIC_PANEL_H * 3

    # --- Cloudflare (items 1–8): volume, cache/status/bots, paths/geo/firewall ---
    # Uses dashboard time range; keep ≤ ~30d on Free Adaptive Analytics.
    infinity_ds = {"type": "yesoreyeram-infinity-datasource", "uid": "${infinity}"}

    panels.append(row(nid(), "Cloudflare — volume", y))
    y += 1
    # 1 Bandwidth
    panels.append(
        {
            "id": nid(),
            "type": "timeseries",
            "title": "Bandwidth",
            "description": f"sum.edgeResponseBytes for {host} (eyeball traffic).",
            "gridPos": metric_grid_pos(0, y),
            "datasource": infinity_ds,
            "fieldConfig": ts_field("decbytes", bars=True),
            "options": ts_options(),
            "targets": [
                cf_graphql(
                    "A",
                    host,
                    "datetimeHour",
                    "datetimeHour_ASC",
                    [
                        {
                            "selector": "dimensions.datetimeHour",
                            "text": "Time",
                            "type": "timestamp",
                        },
                        {
                            "selector": "sum.edgeResponseBytes",
                            "text": "bytes",
                            "type": "number",
                        },
                    ],
                    sum_fields=["edgeResponseBytes"],
                    eyeball=True,
                )
            ],
        }
    )
    # 6 Visits
    panels.append(
        {
            "id": nid(),
            "type": "timeseries",
            "title": "Visits",
            "description": (
                f"sum.visits for {host} (Cloudflare visit = page view with external/direct referrer)."
            ),
            "gridPos": metric_grid_pos(1, y),
            "datasource": infinity_ds,
            "fieldConfig": ts_field(bars=True),
            "options": ts_options(),
            "targets": [
                cf_graphql(
                    "A",
                    host,
                    "datetimeHour",
                    "datetimeHour_ASC",
                    [
                        {
                            "selector": "dimensions.datetimeHour",
                            "text": "Time",
                            "type": "timestamp",
                        },
                        {"selector": "sum.visits", "text": "visits", "type": "number"},
                    ],
                    sum_fields=["visits"],
                    eyeball=True,
                )
            ],
        }
    )
    # 3 Status mix
    panels.append(
        {
            "id": nid(),
            "type": "table",
            "title": "Status mix",
            "description": f"edgeResponseStatus totals for {host} in the dashboard range.",
            "gridPos": metric_grid_pos(2, y),
            "datasource": infinity_ds,
            "options": {"showHeader": True},
            "fieldConfig": {"defaults": {}, "overrides": []},
            "targets": [
                cf_graphql(
                    "A",
                    host,
                    "edgeResponseStatus",
                    "count_DESC",
                    [
                        {
                            "selector": "dimensions.edgeResponseStatus",
                            "text": "status",
                            "type": "number",
                        },
                        {"selector": "count", "text": "requests", "type": "number"},
                    ],
                    limit=30,
                    fmt="table",
                    eyeball=True,
                )
            ],
        }
    )
    y += METRIC_PANEL_H

    panels.append(row(nid(), "Cloudflare — cache & bots", y))
    y += 1
    # 2 Cache status
    panels.append(
        {
            "id": nid(),
            "type": "table",
            "title": "Cache status",
            "description": f"cacheStatus breakdown for {host} (HIT/MISS/EXPIRED/…).",
            "gridPos": metric_grid_pos(0, y),
            "datasource": infinity_ds,
            "options": {"showHeader": True},
            "fieldConfig": {"defaults": {}, "overrides": []},
            "targets": [
                cf_graphql(
                    "A",
                    host,
                    "cacheStatus",
                    "count_DESC",
                    [
                        {
                            "selector": "dimensions.cacheStatus",
                            "text": "cache",
                            "type": "string",
                        },
                        {"selector": "count", "text": "requests", "type": "number"},
                        {
                            "selector": "sum.edgeResponseBytes",
                            "text": "bytes",
                            "type": "number",
                        },
                    ],
                    sum_fields=["edgeResponseBytes"],
                    limit=20,
                    fmt="table",
                    eyeball=True,
                )
            ],
        }
    )
    # 8 Bot categories
    panels.append(
        {
            "id": nid(),
            "type": "table",
            "title": "Verified bots",
            "description": f"verifiedBotCategory for {host} (empty = unverified / human-ish).",
            "gridPos": metric_grid_pos(1, y),
            "datasource": infinity_ds,
            "options": {"showHeader": True},
            "fieldConfig": {"defaults": {}, "overrides": []},
            "targets": [
                cf_graphql(
                    "A",
                    host,
                    "verifiedBotCategory",
                    "count_DESC",
                    [
                        {
                            "selector": "dimensions.verifiedBotCategory",
                            "text": "bot category",
                            "type": "string",
                        },
                        {"selector": "count", "text": "requests", "type": "number"},
                    ],
                    limit=20,
                    fmt="table",
                    eyeball=False,
                )
            ],
        }
    )
    # 5 Geography (compact)
    panels.append(
        {
            "id": nid(),
            "type": "table",
            "title": "Countries",
            "description": f"Top clientCountryName for {host}.",
            "gridPos": metric_grid_pos(2, y),
            "datasource": infinity_ds,
            "options": {"showHeader": True},
            "fieldConfig": {"defaults": {}, "overrides": []},
            "targets": [
                cf_graphql(
                    "A",
                    host,
                    "clientCountryName",
                    "count_DESC",
                    [
                        {
                            "selector": "dimensions.clientCountryName",
                            "text": "country",
                            "type": "string",
                        },
                        {"selector": "count", "text": "requests", "type": "number"},
                    ],
                    limit=15,
                    fmt="table",
                    eyeball=True,
                )
            ],
        }
    )
    y += METRIC_PANEL_H

    panels.append(row(nid(), "Cloudflare — paths & firewall", y))
    y += 1
    # 4 Top paths (taller)
    panels.append(
        {
            "id": nid(),
            "type": "table",
            "title": "Top paths",
            "description": f"Top clientRequestPath + method for {host}.",
            "gridPos": {
                "h": METRIC_PANEL_H * 2,
                "w": METRIC_PANEL_W,
                "x": 0,
                "y": y,
            },
            "datasource": infinity_ds,
            "options": {"showHeader": True},
            "fieldConfig": {"defaults": {}, "overrides": []},
            "targets": [
                cf_graphql(
                    "A",
                    host,
                    "clientRequestPath clientRequestHTTPMethodName",
                    "count_DESC",
                    [
                        {
                            "selector": "dimensions.clientRequestHTTPMethodName",
                            "text": "method",
                            "type": "string",
                        },
                        {
                            "selector": "dimensions.clientRequestPath",
                            "text": "path",
                            "type": "string",
                        },
                        {"selector": "count", "text": "requests", "type": "number"},
                        {
                            "selector": "sum.edgeResponseBytes",
                            "text": "bytes",
                            "type": "number",
                        },
                    ],
                    sum_fields=["edgeResponseBytes"],
                    limit=25,
                    fmt="table",
                    eyeball=True,
                )
            ],
        }
    )
    # 7 Firewall events (taller, double width for columns)
    panels.append(
        {
            "id": nid(),
            "type": "table",
            "title": "Firewall events",
            "description": (
                f"firewallEventsAdaptive for {host} (may be empty when no WAF/firewall matches). "
                "Free plan: event rows only; aggregated firewall groups are unavailable."
            ),
            "gridPos": {
                "h": METRIC_PANEL_H * 2,
                "w": METRIC_PANEL_W * 2,
                "x": METRIC_PANEL_W,
                "y": y,
            },
            "datasource": infinity_ds,
            "options": {"showHeader": True},
            "fieldConfig": {"defaults": {}, "overrides": []},
            "targets": [cf_firewall_events("A", host)],
        }
    )
    y += METRIC_PANEL_H * 2

    panels.append(row(nid(), "GitHub Actions CI", y))
    y += 1
    for title, workflow, h, x, yy in [
        ("Deploy workflow runs", "deploy-dressme.yml", 8, 0, y),
        ("Terraform plan workflow runs", "terraform-plan.yml", 8, 12, y),
        ("Deploy workflow usage", "deploy-dressme.yml", 6, 0, y + 8),
        ("Terraform plan workflow usage", "terraform-plan.yml", 6, 12, y + 8),
    ]:
        qtype = "Workflow_Usage" if "usage" in title.lower() else "Workflow_Runs"
        panels.append(
            {
                "id": nid(),
                "type": "table",
                "title": title,
                "description": f"{qtype} for {workflow}.",
                "gridPos": {"h": h, "w": 12, "x": x, "y": yy},
                "datasource": {"type": "grafana-github-datasource", "uid": "${github}"},
                "options": {"showHeader": True},
                # grafana-github-datasource reads workflow from options.workflow
                # (top-level "workflow" is ignored → empty → "workflow not found").
                "targets": [
                    {
                        "refId": "A",
                        "queryType": qtype,
                        "owner": "$gh_owner",
                        "repository": "$gh_repo",
                        "options": {"workflow": workflow},
                    }
                ],
            }
        )

    return {
        "uid": cfg["uid"],
        "title": cfg["title"],
        "description": (
            f"DressMe {env}: fixed-window traffic / errors / latency, synthetics, "
            "Cloudflare edge, and GitHub Actions."
        ),
        "tags": ["dressme", env, "synthetics", "observability", "cloudflare", "github"],
        "timezone": "browser",
        "schemaVersion": 39,
        "version": 2,
        "refresh": "1m",
        "time": {"from": "now-6h", "to": "now"},
        "templating": {
            "list": [
                {
                    "name": "datasource",
                    "type": "datasource",
                    "query": "prometheus",
                    "current": {},
                    "hide": 0,
                    "includeAll": False,
                    "multi": False,
                    "refresh": 1,
                    "regex": "",
                    "skipUrlSync": False,
                },
                {
                    "name": "loki",
                    "type": "datasource",
                    "query": "loki",
                    "current": {},
                    "hide": 0,
                    "includeAll": False,
                    "multi": False,
                    "refresh": 1,
                    "regex": "",
                    "skipUrlSync": False,
                },
                {
                    "name": "infinity",
                    "type": "datasource",
                    "query": "yesoreyeram-infinity-datasource",
                    "current": {
                        "text": "Cloudflare GraphQL",
                        "value": "infinity-cloudflare",
                    },
                    "hide": 0,
                    "includeAll": False,
                    "multi": False,
                    "refresh": 1,
                    "regex": "",
                    "skipUrlSync": False,
                },
                {
                    "name": "github",
                    "type": "datasource",
                    "query": "grafana-github-datasource",
                    "current": {
                        "text": "GitHub DressMe",
                        "value": "github-dressme",
                    },
                    "hide": 0,
                    "includeAll": False,
                    "multi": False,
                    "refresh": 1,
                    "regex": "",
                    "skipUrlSync": False,
                },
                {
                    "name": "cf_zone",
                    "type": "textbox",
                    "label": "CF zoneTag",
                    "query": "",
                    "current": {"text": "", "value": ""},
                    "hide": 0,
                    "skipUrlSync": False,
                    "description": "Cloudflare zone id (terraform cloudflare output zone_id).",
                },
                {
                    "name": "gh_owner",
                    "type": "textbox",
                    "query": "7oas7er",
                    "current": {"text": "7oas7er", "value": "7oas7er"},
                    "hide": 2,
                },
                {
                    "name": "gh_repo",
                    "type": "textbox",
                    "query": "dressme",
                    "current": {"text": "dressme", "value": "dressme"},
                    "hide": 2,
                },
            ]
        },
        "annotations": {
            "list": [
                {
                    "name": "GitHub commits",
                    "datasource": {
                        "type": "grafana-github-datasource",
                        "uid": "${github}",
                    },
                    "enable": True,
                    "iconColor": "blue",
                    "target": {
                        "refId": "Anno",
                        "queryType": "Commits",
                        "owner": "$gh_owner",
                        "repository": "$gh_repo",
                    },
                }
            ]
        },
        "panels": panels,
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for key in ("prod", "stg"):
        dash = build_dashboard(key)
        path = OUT_DIR / f"dressme-{key}.json"
        path.write_text(json.dumps(dash, indent=2) + "\n")
        print(f"wrote {path} ({len(dash['panels'])} panels)")


if __name__ == "__main__":
    main()

# Grafana dashboard template (solo+AI apps)

Canonical **structure, content, and formatting** for public web apps cloned from DressMe
(also proven on Netrunner). Product-specific hosts, probe job names, CloudFront `Name`
tags, and GitHub workflow file names are parameters — do not invent a different layout
per app.

Reference implementation:

- Generator: `infra/terraform/grafana/scripts/generate-env-dashboards.py`
- Published JSON: `infra/terraform/grafana/dashboards/<slug>-prod.json` and `<slug>-stg.json`
- Terraform: `grafana_folder` + `grafana_dashboard` `for_each` over those files (inject
  `cf_zone` / `gh_owner` / `gh_repo` textbox defaults from tfvars)

Platform wiring (Infinity + GitHub **plugin**): [`7oas7er/platform`](https://github.com/7oas7er/platform) `shared-obs`. App root owns folder, dashboards, synthetics, CloudWatch scrape, per-app GitHub DS only — see [ADR 0004](adr/0004-grafana-first-observability.md) and [ADR 0007](adr/0007-shared-edge-and-obs-platform.md).

## Shape

| Item | Rule |
|------|------|
| Count | **Two** dashboards per app — Production and Staging — not one combined overview |
| Titles | `<Product> — Production` / `<Product> — Staging` |
| UIDs | `<slug>-prod` / `<slug>-stg` |
| Folder | One Grafana folder titled with the product name |
| Refresh | `1m` |
| Default time | `now-6h` → `now` (browser timezone) |
| Tags | `<slug>`, `prod`\|`stg`, `synthetics`, `observability`, `cloudflare`, `github` |
| Schema | Grafana schemaVersion **39** (match generator) |

Each dashboard is **environment-scoped**: panels filter to that env’s hostname, CloudFront
distribution `Name` tag, and synthetic probe jobs. Do not mix prod and stg series on one board.

## Variables (templating)

| Name | Type | Notes |
|------|------|--------|
| `datasource` | Prometheus | Grafana Cloud / CloudWatch scrape |
| `loki` | Loki | Synthetic check logs |
| `infinity` | Infinity | Default uid `infinity-cloudflare` (platform) |
| `github` | GitHub | Default uid `github-<slug>` (app DS) |
| `cf_zone` | textbox | Zone tag; Terraform injects from `cloudflare_zone_tag` |
| `gh_owner` / `gh_repo` | textbox (often hidden) | Terraform injects; used by CI panels + commit annotations |

## Section order (top → bottom)

Keep this order and these row titles (env-specific hostnames/jobs inside panels):

1. **Traffic — requests** — five fixed windows (see below)
2. **Errors — 4xx / 5xx (CF counts ≤30d; year = CloudWatch rates)**
3. **Latency — origin (CloudFront) + CF `originResponseDurationMs`**
4. **Synthetics — availability** — site + critical API uptime stats, success/latency charts, check logs
5. **Cloudflare — volume** — bandwidth, visits, status mix
6. **Cloudflare — cache & bots** — cache status, verified bots, countries
7. **Cloudflare — paths & firewall** — top paths; firewall **events table** (not aggregated groups)
8. **GitHub Actions CI** — deploy + terraform-plan workflow runs/usage

Annotation: **GitHub commits** on the GitHub DS (`owner`/`repository` from variables).

## Fixed time windows (traffic / errors / latency)

Metric tiles use **panel `timeFrom`**, not the dashboard picker alone — so hour/day/week/month/year stay comparable.

| Window label | `timeFrom` | Source |
|--------------|------------|--------|
| Last hour | `now-1h` | Cloudflare Adaptive (`datetimeMinute`) |
| Last day | `now-1d` | Cloudflare Adaptive (`datetimeHour`) |
| Last week | `now-7d` | Cloudflare Adaptive (`datetimeHour`) |
| Last month | `now-30d` | Cloudflare Adaptive (`datetimeHour`) — Free max span ≈ 30d; **no** `datetimeDay_ASC` |
| Last year | `now-365d` | **CloudWatch / Prometheus** only (Adaptive cannot cover a year on Free) |

## Formatting / layout

- Grid width **24**. Traffic/errors/latency tiles: **h=4, w=8**, **3 per row** (five windows → two rows: 3+2).
- Timeseries: line width 2, light fill; request/error volume may use bars where the generator does.
- Legend list at bottom; multi tooltip.
- Synthetics uptime as **stat** panels; same tile size as metric windows where practical.
- Prefer env-scoped titles in synthetics (`prod site`, `stg /api/…`).

## Cloudflare Free constraints (do not “fix” by expanding queries)

- Query **`httpRequestsAdaptiveGroups`** for traffic; **`firewallEventsAdaptive`** (table rows) for firewall — **never** `firewallEventsAdaptiveGroups` on Free.
- Infinity GraphQL query must live in `url_options.body_graphql_query` (and/or `url_options.data`). A top-level `data` field is ignored → empty query → misleading JSONata errors.
- Filter by `clientRequestHTTPHost` for the env host; zone via `${cf_zone}`.
- Latency: use `avg.originResponseDurationMs` — Free does **not** entitle edge TTFB (`edgeTimeToFirstByteMs`).
- Year-window traffic/errors: CloudWatch metrics labeled `project=<slug>` and CloudFront `Name=<env>-<slug>-site-distribution` (or the app’s real distribution Name tag).

## CloudWatch scrape expectations

- Scrape `AWS/CloudFront` (include **`OriginLatency` Average**) and app compute (e.g. `AWS/Lambda`) in `eu-north-1` + `us-east-1` when CloudFront is involved.
- Label `project=<slug>`. No dedicated “CloudWatch section” on the dashboard — scrape feeds year windows + origin latency (+ synthetics stack elsewhere).

## GitHub CI panels

- Targets put the workflow **file name** in `options.workflow` (not a top-level `workflow` field), or the plugin returns `workflow not found`.
- Cover at least the app’s **deploy** and **terraform-plan** workflows.

## New app checklist

1. Copy/adapt `generate-env-dashboards.py` — replace product title, slug, hosts, probe job names, CloudFront `Name` tags, GitHub DS uid, workflow file names, `project=` label in PromQL.
2. Emit `<slug>-prod.json` / `<slug>-stg.json`; wire `for_each` in `dashboard.tf` like DressMe.
3. Update product overlay rule (`*-observability.mdc`) with paths and synthetic API path.
4. Apply app `infra/terraform/grafana/` after synthetics URLs and CloudWatch scrape exist for that env.
5. Do **not** recreate Infinity or the GitHub catalog plugin in the app.

Anti-pattern: a single “overview” dashboard that mixes prod+stg or relies on the global time picker instead of fixed windows for the top metric rows.

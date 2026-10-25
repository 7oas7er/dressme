variable "aws_region" {
  description = "Region for the Grafana CloudWatch IAM role (eu-north-1)."
  type        = string
  default     = "eu-north-1"
}

variable "aws_profile" {
  description = "Optional AWS shared-credentials profile for local use. Leave null in CI (use the default credential chain / OIDC)."
  type        = string
  default     = null
  nullable    = true
}

variable "stack_slug" {
  description = "Grafana Cloud stack slug (from the Grafana Cloud portal URL / stack settings)."
  type        = string
}

variable "cloud_access_policy_token" {
  description = "Grafana Cloud access policy token with stacks:read (and related) scopes. Prefer GRAFANA_CLOUD_ACCESS_POLICY_TOKEN."
  type        = string
  sensitive   = true
}

variable "cloud_provider_access_token" {
  description = "Access policy token with integration-management:read|write and stacks:read. Prefer GRAFANA_CLOUD_PROVIDER_ACCESS_TOKEN."
  type        = string
  sensitive   = true
}

variable "grafana_aws_external_id" {
  description = <<-EOT
    Optional override for the IAM trust sts:ExternalId.
    Defaults to the stack prometheus_user_id. If Cloud Provider account
    create returns aws_authentication_error with no AssumeRole in CloudTrail,
    copy the External ID from Grafana → Cloud Provider → AWS → Add account
    and set it here.
  EOT
  type        = string
  default     = null
  nullable    = true
}

variable "enable_cloudwatch_scrape" {
  description = <<-EOT
    Create Grafana Cloud Provider AWS account + CloudWatch scrape job.
    Defaults to true once org RCP allows Grafana account 008923505280
    to sts:AssumeRole (see README). Set false to tear down the scrape
    job without removing the IAM role.
  EOT
  type        = bool
  default     = true
}

variable "sm_url" {
  description = "Optional override for Synthetic Monitoring API URL. Defaults to the stack sm_url from Grafana Cloud."
  type        = string
  default     = null
  nullable    = true
}

variable "sm_access_token" {
  description = "Synthetic Monitoring access token (Synthetics → Config). Prefer GRAFANA_SM_ACCESS_TOKEN."
  type        = string
  sensitive   = true
}

variable "prod_site_url" {
  description = "Production site URL to monitor."
  type        = string
  default     = "https://dressme.7oas7er.com"
}

variable "stg_site_url" {
  description = "Staging site URL to monitor."
  type        = string
  default     = "https://dressme-stg.7oas7er.com"
}

variable "prod_check_frequency_ms" {
  description = "Production synthetic check interval in milliseconds (default 5m)."
  type        = number
  default     = 300000
}

variable "stg_check_frequency_ms" {
  description = "Staging synthetic check interval in milliseconds (default 15m; keeps Free SM volume down)."
  type        = number
  default     = 900000
}

variable "check_timeout_ms" {
  description = "Synthetic check timeout in milliseconds."
  type        = number
  default     = 10000
}

variable "enable_cloudflare_edge" {
  description = <<-EOT
    Wire Cloudflare zoneTag into the DressMe dashboard (panels use shared
    Infinity DS uid infinity-cloudflare from 7oas7er/platform shared-obs).
    Requires cloudflare_zone_tag. Does not create the Infinity data source.
  EOT
  type        = bool
  default     = true
}

variable "cloudflare_analytics_token" {
  description = <<-EOT
    Cloudflare API token with Zone Analytics Read (GraphQL). Prefer
    CLOUDFLARE_ANALYTICS_TOKEN. Create via Cloudflare → My Profile → API Tokens
    (Analytics template / Zone Analytics Read). Not the deploy purge token unless
    it also has Analytics Read.
  EOT
  type        = string
  default     = null
  sensitive   = true
  nullable    = true
}

variable "cloudflare_zone_tag" {
  description = <<-EOT
    Cloudflare zone id (zoneTag) for 7oas7er.com. From cloudflare root output
    zone_id, GitHub Environment CLOUDFLARE_ZONE_ID, or the Zone ID in the
    Cloudflare dashboard overview. Defaults to the DressMe zone.
  EOT
  type        = string
  default     = "701810fff825f90c0eea671970a0cc9e"
  nullable    = true
}

variable "enable_github_ci" {
  description = <<-EOT
    Provision GitHub data source for Actions workflow panels.
    Also requires github_access_token.
  EOT
  type        = bool
  default     = true
}

variable "github_access_token" {
  description = <<-EOT
    Fine-grained (preferred) or classic PAT with read access to Actions and
    Metadata on the DressMe repo (Contents read if the plugin requests it).
    Prefer GITHUB_GRAFANA_TOKEN so it is not confused with deploy tokens.
  EOT
  type        = string
  default     = null
  sensitive   = true
  nullable    = true
}

variable "github_owner" {
  description = "GitHub owner (user or org) for DressMe CI panels."
  type        = string
  default     = "7oas7er"
}

variable "github_repository" {
  description = "GitHub repository name for DressMe CI panels."
  type        = string
  default     = "dressme"
}

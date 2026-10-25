variable "environment" {
  description = "Short environment name used in resource names and tags (for example stg or prod)."
  type        = string
}

variable "site_domain_name" {
  description = "Custom domain attached to the CloudFront distribution."
  type        = string
}

variable "site_certificate_arn" {
  description = "ACM certificate in us-east-1 used by CloudFront."
  type        = string
}

variable "github_oidc_provider_arn" {
  description = "ARN of the account GitHub Actions OIDC provider."
  type        = string
}

variable "github_actions_subject" {
  description = "Immutable GitHub Actions OIDC subject allowed to assume the deploy role."
  type        = string
}

variable "origin_verify_secret" {
  description = "Shared secret Cloudflare injects as X-Origin-Verify; CloudFront rejects requests without it."
  type        = string
  sensitive   = true
}

variable "origin_verify_secret_previous" {
  description = "Optional previous origin-verify secret accepted during rotation. Set null/omit when not rotating."
  type        = string
  sensitive   = true
  default     = null
  nullable    = true
}

variable "access_logs_retention_days" {
  description = "Days to retain CloudFront and S3 access log objects before lifecycle expiration."
  type        = number
  default     = 90

  validation {
    condition     = var.access_logs_retention_days >= 1 && var.access_logs_retention_days <= 3650
    error_message = "access_logs_retention_days must be between 1 and 3650."
  }
}

variable "lambda_log_retention_days" {
  description = "CloudWatch Logs retention for the health Lambda log group (must be a value AWS accepts)."
  type        = number
  default     = 14

  validation {
    condition = contains([
      1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653,
    ], var.lambda_log_retention_days)
    error_message = "lambda_log_retention_days must be a CloudWatch Logs-supported retention value."
  }
}

variable "high_scores_noncurrent_version_expiration_days" {
  description = "Days to retain noncurrent versions of health objects before lifecycle expiration."
  type        = number
  default     = 90

  validation {
    condition     = var.high_scores_noncurrent_version_expiration_days >= 1 && var.high_scores_noncurrent_version_expiration_days <= 3650
    error_message = "high_scores_noncurrent_version_expiration_days must be between 1 and 3650."
  }
}

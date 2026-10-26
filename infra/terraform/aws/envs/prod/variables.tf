variable "environment" {
  description = "Short environment name used in resource names and tags."
  type        = string
  default     = "prod"
}

variable "aws_region" {
  description = "Region of the DressMe resources (Lambda, S3)."
  type        = string
  default     = "eu-north-1"
}

variable "aws_profile" {
  description = "Optional AWS shared-credentials profile for local use. Leave null in CI (use the default credential chain / OIDC)."
  type        = string
  default     = null
  nullable    = true
}

variable "site_domain_name" {
  description = "Custom domain attached to the CloudFront distribution."
  type        = string
  default     = "dressme.7oas7er.com"
}

variable "site_certificate_arn" {
  description = "ACM certificate in us-east-1 for the production hostname."
  type        = string
  default     = "arn:aws:acm:us-east-1:877710816497:certificate/5662db01-9020-4cc4-957a-91876b13e427"
}

variable "github_actions_subject" {
  description = "Immutable GitHub Actions OIDC subject for the production GitHub Environment (jobs with environment: production)."
  type        = string
  default     = "repo:7oas7er@2952810/dressme@1433682888:environment:production"
}

variable "origin_verify_secret" {
  description = "Shared secret Cloudflare injects as X-Origin-Verify for production; must match Cloudflare prod_origin_verify_secret."
  type        = string
  sensitive   = true
}

variable "origin_verify_secret_previous" {
  description = "Optional previous production origin-verify secret during rotation. See docs/origin-verify-secret-rotation.md."
  type        = string
  sensitive   = true
  default     = null
  nullable    = true
}

variable "cognito_owner_email" {
  description = "Email for the single production Cognito user (admin-created; stored lowercased). Set in gitignored terraform.tfvars when applying prod."
  type        = string
  default     = null
  nullable    = true
}

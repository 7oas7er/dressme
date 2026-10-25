variable "zone_id" {
  description = <<-EOT
    Cloudflare zone id for 7oas7er.com (dashboard Zone ID / GitHub CLOUDFLARE_ZONE_ID).
    Prefer this over data.cloudflare_zones: the list data source embeds deprecated
    plan/permissions fields that spam terraform plan warnings.
  EOT
  type        = string
  default     = "701810fff825f90c0eea671970a0cc9e"
}

variable "prod_cloudfront_domain_name" {
  description = "CloudFront domain name for production (dressme.7oas7er.com), such as d111111abcdef8.cloudfront.net."
  type        = string
}

variable "stg_cloudfront_domain_name" {
  description = "CloudFront domain name for staging (dressme-stg.7oas7er.com), such as d111111abcdef8.cloudfront.net."
  type        = string
}

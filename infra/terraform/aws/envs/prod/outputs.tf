output "github_deploy_role_arn" {
  description = "Store this in the GitHub Environment variable AWS_DEPLOY_ROLE_ARN on environment production."
  value       = module.site.github_deploy_role_arn
}

output "deploy_region" {
  description = "Store this in the GitHub Environment variable AWS_REGION on environment production."
  value       = var.aws_region
}

output "site_url" {
  description = "HTTPS URL for production."
  value       = module.site.site_url
}

output "bucket_name" {
  description = "Store this in the GitHub Environment variable AWS_SITE_BUCKET on environment production."
  value       = module.site.bucket_name
}

output "access_logs_bucket_name" {
  description = "Private bucket for production CloudFront and S3 site access logs."
  value       = module.site.access_logs_bucket_name
}

output "high_score_bucket_name" {
  description = "Private bucket that stores the production scaffold data bucket (health stub; Option A will add DynamoDB/media)."
  value       = module.site.high_score_bucket_name
}

output "distribution_id" {
  description = "Store this in the GitHub Environment variable AWS_DISTRIBUTION_ID on environment production."
  value       = module.site.distribution_id
}

output "distribution_domain_name" {
  description = "CloudFront domain name for the Cloudflare production CNAME."
  value       = module.site.distribution_domain_name
}

output "high_score_function_name" {
  description = "Lambda function that serves /api/health in production."
  value       = module.site.high_score_function_name
}

output "high_score_function_url" {
  description = "Function URL origin behind production CloudFront."
  value       = module.site.high_score_function_url
}

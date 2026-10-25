output "github_deploy_role_arn" {
  description = "Store this in the GitHub Environment variable AWS_DEPLOY_ROLE_ARN on environment staging."
  value       = module.site.github_deploy_role_arn
}

output "deploy_region" {
  description = "Store this in the GitHub Environment variable AWS_REGION on environment staging."
  value       = var.aws_region
}

output "site_url" {
  description = "HTTPS URL for staging."
  value       = module.site.site_url
}

output "bucket_name" {
  description = "Store this in the GitHub Environment variable AWS_SITE_BUCKET on environment staging."
  value       = module.site.bucket_name
}

output "access_logs_bucket_name" {
  description = "Private bucket for staging CloudFront and S3 site access logs."
  value       = module.site.access_logs_bucket_name
}

output "high_score_bucket_name" {
  description = "Private bucket that stores the staging scaffold data bucket (health stub; Option A will add DynamoDB/media)."
  value       = module.site.high_score_bucket_name
}

output "distribution_id" {
  description = "Store this in the GitHub Environment variable AWS_DISTRIBUTION_ID on environment staging."
  value       = module.site.distribution_id
}

output "distribution_domain_name" {
  description = "CloudFront domain name for the Cloudflare staging CNAME."
  value       = module.site.distribution_domain_name
}

output "high_score_function_name" {
  description = "Lambda function that serves /api/health in staging."
  value       = module.site.high_score_function_name
}

output "high_score_function_url" {
  description = "Function URL origin behind staging CloudFront."
  value       = module.site.high_score_function_url
}

output "github_oidc_provider_arn" {
  description = "Account-wide GitHub OIDC provider ARN (referenced by prod)."
  value       = data.aws_iam_openid_connect_provider.github.arn
}

output "github_terraform_plan_role_arn" {
  description = "Store this in the GitHub Environment variable AWS_TERRAFORM_PLAN_ROLE_ARN on environment terraform."
  value       = aws_iam_role.github_terraform_plan.arn
}

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

output "items_table_name" {
  description = "Staging DynamoDB wardrobe items table."
  value       = module.site.items_table_name
}

output "media_bucket_name" {
  description = "Staging private media bucket for wardrobe photos."
  value       = module.site.media_bucket_name
}

output "cognito_user_pool_id" {
  description = "Staging Cognito user pool id."
  value       = module.site.cognito_user_pool_id
}

output "cognito_client_id" {
  description = "Staging Cognito SPA client id."
  value       = module.site.cognito_client_id
}

output "cognito_auth_domain" {
  description = "Staging Cognito Hosted UI base URL."
  value       = module.site.cognito_auth_domain
}

output "cognito_owner_temporary_password" {
  description = "Temporary Cognito password when cognito_owner_email is set (sensitive)."
  value       = module.site.cognito_owner_temporary_password
  sensitive   = true
}

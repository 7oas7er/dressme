output "github_deploy_role_arn" {
  description = "IAM role assumed by GitHub Actions to publish this environment."
  value       = aws_iam_role.github_deploy.arn
}

output "site_url" {
  description = "HTTPS URL for this environment."
  value       = "https://${var.site_domain_name}"
}

output "bucket_name" {
  description = "Private bucket that stores the site files."
  value       = aws_s3_bucket.site.bucket
}

output "access_logs_bucket_name" {
  description = "Private bucket for CloudFront (v2) and S3 site access logs."
  value       = aws_s3_bucket.access_logs.bucket
}

output "high_score_bucket_name" {
  description = "Private bucket that stores the scaffold data bucket (health stub; Option A will add DynamoDB/media)."
  value       = aws_s3_bucket.high_scores.bucket
}

output "distribution_id" {
  description = "CloudFront distribution id."
  value       = aws_cloudfront_distribution.site.id
}

output "distribution_domain_name" {
  description = "CloudFront domain name, used by the Cloudflare CNAME."
  value       = aws_cloudfront_distribution.site.domain_name
}

output "high_score_function_name" {
  description = "Lambda function that serves /api/health (scaffold)."
  value       = aws_lambda_function.high_scores.function_name
}

output "high_score_function_url" {
  description = "Function URL origin behind CloudFront."
  value       = aws_lambda_function_url.high_scores.function_url
}

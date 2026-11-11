data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

module "site" {
  source = "../../modules/site"

  environment                   = var.environment
  site_domain_name              = var.site_domain_name
  site_certificate_arn          = var.site_certificate_arn
  github_oidc_provider_arn      = data.aws_iam_openid_connect_provider.github.arn
  github_actions_subject        = var.github_actions_subject
  origin_verify_secret          = var.origin_verify_secret
  origin_verify_secret_previous = var.origin_verify_secret_previous
  cognito_owner_email           = var.cognito_owner_email
  # Prod cutover parity with stg: Bedrock Suggest default; Analyze stays module
  # default Haiku (bedrock_model_id). Rollback Suggest = "random" + apply.
  suggest_engine = "bedrock"
  # Sonnet Suggest (active 4.6). Do not pin LEGACY sonnet-4-5-20250929.
  suggest_model_id = "eu.anthropic.claude-sonnet-4-6"
}

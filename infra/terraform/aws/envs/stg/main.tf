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
  # UC-04 cutover: pin Bedrock so later stg applies do not reset SUGGEST_ENGINE
  # to the module default ("random"). Rollback = "random" + apply.
  suggest_engine = "bedrock"
  # Suggest quality A/B: Sonnet on stg Suggest only; Analyze stays on module
  # default Haiku (bedrock_model_id). Rollback = "" or Haiku id + apply.
  # Sonnet 4.5 (20250929) is LEGACY on Bedrock and returns ResourceNotFound /
  # "not been actively using the model" → suggest_unavailable; use active 4.6.
  suggest_model_id = "eu.anthropic.claude-sonnet-4-6"
}

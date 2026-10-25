module "site" {
  source = "../../modules/site"

  environment                   = var.environment
  site_domain_name              = var.site_domain_name
  site_certificate_arn          = var.site_certificate_arn
  github_oidc_provider_arn      = data.aws_iam_openid_connect_provider.github.arn
  github_actions_subject        = var.github_actions_subject
  origin_verify_secret          = var.origin_verify_secret
  origin_verify_secret_previous = var.origin_verify_secret_previous
}

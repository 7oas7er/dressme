resource "aws_cognito_user_pool" "app" {
  name = local.cognito_user_pool_name

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # Single-user personal app: software MFA optional (user can enroll in Hosted UI).
  mfa_configuration = "OPTIONAL"

  software_token_mfa_configuration {
    enabled = true
  }

  tags = {
    Name = local.cognito_user_pool_name
  }
}

resource "aws_cognito_user_pool_client" "spa" {
  name         = local.cognito_client_name
  user_pool_id = aws_cognito_user_pool.app.id

  generate_secret                               = false
  prevent_user_existence_errors                 = "ENABLED"
  enable_token_revocation                       = true
  enable_propagate_additional_user_context_data = false

  explicit_auth_flows = [
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_SRP_AUTH",
  ]

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]

  callback_urls = [
    "https://${var.site_domain_name}/",
    "https://${var.site_domain_name}/index.html",
    "http://127.0.0.1:4173/",
    "http://localhost:4173/",
    "http://127.0.0.1:5173/",
    "http://localhost:5173/",
  ]
  logout_urls = [
    "https://${var.site_domain_name}/",
    "https://${var.site_domain_name}/index.html",
    "http://127.0.0.1:4173/",
    "http://localhost:4173/",
    "http://127.0.0.1:5173/",
    "http://localhost:5173/",
  ]

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_pool_domain" "app" {
  domain       = local.cognito_domain_prefix
  user_pool_id = aws_cognito_user_pool.app.id
}

resource "random_password" "cognito_owner_temp" {
  count = var.cognito_owner_email == null ? 0 : 1

  length           = 20
  special          = true
  override_special = "!@#%^*-_"
  min_lower        = 1
  min_upper        = 1
  min_numeric      = 1
  min_special      = 1
}

resource "aws_cognito_user" "owner" {
  count = var.cognito_owner_email == null ? 0 : 1

  user_pool_id       = aws_cognito_user_pool.app.id
  username           = var.cognito_owner_email
  temporary_password = random_password.cognito_owner_temp[0].result

  attributes = {
    email          = var.cognito_owner_email
    email_verified = "true"
  }

  message_action = "SUPPRESS"

  lifecycle {
    ignore_changes = [
      password,
      temporary_password,
      attributes["email_verified"],
    ]
  }
}

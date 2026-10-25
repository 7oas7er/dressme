# Account-wide GitHub Actions OIDC provider. IAM allows only one provider per
# URL per account — Block Drop (or another app) may already own it. Look it up;
# do not create a second one.
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

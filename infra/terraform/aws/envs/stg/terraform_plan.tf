# Read-mostly IAM role for GitHub Actions `terraform plan` (not apply).
# Trusts the GitHub Environment "terraform" OIDC subject.

locals {
  terraform_plan_role_name   = "shared-dressme-terraform-plan-role"
  terraform_plan_policy_name = "shared-dressme-terraform-plan-policy"
  terraform_state_bucket     = "shared-dressme-terraform-state-bucket"
}

data "aws_iam_policy_document" "github_terraform_plan_assume_role" {
  statement {
    actions = [
      "sts:AssumeRoleWithWebIdentity",
      "sts:TagSession",
    ]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [var.github_actions_plan_subject]
    }
  }
}

data "aws_iam_policy_document" "github_terraform_plan" {
  statement {
    sid = "TerraformStateList"
    actions = [
      "s3:ListBucket",
      "s3:GetBucketVersioning",
      "s3:GetBucketLocation",
    ]
    resources = ["arn:aws:s3:::${local.terraform_state_bucket}"]
  }

  statement {
    sid = "TerraformStateObjectsAndLocks"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["arn:aws:s3:::${local.terraform_state_bucket}/*"]
  }
}

resource "aws_iam_role" "github_terraform_plan" {
  name               = local.terraform_plan_role_name
  description        = "GitHub Actions assumes this role for terraform plan (read-only AWS + state locks)."
  assume_role_policy = data.aws_iam_policy_document.github_terraform_plan_assume_role.json

  tags = {
    Name = local.terraform_plan_role_name
  }
}

resource "aws_iam_role_policy" "github_terraform_plan" {
  name   = local.terraform_plan_policy_name
  role   = aws_iam_role.github_terraform_plan.id
  policy = data.aws_iam_policy_document.github_terraform_plan.json
}

resource "aws_iam_role_policy_attachment" "github_terraform_plan_readonly" {
  role       = aws_iam_role.github_terraform_plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

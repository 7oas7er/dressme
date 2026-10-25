resource "aws_iam_role" "github_deploy" {
  name               = local.github_deploy_role_name
  description        = "GitHub Actions publishes DressMe (${var.environment}) and invalidates CloudFront."
  assume_role_policy = data.aws_iam_policy_document.github_deploy_assume_role.json

  tags = {
    Name = local.github_deploy_role_name
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = local.github_deploy_policy_name
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy.json
}

resource "aws_iam_role" "high_scores" {
  name               = local.high_scores_role_name
  assume_role_policy = data.aws_iam_policy_document.high_scores_assume_role.json

  tags = {
    Name = local.high_scores_role_name
  }
}

resource "aws_iam_role_policy_attachment" "high_scores_basic" {
  role       = aws_iam_role.high_scores.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "high_scores" {
  name   = local.high_scores_policy_name
  role   = aws_iam_role.high_scores.id
  policy = data.aws_iam_policy_document.high_scores.json
}

# Cold wardrobe backup bucket (weekly inventory + Dynamo dump + media sync).
# Outside the live media bucket so a media wipe does not erase the cold copy.
# Operator scripts: scripts/wardrobe-backup.sh — see docs/runbook.md.

resource "aws_s3_bucket" "backup" {
  bucket = local.backup_bucket_name

  tags = {
    Name = local.backup_bucket_name
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_ownership_controls" "backup" {
  bucket = aws_s3_bucket.backup.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "backup" {
  bucket = aws_s3_bucket.backup.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backup" {
  bucket = aws_s3_bucket.backup.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "backup" {
  bucket = aws_s3_bucket.backup.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "backup" {
  bucket = aws_s3_bucket.backup.id

  depends_on = [aws_s3_bucket_versioning.backup]

  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  # Concept §3: keep roughly last 4 weekly packages.
  rule {
    id     = "expire-weekly-packages"
    status = "Enabled"

    filter {
      prefix = "weekly/"
    }

    expiration {
      days = 35
    }

    noncurrent_version_expiration {
      noncurrent_days = 7
    }
  }

  # Concept §3: keep ~1 year of monthly snapshots (script also writes monthly/).
  rule {
    id     = "expire-monthly-packages"
    status = "Enabled"

    filter {
      prefix = "monthly/"
    }

    expiration {
      days = 400
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

resource "aws_s3_bucket_policy" "backup" {
  bucket = aws_s3_bucket.backup.id
  policy = data.aws_iam_policy_document.backup_bucket.json
}

data "aws_iam_policy_document" "backup_bucket" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.backup.arn,
      "${aws_s3_bucket.backup.arn}/*",
    ]

    principals {
      type        = "AWS"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

# Least-privilege policy for local weekly backup / restore-diff scripts.
# Attach to the operator IAM user/role (or rely on admin profile 7oas7er — same as PITR ops).
# Not attached to Lambda or GitHub deploy.
resource "aws_iam_policy" "wardrobe_backup" {
  name        = local.wardrobe_backup_policy_name
  description = "DressMe (${var.environment}) wardrobe cold backup: read live table/media, write backup bucket."
  policy      = data.aws_iam_policy_document.wardrobe_backup.json

  tags = {
    Name = local.wardrobe_backup_policy_name
  }
}

data "aws_iam_policy_document" "wardrobe_backup" {
  statement {
    sid = "DescribeItemsTable"
    actions = [
      "dynamodb:DescribeTable",
      "dynamodb:DescribeContinuousBackups",
    ]
    resources = [aws_dynamodb_table.items.arn]
  }

  statement {
    sid = "ScanItemsTable"
    actions = [
      "dynamodb:Scan",
      "dynamodb:Query",
      "dynamodb:GetItem",
    ]
    resources = [aws_dynamodb_table.items.arn]
  }

  statement {
    sid = "ListMediaBucket"
    actions = [
      "s3:GetBucketLocation",
      "s3:ListBucket",
      "s3:ListBucketVersions",
    ]
    resources = [aws_s3_bucket.media.arn]
  }

  statement {
    sid = "ReadMediaObjects"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
    ]
    resources = ["${aws_s3_bucket.media.arn}/*"]
  }

  statement {
    sid = "ListBackupBucket"
    actions = [
      "s3:GetBucketLocation",
      "s3:ListBucket",
      "s3:ListBucketVersions",
    ]
    resources = [aws_s3_bucket.backup.arn]
  }

  statement {
    sid = "WriteBackupObjects"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:AbortMultipartUpload",
    ]
    resources = ["${aws_s3_bucket.backup.arn}/*"]
  }
}

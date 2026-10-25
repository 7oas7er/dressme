# Private access-log bucket for CloudFront (v2 / CloudWatch delivery) and S3 site logs.
# CloudWatch delivery APIs for CloudFront must be called in us-east-1; the S3 bucket stays in eu-north-1.

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "access_logs" {
  bucket = local.access_logs_bucket_name

  tags = {
    Name = local.access_logs_bucket_name
  }
}

resource "aws_s3_bucket_ownership_controls" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id

  rule {
    id     = "expire-access-logs"
    status = "Enabled"

    filter {}

    expiration {
      days = var.access_logs_retention_days
    }
  }

  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

data "aws_iam_policy_document" "access_logs" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.access_logs.arn,
      "${aws_s3_bucket.access_logs.arn}/*",
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

  statement {
    sid = "AWSLogDeliveryWrite"
    actions = [
      "s3:PutObject",
    ]
    resources = ["${aws_s3_bucket.access_logs.arn}/cloudfront/*"]

    principals {
      type        = "Service"
      identifiers = ["delivery.logs.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:logs:us-east-1:${data.aws_caller_identity.current.account_id}:delivery-source:${local.cloudfront_log_delivery_name}"]
    }
  }

  statement {
    sid = "AWSLogDeliveryAclCheck"
    actions = [
      "s3:GetBucketAcl",
      "s3:ListBucket",
    ]
    resources = [aws_s3_bucket.access_logs.arn]

    principals {
      type        = "Service"
      identifiers = ["delivery.logs.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }

  statement {
    sid = "S3ServerAccessLogsWrite"
    actions = [
      "s3:PutObject",
    ]
    resources = ["${aws_s3_bucket.access_logs.arn}/s3-site/*"]

    principals {
      type        = "Service"
      identifiers = ["logging.s3.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = [aws_s3_bucket.site.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id
  policy = data.aws_iam_policy_document.access_logs.json
}

resource "aws_s3_bucket_logging" "site" {
  bucket = aws_s3_bucket.site.id

  target_bucket = aws_s3_bucket.access_logs.id
  target_prefix = "s3-site/"

  depends_on = [aws_s3_bucket_policy.access_logs]
}

# CloudFront standard logging (v2) — delivery APIs are us-east-1 even when the S3 destination is eu-north-1.
resource "aws_cloudwatch_log_delivery_source" "cloudfront" {
  region = "us-east-1"

  name         = local.cloudfront_log_delivery_name
  log_type     = "ACCESS_LOGS"
  resource_arn = aws_cloudfront_distribution.site.arn
}

resource "aws_cloudwatch_log_delivery_destination" "cloudfront" {
  region = "us-east-1"

  name          = local.cloudfront_log_delivery_name
  output_format = "json"

  delivery_destination_configuration {
    # Prefix keeps CloudFront logs under cloudfront/ and avoids destination ARN drift.
    destination_resource_arn = "${aws_s3_bucket.access_logs.arn}/cloudfront"
  }
}

resource "aws_cloudwatch_log_delivery" "cloudfront" {
  region = "us-east-1"

  delivery_source_name     = aws_cloudwatch_log_delivery_source.cloudfront.name
  delivery_destination_arn = aws_cloudwatch_log_delivery_destination.cloudfront.arn

  s3_delivery_configuration {
    enable_hive_compatible_path = false
    suffix_path                 = "{DistributionId}/{yyyy}/{MM}/{dd}"
  }

  depends_on = [aws_s3_bucket_policy.access_logs]
}

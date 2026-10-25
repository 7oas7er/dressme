resource "aws_s3_bucket" "site" {
  bucket = local.site_bucket_name

  tags = {
    Name = local.site_bucket_name
  }
}

resource "aws_s3_bucket_ownership_controls" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket = aws_s3_bucket.site.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = data.aws_iam_policy_document.site_bucket.json
}

resource "aws_s3_bucket" "high_scores" {
  bucket        = local.high_scores_bucket_name
  force_destroy = false

  tags = {
    Name = local.high_scores_bucket_name
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_ownership_controls" "high_scores" {
  bucket = aws_s3_bucket.high_scores.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "high_scores" {
  bucket = aws_s3_bucket.high_scores.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "high_scores" {
  bucket = aws_s3_bucket.high_scores.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Versioning recovers health.json after a bad write; site bucket stays unversioned (git is source of truth).
resource "aws_s3_bucket_versioning" "high_scores" {
  bucket = aws_s3_bucket.high_scores.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "high_scores" {
  bucket = aws_s3_bucket.high_scores.id

  depends_on = [aws_s3_bucket_versioning.high_scores]

  rule {
    id     = "expire-noncurrent-health"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = var.high_scores_noncurrent_version_expiration_days
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

  # Burned single-use play tickets; secret + health.json are outside this prefix.
  rule {
    id     = "expire-used-score-tickets"
    status = "Enabled"

    filter {
      prefix = local.score_tickets_prefix
    }

    expiration {
      days = 2
    }
  }
}

resource "aws_s3_bucket_policy" "high_scores" {
  bucket = aws_s3_bucket.high_scores.id
  policy = data.aws_iam_policy_document.high_scores_bucket.json
}

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = local.site_oac_name
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_origin_access_control" "high_scores" {
  name                              = local.high_scores_oac_name
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_function" "origin_verify" {
  name    = local.origin_verify_function_name
  runtime = "cloudfront-js-2.0"
  publish = true
  code = templatefile("${path.module}/origin_verify.js.tftpl", {
    # Dual-accept during rotation: current + optional previous (see docs/origin-verify-secret-rotation.md).
    origin_verify_secrets = compact([
      var.origin_verify_secret,
      var.origin_verify_secret_previous,
    ])
  })
}

# Strip AWS fingerprinting headers on /api/health (Strix M2). Policy remove_headers
# cannot delete X-Amzn-RequestId / X-Amzn-ErrorType; this viewer-response can.
resource "aws_cloudfront_function" "strip_aws_headers" {
  name    = local.strip_aws_headers_function_name
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = file("${path.module}/strip_aws_headers.js.tftpl")
}

# Custom policy: managed SecurityHeadersPolicy equivalents + CSP + Permissions-Policy.
# Header ownership: docs/security-headers.md (CloudFront SoT; Cloudflare does not duplicate these).
resource "aws_cloudfront_response_headers_policy" "site" {
  name    = local.site_response_headers_policy_name
  comment = "DressMe security headers including Content-Security-Policy"

  custom_headers_config {
    items {
      header   = "permissions-policy"
      override = true
      value    = local.permissions_policy
    }

    items {
      header   = "cross-origin-opener-policy"
      override = true
      value    = "same-origin"
    }

    items {
      header   = "cross-origin-resource-policy"
      override = true
      value    = "same-origin"
    }
  }

  # x-amzn-trace-id is removable here; requestid/errortype are not (AWS deny list).
  # x-xss-protection: omit from security_headers_config alone does not strip a
  # value added earlier in the path (or by edge defaults) — remove explicitly.
  remove_headers_config {
    items {
      header = "x-amzn-trace-id"
    }

    items {
      header = "x-xss-protection"
    }
  }

  security_headers_config {
    content_security_policy {
      content_security_policy = local.content_security_policy
      override                = true
    }

    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "SAMEORIGIN"
      override     = true
    }

    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }

    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      # Preload applies to this host's subtree (e.g. *.dressme…), not the apex zone.
      preload  = true
      override = true
    }

    # Intentionally omit xss_protection — legacy X-XSS-Protection is ignored by
    # modern browsers (Strix L1); do not emit 0/1 via this block.
  }
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = local.site_distribution_name
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  http_version        = "http2and3"
  aliases             = [var.site_domain_name]

  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = local.site_origin_id
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  origin {
    domain_name              = local.lambda_function_url_hostname
    origin_id                = local.high_scores_origin_id
    origin_access_control_id = aws_cloudfront_origin_access_control.high_scores.id

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id           = local.site_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = local.cache_policy_caching_optimized
    response_headers_policy_id = aws_cloudfront_response_headers_policy.site.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.origin_verify.arn
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/api/health"
    target_origin_id           = local.high_scores_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = local.cache_policy_caching_disabled
    origin_request_policy_id   = local.origin_request_all_viewer_except_host
    response_headers_policy_id = aws_cloudfront_response_headers_policy.site.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.origin_verify.arn
    }

    function_association {
      event_type   = "viewer-response"
      function_arn = aws_cloudfront_function.strip_aws_headers.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = var.site_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.3_2025"
  }

  tags = {
    Name = local.site_distribution_name
  }
}

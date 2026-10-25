locals {
  zone_id = var.zone_id
}

# App hosts only — do not manage zone apex / www (other apps share 7oas7er.com).
resource "cloudflare_dns_record" "dressme" {
  zone_id = local.zone_id
  name    = "dressme.7oas7er.com"
  type    = "CNAME"
  content = var.prod_cloudfront_domain_name
  proxied = true
  ttl     = 1
}

resource "cloudflare_dns_record" "dressme_stg" {
  zone_id = local.zone_id
  name    = "dressme-stg.7oas7er.com"
  type    = "CNAME"
  content = var.stg_cloudfront_domain_name
  proxied = true
  ttl     = 1
}

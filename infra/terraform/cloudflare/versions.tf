terraform {
  # use_lockfile (S3 native state locking) requires Terraform 1.10+.
  required_version = ">= 1.10.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket       = "shared-dressme-terraform-state-bucket"
    key          = "cloudflare/terraform.tfstate"
    region       = "eu-north-1"
    use_lockfile = true
    encrypt      = true
    # No profile: local use AWS_PROFILE=7oas7er; CI uses OIDC default chain.
  }
}

provider "cloudflare" {
  # The provider reads the API token from CLOUDFLARE_API_TOKEN.
}

terraform {
  # use_lockfile (S3 native state locking) requires Terraform 1.10+.
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.69"
    }
    grafana = {
      source  = "grafana/grafana"
      version = "~> 4.0"
    }
    time = {
      source  = "hashicorp/time"
      version = "~> 0.13"
    }
  }

  backend "s3" {
    bucket       = "shared-dressme-terraform-state-bucket"
    key          = "grafana/terraform.tfstate"
    region       = "eu-north-1"
    use_lockfile = true
    encrypt      = true
    # No profile: local use AWS_PROFILE=7oas7er; CI uses OIDC default chain.
  }
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile

  default_tags {
    tags = {
      Environment = "shared"
      Project     = "dressme"
    }
  }
}

# Portal / stack lookup (no Cloud Provider URL required yet).
provider "grafana" {
  alias                     = "cloud"
  cloud_access_policy_token = var.cloud_access_policy_token
}

# Cloud Provider Observability API — URL must match the stack cluster
# (often differs from region_slug; take it from the stack data source).
provider "grafana" {
  alias                       = "cloud_provider"
  cloud_access_policy_token   = var.cloud_access_policy_token
  cloud_provider_url          = data.grafana_cloud_stack.dressme.cloud_provider_url
  cloud_provider_access_token = var.cloud_provider_access_token
}

# Synthetic Monitoring checks — prefer stack sm_url when not overridden.
provider "grafana" {
  alias           = "sm"
  sm_url          = coalesce(var.sm_url, data.grafana_cloud_stack.dressme.sm_url)
  sm_access_token = var.sm_access_token
}

# Grafana instance (dashboards, folders). Auth is the stack service account token.
provider "grafana" {
  alias = "stack"
  url   = data.grafana_cloud_stack.dressme.url
  auth  = grafana_cloud_stack_service_account_token.terraform.key
}

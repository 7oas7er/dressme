terraform {
  # use_lockfile (S3 native state locking) requires Terraform 1.10+.
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.100.0, < 7.0.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }

  backend "s3" {
    bucket       = "shared-dressme-terraform-state-bucket"
    key          = "envs/stg/terraform.tfstate"
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
      Environment = var.environment
      Project     = "dressme"
    }
  }
}

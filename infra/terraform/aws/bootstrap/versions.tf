terraform {
  # use_lockfile (S3 native state locking) requires Terraform 1.10+.
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.100.0, < 7.0.0"
    }
  }

  # Local backend on purpose: this root *creates* the S3 state bucket used by
  # every other root. An S3 backend here cannot init until that bucket exists,
  # and `terraform init -backend=false` still blocks plan/apply on modern TF.
  # Keep bootstrap state on the operator machine (gitignored); rarely changes.
  backend "local" {
    path = "terraform.tfstate"
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

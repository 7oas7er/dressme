variable "aws_region" {
  description = "Region for the Terraform state bucket."
  type        = string
  default     = "eu-north-1"
}

variable "aws_profile" {
  description = "Optional AWS shared-credentials profile for local use. Leave null in CI (use the default credential chain / OIDC)."
  type        = string
  default     = null
  nullable    = true
}

variable "state_bucket_name" {
  description = "S3 bucket that stores remote Terraform state."
  type        = string
  default     = "shared-dressme-terraform-state-bucket"
}

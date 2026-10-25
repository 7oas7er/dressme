# Service account for managing dashboards / folders inside the Grafana stack.
# Requires cloud_access_policy_token scopes: stacks:read, stack-service-accounts:write.
resource "grafana_cloud_stack_service_account" "terraform" {
  provider = grafana.cloud

  stack_slug  = var.stack_slug
  name        = "dressme-terraform"
  role        = "Admin"
  is_disabled = false
}

resource "grafana_cloud_stack_service_account_token" "terraform" {
  provider = grafana.cloud

  stack_slug         = var.stack_slug
  name               = "dressme-terraform"
  service_account_id = grafana_cloud_stack_service_account.terraform.id
}

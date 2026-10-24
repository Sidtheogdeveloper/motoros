terraform {
  required_version = ">= 1.13.0, < 2.0.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.7" }
  }
}
provider "aws" { region = var.region }
variable "region" { type = string }
variable "name" { type = string }
variable "domain_prefix" { type = string }
variable "app_origin" {
  type = string
  validation {
    condition     = can(regex("^https://[A-Za-z0-9.-]+(:[0-9]+)?$", var.app_origin))
    error_message = "Use the application's exact HTTPS origin without a trailing slash."
  }
}
resource "aws_cognito_user_pool" "motoros" {
  name                     = var.name
  deletion_protection      = "ACTIVE"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  username_configuration { case_sensitive = false }
  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 1
  }
  verification_message_template { default_email_option = "CONFIRM_WITH_CODE" }
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
  user_attribute_update_settings { attributes_require_verification_before_update = ["email"] }
  lifecycle { prevent_destroy = true }
}
resource "aws_cognito_resource_server" "motoros" {
  identifier   = "motoros"
  name         = "MotorOS services"
  user_pool_id = aws_cognito_user_pool.motoros.id
  scope {
    scope_name        = "api"
    scope_description = "Authenticated user APIs"
  }
  scope {
    scope_name        = "internal"
    scope_description = "Authenticated service delegation with verified user token"
  }
}
resource "aws_cognito_user_pool_domain" "motoros" {
  domain                = var.domain_prefix
  user_pool_id          = aws_cognito_user_pool.motoros.id
  managed_login_version = 1
}
resource "aws_cognito_user_pool_client" "bff" {
  name                                 = "motoros-bff"
  user_pool_id                         = aws_cognito_user_pool.motoros.id
  generate_secret                      = true
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile", "motoros/api"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = ["${var.app_origin}/api/auth/callback"]
  logout_urls                          = ["${var.app_origin}/login"]
  default_redirect_uri                 = "${var.app_origin}/api/auth/callback"
  explicit_auth_flows                  = []
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  access_token_validity                = 5
  id_token_validity                    = 5
  refresh_token_validity               = 8
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "hours"
  }
  refresh_token_rotation {
    feature                    = "ENABLED"
    retry_grace_period_seconds = 0
  }
  read_attributes  = ["email", "email_verified", "name"]
  write_attributes = ["email", "name"]
  depends_on       = [aws_cognito_resource_server.motoros]
}
resource "aws_cognito_user_pool_client" "services" {
  for_each                             = toset(["customer", "workorder"])
  name                                 = "motoros-${each.key}"
  user_pool_id                         = aws_cognito_user_pool.motoros.id
  generate_secret                      = true
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["client_credentials"]
  allowed_oauth_scopes                 = ["motoros/internal"]
  explicit_auth_flows                  = []
  prevent_user_existence_errors        = "ENABLED"
  access_token_validity                = 5
  token_validity_units { access_token = "minutes" }
  depends_on = [aws_cognito_resource_server.motoros]
}
output "issuer" { value = aws_cognito_user_pool.motoros.endpoint }
output "pool_id" { value = aws_cognito_user_pool.motoros.id }
output "bff_client_id" { value = aws_cognito_user_pool_client.bff.id }
output "service_client_ids" { value = { for name, client in aws_cognito_user_pool_client.services : name => client.id } }
# No secret outputs. App-client secrets and state must stay in an encrypted, access-controlled deployment pipeline.

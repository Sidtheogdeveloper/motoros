mock_provider "aws" {
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  mock_data "aws_availability_zones" {
    defaults = { names = ["ap-south-1a", "ap-south-1b"] }
  }
}
variables {
  account_id       = "000000000001" # Synthetic test identity, never a deployment default.
  environment      = "staging"
  app_origin       = "https://staging.example.test"
  certificate_arn  = "arn:aws:acm:ap-south-1:000000000001:certificate/00000000-0000-0000-0000-000000000001"
  owner            = "test"
  cost_center      = "test"
  alert_email      = "alerts@example.test"
  smtp_host        = "email-smtp.ap-south-1.amazonaws.com"
  mail_from        = "verified@example.test"
  postgres_version = "17.6"
  monthly_budget   = 1
}
run "private_and_encrypted_defaults" {
  command = plan
  assert {
    condition     = !aws_db_instance.main.publicly_accessible && aws_db_instance.main.storage_encrypted && aws_db_instance.main.deletion_protection
    error_message = "Database must be private, encrypted and protected."
  }
  assert {
    condition     = aws_elasticache_replication_group.sessions.transit_encryption_enabled && aws_elasticache_replication_group.sessions.at_rest_encryption_enabled
    error_message = "Session cache encryption is mandatory."
  }
  assert {
    condition     = aws_s3_bucket_public_access_block.private.block_public_policy && aws_s3_bucket_public_access_block.private.restrict_public_buckets
    error_message = "Private objects must not become public."
  }
  assert {
    condition     = length(aws_subnet.app) == 2 && length(aws_nat_gateway.main) == 1 && length(local.services) == 9 && length(aws_ecs_service.app) == 0
    error_message = "Staging must retain two AZs and one NAT, with no placeholder application rollout."
  }
}
run "reject_http_origin" {
  command = plan
  variables { app_origin = "http://example.test" }
  expect_failures = [var.app_origin]
}
run "reject_mutable_images" {
  command = plan
  variables { image_digests = { tenant = "example.test/tenant:latest" } }
  expect_failures = [var.image_digests]
}
run "production_redundancy" {
  command = plan
  variables { production = true }
  assert {
    condition     = aws_db_instance.main.multi_az && aws_elasticache_replication_group.sessions.automatic_failover_enabled && length(aws_nat_gateway.main) == 2
    error_message = "Production must prepare multi-AZ data, cache and egress."
  }
}

run "reject_wildcard_identity_trust" {
  command = plan
  variables { github_repository = "*/motoros" }
  expect_failures = [var.github_repository]
}
run "reject_operator_mutable_image" {
  command = plan
  variables { operator_image = "example.test/operator:latest" }
  expect_failures = [var.operator_image]
}
run "reject_undersized_task" {
  command = plan
  variables { service_sizes = { tenant = { cpu = 256, memory = 512 } } }
  expect_failures = [var.service_sizes]
}
run "workload_security_contract" {
  command = plan
  variables { image_digests = { for n in ["tenant", "customer", "workorder", "booking", "inventory", "billing", "notification", "analytics", "api-bff"] : n => "000000000001.dkr.ecr.ap-south-1.amazonaws.com/motoros-staging/${n}@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } }
  assert {
    condition     = !aws_ecs_service.app["tenant"].network_configuration[0].assign_public_ip
    error_message = "Application tasks cannot receive public addresses."
  }
  assert {
    condition     = local.containers["tenant"][0].readonlyRootFilesystem && local.containers["tenant"][0].user == "1000:1000" && local.containers["tenant"][0].healthCheck.retries == 3 && local.containers["tenant"][0].logConfiguration.logDriver == "awslogs"
    error_message = "Every task needs non-root read-only runtime, health probes and managed logging."
  }
  assert {
    condition     = local.containers["tenant"][0].cpu == 256 && local.containers["tenant"][0].memory == 896
    error_message = "The 0.5 vCPU/1 GiB task must reserve capacity for Service Connect."
  }
}

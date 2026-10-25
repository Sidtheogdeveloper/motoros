terraform {

  required_version = "= 1.13.5"
  required_providers {
    aws = {
      source = "hashicorp/aws", version = "~> 6.7"
    }

  }


}

variable "region" {
  type = string
}

variable "account_id" {
  type = string
}

variable "bucket_name" {
  type = string
}

variable "state_role_arns" {
  type = set(string)
}

provider "aws" {

  region              = var.region
  allowed_account_ids = [var.account_id]

}

resource "aws_kms_key" "state" {
  policy = data.aws_iam_policy_document.key.json

  enable_key_rotation = true
}

resource "aws_s3_bucket" "state" {
  # checkov:skip=CKV_AWS_144:Cross-region state replication requires a separately approved recovery region; versioning is mandatory


  bucket = var.bucket_name
  lifecycle {
    prevent_destroy = true
  }


}

resource "aws_s3_bucket_versioning" "state" {

  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }


}

resource "aws_s3_bucket_public_access_block" "state" {

  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true

}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {

  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.state.arn
    }

  }


}

data "aws_iam_policy_document" "state" {

  statement {

    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }


  }

  statement {

    effect    = "Deny"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.state.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "ArnNotEquals"
      variable = "aws:PrincipalArn"
      values   = var.state_role_arns
    }


  }


}

resource "aws_s3_bucket_policy" "state" {

  bucket = aws_s3_bucket.state.id
  policy = data.aws_iam_policy_document.state.json

}

output "bucket" {
  value = aws_s3_bucket.state.id
}

output "kms_key_arn" {
  value = aws_kms_key.state.arn
}


data "aws_iam_policy_document" "key" {
  # checkov:skip=CKV_AWS_109:KMS key resource policy account administration; Resource star means this key
  # checkov:skip=CKV_AWS_111:KMS resource policy is restricted to this containing key
  # checkov:skip=CKV_AWS_356:KMS key policies require Resource star for this key
  statement {
    sid       = "AccountAdministration"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${var.account_id}:root"]
    }
  }
}
resource "aws_s3_bucket" "audit" {
  # checkov:skip=CKV_AWS_145:Server-access log destination requires SSE-S3; state objects use KMS

  # checkov:skip=CKV_AWS_18:Dedicated server-access log destination; recursive logging is intentionally disabled
  # checkov:skip=CKV_AWS_144:Second-region replication requires a separately approved DR budget
  bucket_prefix = "motoros-state-access-"
  lifecycle { prevent_destroy = true }
}
resource "aws_s3_bucket_public_access_block" "audit" {
  bucket                  = aws_s3_bucket.audit.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_versioning" "audit" {
  bucket = aws_s3_bucket.audit.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "audit" {
  # checkov:skip=CKV_AWS_145:AWS S3 server-access log delivery requires SSE-S3; state objects themselves use KMS
  bucket = aws_s3_bucket.audit.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_bucket_logging" "state" {
  bucket        = aws_s3_bucket.state.id
  target_bucket = aws_s3_bucket.audit.id
  target_prefix = "state-access/"
}
resource "aws_s3_bucket_lifecycle_configuration" "state" {
  for_each = { state = aws_s3_bucket.state.id, audit = aws_s3_bucket.audit.id }
  bucket   = each.value
  rule {
    id     = "abort-incomplete"
    status = "Enabled"
    filter { prefix = "" }
    abort_incomplete_multipart_upload { days_after_initiation = 7 }
  }
}
resource "aws_s3_bucket_notification" "state" {
  for_each    = { state = aws_s3_bucket.state.id, audit = aws_s3_bucket.audit.id }
  bucket      = each.value
  eventbridge = true
}
data "aws_iam_policy_document" "audit" {
  statement {
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.audit.arn}/state-access/*"]
    principals {
      type        = "Service"
      identifiers = ["logging.s3.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_s3_bucket.state.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [var.account_id]
    }
  }
  statement {
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.audit.arn, "${aws_s3_bucket.audit.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}
resource "aws_s3_bucket_policy" "audit" {
  bucket = aws_s3_bucket.audit.id
  policy = data.aws_iam_policy_document.audit.json
}

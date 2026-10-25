terraform {
  required_version = ">= 1.9.0"
  required_providers { aws = { source = "hashicorp/aws", version = "~> 6.0" } }
}

variable "account_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "Use the deployment account ID."
  }
}
variable "prefix" {
  type    = string
  default = "motoros"
}
variable "kms_key_arn" { type = string }
variable "alarm_actions" {
  type    = list(string)
  default = []
}
variable "oldest_message_alarm_seconds" {
  type    = number
  default = 300
}

locals {
  producers = toset(["tenant", "customer", "booking", "workorder", "inventory", "billing", "notification"])
  consumers = {
    notification       = ["tenant", "customer", "booking", "workorder", "inventory", "billing", "notification"]
    analytics          = ["tenant", "customer", "booking", "workorder", "inventory", "billing", "notification"]
    workorder-approval = ["billing"]
  }
  subscriptions = { for item in flatten([for consumer, producers in local.consumers : [for producer in producers : { consumer = consumer, producer = producer }]]) : "${item.consumer}-${item.producer}" => item }
}

resource "aws_sns_topic" "events" {
  for_each          = local.producers
  name              = "${var.prefix}-${each.key}-v1"
  kms_master_key_id = var.kms_key_arn
}

resource "aws_sqs_queue" "dead_letter" {
  for_each                  = local.consumers
  name                      = "${var.prefix}-${each.key}-dlq-v1"
  message_retention_seconds = 1209600
  kms_master_key_id         = var.kms_key_arn
}

resource "aws_sqs_queue" "consumer" {
  for_each                   = local.consumers
  name                       = "${var.prefix}-${each.key}-v1"
  visibility_timeout_seconds = 60
  receive_wait_time_seconds  = 20
  message_retention_seconds  = 345600
  kms_master_key_id          = var.kms_key_arn
  redrive_policy             = jsonencode({ deadLetterTargetArn = aws_sqs_queue.dead_letter[each.key].arn, maxReceiveCount = 5 })
}

# Only the exact producer topics may deliver to this consumer queue.
resource "aws_sqs_queue_policy" "subscription" {
  for_each  = local.consumers
  queue_url = aws_sqs_queue.consumer[each.key].url
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "ExpectedTopicsOnly", Effect = "Allow", Principal = { Service = "sns.amazonaws.com" }, Action = "sqs:SendMessage", Resource = aws_sqs_queue.consumer[each.key].arn,
      Condition = { ArnEquals = { "aws:SourceArn" = [for producer in each.value : aws_sns_topic.events[producer].arn] }, StringEquals = { "aws:SourceAccount" = var.account_id } } },
      { Sid = "RequireTLS", Effect = "Deny", Principal = "*", Action = "sqs:*", Resource = aws_sqs_queue.consumer[each.key].arn, Condition = { Bool = { "aws:SecureTransport" = "false" } } }
    ]
  })
}

resource "aws_sns_topic_subscription" "consumer" {
  for_each             = local.subscriptions
  topic_arn            = aws_sns_topic.events[each.value.producer].arn
  protocol             = "sqs"
  endpoint             = aws_sqs_queue.consumer[each.value.consumer].arn
  raw_message_delivery = false
  depends_on           = [aws_sqs_queue_policy.subscription]
}

resource "aws_cloudwatch_metric_alarm" "dead_letter" {
  for_each            = local.consumers
  alarm_name          = "${var.prefix}-${each.key}-dead-letter-backlog"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.dead_letter[each.key].name }
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "queue_age" {
  for_each            = local.consumers
  alarm_name          = "${var.prefix}-${each.key}-oldest-message"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  dimensions          = { QueueName = aws_sqs_queue.consumer[each.key].name }
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.oldest_message_alarm_seconds
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.alarm_actions
}

output "topic_arns" { value = { for key, topic in aws_sns_topic.events : key => topic.arn } }
output "queue_arns" { value = { for key, queue in aws_sqs_queue.consumer : key => queue.arn } }

output "dlq_arns" { value = { for key, queue in aws_sqs_queue.dead_letter : key => queue.arn } }

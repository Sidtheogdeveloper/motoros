# SYNTHETIC static-scanner inputs; never apply.
account_id       = "000000000001"
environment      = "staging"
app_origin       = "https://staging.example.test"
certificate_arn  = "arn:aws:acm:ap-south-1:000000000001:certificate/00000000-0000-0000-0000-000000000001"
owner            = "synthetic-scan"
cost_center      = "synthetic-scan"
alert_email      = "alerts@example.test"
smtp_host        = "email-smtp.ap-south-1.amazonaws.com"
mail_from        = "verified@example.test"
postgres_version = "17.6"
monthly_budget   = 1
image_digests    = { "tenant" : "000000000001.dkr.ecr.ap-south-1.amazonaws.com/motoros-staging/tenant@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "customer" : "000000000001.dkr.ecr.ap-south-1.amazonaws.com/motoros-staging/customer@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "workorder" : "000000000001.dkr.ecr.ap-south-1.amazonaws.com/motoros-staging/workorder@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "booking" : "000000000001.dkr.ecr.ap-south-1.amazonaws.com/motoros-staging/booking@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "inventory" : "000000000001.dkr.ecr.ap-south-1.amazonaws.com/motoros-staging/inventory@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "billing" : "000000000001.dkr.ecr.ap-south-1.amazonaws.com/motoros-staging/billing@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "notification" : "000000000001.dkr.ecr.ap-south-1.amazonaws.com/motoros-staging/notification@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "analytics" : "000000000001.dkr.ecr.ap-south-1.amazonaws.com/motoros-staging/analytics@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "api-bff" : "000000000001.dkr.ecr.ap-south-1.amazonaws.com/motoros-staging/api-bff@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
operator_image   = "000000000001.dkr.ecr.ap-south-1.amazonaws.com/motoros-staging/operator@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

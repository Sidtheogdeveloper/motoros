CREATE INDEX payments_invoice_balance ON payments(tenant_id,invoice_id) INCLUDE(amount,record_type);
CREATE INDEX invoice_credits_balance ON invoice_adjustments(tenant_id,invoice_id) INCLUDE(amount);
CREATE INDEX elapsed_estimates ON estimates(expires_at,id) WHERE status IN ('DRAFT','PENDING_CUSTOMER_APPROVAL');

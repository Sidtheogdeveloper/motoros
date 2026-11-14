package com.motoros.analytics;

import static org.springframework.http.HttpStatus.*;

import com.motoros.foundation.events.EventStore;
import com.motoros.security.Access;
import com.motoros.security.Permission;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/** The metric catalog is the only source of SQL expressions; all request values are parameters. */
@RestController
@RequestMapping("/api/analytics")
public class MetricQueryController {
  private final NamedParameterJdbcTemplate db;

  MetricQueryController(EventStore store) {
    db = new NamedParameterJdbcTemplate(store.db);
  }

  public enum Metric {
    invoice_value("billing", "invoices", "issuedAt", "sum(amount)", "money"),
    collected_payments("billing", "payments", "paymentAt", "sum(net_payment)", "money"),
    outstanding_balance("billing", "invoices", "issuedAt", "sum(balance)", "money"),
    unpaid_invoices("billing", "invoices", "issuedAt", "count(*)", "count"),
    appointment_count("booking", "appointments", "startsAt", "count(*)", "count"),
    completed_work_orders("workorder", "work_orders", "completedAt", "count(*)", "count"),
    average_turnaround("workorder", "work_orders", "completedAt", "round(avg(minutes),2)", "minutes"),
    estimate_approval_rate("billing", "estimates", "decidedAt",
        "round(100.0*count(*) filter(where status='APPROVED')/count(*),2)", "percent"),
    parts_consumption("inventory", "stock_reservations", "consumedAt", "sum(quantity)", "quantity"),
    repeat_customer_rate("workorder", "work_orders", "completedAt",
        "round(100.0*count(distinct customer_id) filter(where repeat_visit)/count(distinct customer_id),2)",
        "percent"),
    repeat_customer_count("workorder", "work_orders", "completedAt",
        "count(distinct customer_id) filter(where repeat_visit)", "count"),
    service_category_distribution("booking", "appointments", "startsAt", "count(*)", "count"),
    average_invoice_value("billing", "invoices", "issuedAt", "round(avg(amount),2)", "money");

    final String producer, aggregate, date, measure, unit;

    Metric(String producer, String aggregate, String date, String measure, String unit) {
      this.producer = producer;
      this.aggregate = aggregate;
      this.date = date;
      this.measure = measure;
      this.unit = unit;
    }

    boolean currency() {
      return unit.equals("money");
    }

    boolean ledger() {
      return this == outstanding_balance || this == unpaid_invoices;
    }

    boolean repeat() {
      return this == repeat_customer_rate || this == repeat_customer_count;
    }
  }

  public enum Dimension { total, branch, month, part, service }

  @GetMapping("/metrics")
  @Transactional(readOnly = true, timeout = 10)
  public Map<String, Object> query(
      @AuthenticationPrincipal Jwt principal,
      @RequestParam Metric metric,
      @RequestParam(defaultValue = "total") Dimension group,
      @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate start,
      @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate end,
      @RequestParam(required = false) List<UUID> branchId,
      @RequestParam(required = false) String currency) {
    Access.require(principal, Permission.ANALYTICS_BRANCH_READ);
    Access.require(principal, Permission.AI_ANALYTICS_USE);
    if (start.isBefore(LocalDate.of(2000, 1, 1)) || !end.isAfter(start)
        || ChronoUnit.DAYS.between(start, end) > 366
        || end.isAfter(LocalDate.now(ZoneOffset.UTC).plusDays(1)))
      throw new ResponseStatusException(BAD_REQUEST, "Use a reporting range of 1 to 366 UTC days.");
    if (currency != null && (!metric.currency() || !currency.matches("[A-Z]{3}")))
      throw new ResponseStatusException(BAD_REQUEST, "Currency applies only to monetary metrics.");
    if ((group == Dimension.part && metric != Metric.parts_consumption)
        || (group == Dimension.service && metric != Metric.service_category_distribution
            && metric != Metric.average_invoice_value))
      throw new ResponseStatusException(BAD_REQUEST, "Dimension does not apply to this metric.");

    var branches = branchId == null
        ? Optional.ofNullable(principal.getClaimAsStringList("branches")).orElse(List.of()).stream()
            .map(UUID::fromString).distinct().toList()
        : branchId.stream().distinct().toList();
    if (branches.isEmpty())
      throw new ResponseStatusException(FORBIDDEN, "Active branch membership required.");
    if (branches.size() > 100)
      throw new ResponseStatusException(BAD_REQUEST, "Select at most 100 active branches.");
    branches.forEach(branch -> Access.branch(principal, branch));

    var params = new MapSqlParameterSource()
        .addValue("tenant", Access.tenant(principal))
        .addValue("branches", branches)
        .addValue("start", start.atStartOfDay().atOffset(ZoneOffset.UTC))
        .addValue("end", end.atStartOfDay().atOffset(ZoneOffset.UTC))
        .addValue("lookback", start.minusMonths(6).atStartOfDay().atOffset(ZoneOffset.UTC))
        .addValue("producer", metric.producer)
        .addValue("aggregate", metric.aggregate)
        .addValue("currency", currency, java.sql.Types.VARCHAR);

    String grouping = switch (group) {
      case total -> "'total'::text";
      case branch -> "branch_id::text";
      case month -> "to_char(event_date at time zone 'UTC','YYYY-MM')";
      case part -> "part_id";
      case service -> "category_id";
    };
    String currencyExpression = metric.currency() ? "currency" : "null::text";
    String order = switch (group) {
      case part, service -> "value desc, label, currency";
      default -> "label, currency";
    };
    var rows = db.queryForList(source(metric, group)
        + " select " + grouping + " as label," + currencyExpression + " as currency,"
        + metric.measure + " as value from eligible"
        + " where event_date>=:start and event_date<:end"
        + (metric.currency() ? " and currency is not null and (:currency is null or currency=:currency)" : "")
        + (group == Dimension.part ? " and part_id is not null" : "")
        + (group == Dimension.service ? " and category_id is not null" : "")
        + " group by 1,2 order by " + order + " limit 101", params);
    // Decimal strings preserve exact database values through JSON and client rendering.
    rows.forEach(row -> row.computeIfPresent("value", (ignored, value) -> value.toString()));

    List<String> producers = group == Dimension.service && metric == Metric.average_invoice_value
        ? List.of("billing", "booking") : List.of(metric.producer);
    params.addValue("producers", producers);
    var freshness = db.queryForList("""
        select branch_id as "branchId",producer,max(updated_at) as "projectedAt"
        from analytics.aggregate_projections
        where tenant_id=:tenant and branch_id in (:branches) and producer in (:producers)
        group by branch_id,producer
        """, params);
    Instant now = Instant.now();
    var staleBranches = branches.stream().filter(branch -> producers.stream().anyMatch(producer ->
        freshness.stream().noneMatch(row -> branch.equals(row.get("branchId"))
            && producer.equals(row.get("producer"))
            && ((java.sql.Timestamp) row.get("projectedAt")).toInstant()
                .isAfter(now.minus(24, ChronoUnit.HOURS))))).toList();
    return Map.of(
        "rows", rows.stream().limit(100).toList(), "truncated", rows.size() > 100,
        "unit", metric.unit, "branchIds", branches, "asOf", now.toString(),
        "freshness", freshness, "staleBranchIds", staleBranches);
  }

  private static String source(Metric metric, Dimension group) {
    String base = """
        with scoped as not materialized (
          select * from analytics.aggregate_projections
          where tenant_id=:tenant and branch_id in (:branches)
        )
        """;
    if (metric.ledger()) {
      base += """
          , payments as (
            select branch_id,snapshot->>'invoiceId' as invoice_id,snapshot->>'currency' as currency,
              sum(case snapshot->>'recordType' when 'REFUND' then -1 else 1 end
                  * (snapshot->>'amount')::numeric) as paid
            from scoped where producer='billing' and aggregate_type='payments'
              and snapshot->>'recordType' in ('PAYMENT','REFUND')
            group by 1,2,3
          ), balances as (
            select i.branch_id,i.snapshot->>'currency' as currency,
              (i.snapshot->>'issuedAt')::timestamptz as event_date,
              (i.snapshot->>'amount')::numeric-coalesce(p.paid,0) as balance
            from scoped i left join payments p on p.branch_id=i.branch_id
              and p.invoice_id=i.aggregate_id::text and p.currency=i.snapshot->>'currency'
            where i.producer='billing' and i.aggregate_type='invoices' and i.snapshot->>'status'='ISSUED'
          ), eligible as (select * from balances where balance>0)
          """;
      return base;
    }
    if (metric.repeat()) {
      return base + """
          , visits as (
            select branch_id,snapshot->>'customerId' as customer_id,
              (snapshot->>'completedAt')::timestamptz as event_date,aggregate_id
            from scoped where producer=:producer and aggregate_type=:aggregate
              and snapshot->>'customerId' is not null
              and (snapshot->>'completedAt')::timestamptz>=:lookback
              and (snapshot->>'completedAt')::timestamptz<:end
          ), previous as (
            select *,lag(event_date) over(partition by customer_id order by event_date,aggregate_id) as prior
            from visits
          ), eligible as (
            select *,prior>=((event_date at time zone 'UTC')-interval '6 months') at time zone 'UTC'
              as repeat_visit from previous
          )
          """;
    }

    String businessFilter = switch (metric) {
      case invoice_value, average_invoice_value -> " and p.snapshot->>'status'='ISSUED'";
      case collected_payments -> " and p.snapshot->>'recordType' in ('PAYMENT','REFUND')";
      case estimate_approval_rate -> " and p.snapshot->>'status' in ('APPROVED','REJECTED')";
      case parts_consumption -> " and p.snapshot->>'status'='CONSUMED'";
      case average_turnaround ->
          " and (p.snapshot->>'completedAt')::timestamptz >= (p.snapshot->>'checkInAt')::timestamptz";
      default -> "";
    };
    String category = "p.snapshot->>'serviceCategoryId'";
    String bookingJoin = "";
    if (metric == Metric.average_invoice_value && group == Dimension.service) {
      category = "booking.category_id";
      bookingJoin = """
          join lateral (
            select b.snapshot->>'serviceCategoryId' as category_id from scoped b
            where b.producer='booking' and b.aggregate_type='appointments'
              and b.branch_id=p.branch_id and b.snapshot->>'workOrderId'=p.snapshot->>'workOrderId'
              and b.snapshot->>'serviceCategoryId' is not null
            order by b.aggregate_id limit 1
          ) booking on true
          """;
    }
    return base + ", eligible as (select p.branch_id,"
        + "(p.snapshot->>'" + metric.date + "')::timestamptz as event_date,"
        + "p.snapshot->>'currency' as currency,p.snapshot->>'partId' as part_id,"
        + "p.snapshot->>'status' as status," + category + " as category_id,"
        + """
          (p.snapshot->>'amount')::numeric as amount,(p.snapshot->>'quantity')::numeric as quantity,
          case p.snapshot->>'recordType' when 'REFUND' then -1 else 1 end
            * (p.snapshot->>'amount')::numeric as net_payment,
          extract(epoch from ((p.snapshot->>'completedAt')::timestamptz
            -(p.snapshot->>'checkInAt')::timestamptz))/60 as minutes
          from scoped p
          """ + bookingJoin
        + " where p.producer=:producer and p.aggregate_type=:aggregate" + businessFilter + ")";
  }
}

"""Translate business questions into a fixed, authorized Analytics API contract."""
import os
import re
import secrets
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from time import monotonic
from uuid import UUID, uuid4

import httpx
from fastapi import Depends, Header, Query, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import JSON, Column, DateTime, MetaData, String, Table, delete, select

from .providers import ProviderFailure
from .vehicle_history import DomainError, get_json

CATALOG = {
    "collected_payments": ("Recorded net collections", "Recorded payments minus recorded refunds, by ledger entry date. Invoices are excluded."),
    "invoice_value": ("Issued invoice value", "Total face value of issued invoices, by issue date. Includes invoices with an unpaid balance."),
    "outstanding_balance": ("Outstanding balance", "Current unpaid balance on invoices issued in the selected dates, after projected payments and refunds."),
    "unpaid_invoices": ("Unpaid invoices", "Invoices issued in the selected dates with a positive current balance, including partially paid invoices."),
    "appointment_count": ("Appointments", "Count of appointment records by latest scheduled start, including cancelled appointments."),
    "completed_work_orders": ("Completed work orders", "Count of work orders with a recorded repair completion, by latest recorded completion date."),
    "average_turnaround": ("Average repair turnaround", "Average minutes from check-in to recorded repair completion. Rows without both timestamps are excluded."),
    "estimate_approval_rate": ("Estimate approval rate", "Approved divided by approved plus rejected estimate revisions, by decision date. Superseded and undecided revisions are excluded."),
    "parts_consumption": ("Parts consumed", "Quantity on consumed stock reservations, by consumption date. Part fitment and inventory cost are outside this metric."),
    "repeat_customer_rate": ("Repeat customer rate", "Share of distinct customers completing a repair in the range with a preceding completion in the prior six months, within selected branches."),
    "repeat_customer_count": ("Repeat customers", "Distinct customers completing a repair in the range with a preceding completion in the prior six months, within selected branches."),
    "service_category_distribution": ("Appointment service mix", "Appointments by the recorded booking service category and scheduled start, including cancellations."),
    "average_invoice_value": ("Average issued invoice value", "Mean issued invoice value by issue date. Service grouping includes only invoices linked to a categorized appointment."),
}
PATTERNS = [
    ("unpaid_invoices", r"\bunpaid invoices?\b|\binvoices? (?:are|remain) unpaid\b"),
    ("outstanding_balance", r"\boutstanding (?:balances?|amounts?)\b"),
    ("average_invoice_value", r"\baverage invoice (?:value|amount)\b"),
    ("invoice_value", r"(?<!average )\b(?:issued )?invoice (?:value|totals?)\b|\btotal (?:issued )?invoices?\b"),
    ("collected_payments", r"\b(?:revenue|collections|cash collected|net payments|collected payments)\b"),
    ("estimate_approval_rate", r"\bestimate approvals?\b|\b(?:percentage|percent|rate) of estimates (?:are )?approved\b|\bestimate approval rate\b"),
    ("parts_consumption", r"\b(?:parts consumption|parts consumed|(?:frequently|often) replaced parts|parts were replaced)\b"),
    ("repeat_customer_rate", r"\brepeat customer rate\b|\bpercentage of (?:returning|repeat) customers\b"),
    ("repeat_customer_count", r"\brepeat customers\b|\bcustomers (?:returned|came back)\b"),
    ("service_category_distribution", r"\b(?:service mix|service category distribution|appointments by service category)\b"),
    ("average_turnaround", r"\b(?:repair turnaround|turnaround time|average repair time)\b"),
    ("completed_work_orders", r"\b(?:service volume|completed (?:repairs|work orders?|jobs))\b"),
    ("appointment_count", r"\b(?:appointment count|appointments|bookings)\b"),
]
RANGES = r"\b(last month|this month|last quarter|this year|last year|last (\d{1,3}) days)\b"
FOLLOW_UP = re.compile(
    r"^(?:what about |how about |show (?:it )?|now )?(?:last month|this month|last quarter|"
    r"this year|last year|last \d{1,3} days|by branch|by month|monthly|across all branches|run again)[?.!]*$"
)
metadata = MetaData()
history = Table(
    "ai_analytics_history", metadata,
    Column("id", String(36), primary_key=True),
    Column("tenant", String(36), nullable=False),
    Column("actor", String(64), nullable=False),
    Column("question", String(300), nullable=False),
    Column("spec", JSON, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
)


class Question(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    question: str = Field(min_length=3, max_length=300)
    branchIds: list[UUID] | None = Field(default=None, min_length=1, max_length=100)
    start: date | None = None
    end: date | None = None
    previousQueryId: UUID | None = None


class Emphasis(BaseModel):
    model_config = ConfigDict(extra="forbid")
    insight: int


def dates(phrase, today):
    month = today.replace(day=1)
    if phrase == "last month":
        return (month - timedelta(days=1)).replace(day=1), month
    if phrase == "last quarter":
        current = month.replace(month=(month.month - 1) // 3 * 3 + 1)
        previous = current - timedelta(days=1)
        return previous.replace(month=(previous.month - 1) // 3 * 3 + 1), current
    if phrase == "last year":
        return date(today.year - 1, 1, 1), date(today.year, 1, 1)
    if phrase == "this year":
        return today.replace(month=1, day=1), today + timedelta(days=1)
    if phrase and phrase.startswith("last ") and phrase.endswith(" days"):
        count = int(phrase.split()[1])
        return today - timedelta(days=count), today
    return month, today + timedelta(days=1)


def parse(body, allowed, branch_labels, previous=None, today=None):
    today = today or datetime.now(UTC).date()
    question = " ".join(body.question.casefold().split())
    if re.search(
        r"\b(?:select|drop|insert|update|delete|truncate|alter|union|sql|where|schema|tenant|"
        r"utilization|occupancy|profit|forecast|discount|tax|mechanic|technician|excluding|versus|"
        r"only|with|without|including|confirmed|cancelled|canceled|pending|rejected|per day|daily|weekly|yesterday|today|tomorrow|next|since|between|before|after|q[1-4])\b"
        r"|[;{}<>]|\b(?:19|20)\d{2}\b",
        question,
    ):
        raise DomainError(422, "This question uses an unsupported metric, filter or period. Try a suggested question or the date controls.")
    matches = [metric for metric, pattern in PATTERNS if re.search(pattern, question)]
    if "service_category_distribution" in matches and "appointment_count" in matches:
        matches.remove("appointment_count")
    if "repeat_customer_rate" in matches and "repeat_customer_count" in matches:
        matches.remove("repeat_customer_count")
    if len(matches) > 1:
        raise DomainError(422, "Ask about one metric at a time.")
    follow = not matches and previous and FOLLOW_UP.fullmatch(question)
    if not matches and not follow:
        raise DomainError(422, "I couldn't match the question to a supported metric. Try a suggested question.")
    metric = matches[0] if matches else previous["metric"]
    ranges = list(re.finditer(RANGES, question))
    if len(ranges) > 1 or ((body.start is None) != (body.end is None)) or (body.start and ranges):
        raise DomainError(422, "Choose one date range using the question or both date controls.")
    if body.start:
        start, end = body.start, body.end
    elif ranges:
        start, end = dates(ranges[0][0], today)
    elif follow:
        start, end = date.fromisoformat(previous["dateRange"]["start"]), date.fromisoformat(previous["dateRange"]["end"])
    else:
        start, end = dates(None, today)
    if start < date(2000, 1, 1) or not 1 <= (end - start).days <= 366 or end > today + timedelta(days=1):
        raise DomainError(422, "Use 1 to 366 UTC days ending no later than tomorrow.")

    named = [branch for branch, name in branch_labels.items()
             if re.search(r"(?<!\w)" + re.escape(name.casefold()) + r"(?!\w)", question)]
    if re.search(r"\b(?:in|at|for)\s+(?:the\s+)?branch\b", question) and not named and not body.branchIds:
        raise DomainError(422, "Choose the branch using the branch selector.")
    remaining = re.sub(RANGES, "", question)
    for branch in named:
        remaining = re.sub(r"(?<!\w)" + re.escape(branch_labels[branch].casefold()) + r"(?!\w)", "", remaining)
    remaining = re.sub(r"\b(?:inr|usd|gbp|eur|aed|aud|cad|sgd|all authorized branches|all branches)\b", "", remaining)
    if re.search(r"\b(?:in|at|for)\s+[a-z]", remaining) or re.search(
        r"\b(?:last week|this week|last \d+ months?|this quarter|last six months)\b", remaining
    ):
        raise DomainError(422, "I couldn't identify a location or date filter. Use the branch or date controls.")
    explicit = set(map(str, body.branchIds or []))
    if explicit and named and explicit != set(named):
        raise DomainError(422, "The named branch and branch selector disagree.")
    branches = explicit or set(named)
    if not branches:
        branches = set(previous["branchIds"]) if follow and "all branches" not in question else set(allowed)
    if not branches or not branches.issubset(allowed):
        raise DomainError(403, "The selected branch is outside your reporting access.")
    if len(branches) > 100:
        raise DomainError(422, "Select at most 100 authorized branches.")

    group = previous["groupBy"] if follow else "total"
    if re.search(r"\b(?:monthly|by month|trends?)\b", question):
        group = "month"
    elif re.search(r"\b(?:branches|by branch|which branch|branch comparison)\b", question):
        group = "branch"
    elif not follow:
        if metric == "parts_consumption":
            group = "part"
        elif metric == "service_category_distribution" or (
            metric == "average_invoice_value" and re.search(r"\bservices?\b", question)
        ):
            group = "service"
    currencies = re.findall(r"\b([A-Z]{3})\b", body.question.upper())
    currencies = set(currencies) & {"INR", "USD", "GBP", "EUR", "AED", "AUD", "CAD", "SGD"}
    if len(currencies) > 1:
        raise DomainError(422, "Select at most one currency. Omit the filter to see separate currency series.")
    currency = next(iter(currencies), None)
    if currency and metric not in {"collected_payments", "invoice_value", "average_invoice_value", "outstanding_balance"}:
        raise DomainError(422, "Currency filters apply only to monetary metrics.")
    return {"metric": metric, "groupBy": group, "dateRange": {"start": str(start), "end": str(end)},
            "branchIds": sorted(branches), "currency": currency or (previous["currency"] if follow else None)}


def insights(rows, group):
    if not rows:
        return ["No projected records matched this metric and date range."]
    sections = {}
    for row in rows:
        sections.setdefault(row["currency"], []).append(row)

    def value(row):
        return row["value"] + (" " + row["currency"] if row["currency"] else "")

    if group == "total":
        return ["; ".join(value(group_rows[0]) for group_rows in sections.values()) + "."]
    overview = f"{len(rows)} result rows across the requested scope. See the chart and table for the breakdown."
    if group == "month":
        return [" ".join(
            f"{group_rows[0]['label']}: {value(group_rows[0])}. "
            f"Latest reported month {group_rows[-1]['label']}: {value(group_rows[-1])}."
            if len(group_rows) > 1 else f"{group_rows[0]['label']}: {value(group_rows[0])}."
            for group_rows in sections.values()), overview]
    leaders = []
    for group_rows in sections.values():
        top = max(Decimal(row["value"]) for row in group_rows)
        tied = [row for row in group_rows if Decimal(row["value"]) == top]
        label = tied[0]["label"] if len(tied) == 1 else f"{len(tied)} groups tied"
        leaders.append(f"{label}: {value(tied[0])}.")
    return ["Highest reported value by currency or unit: " + " ".join(leaders), overview]


def register(app, store, provider, transport, key, tenant_url):
    analytics_url = os.getenv("AI_ANALYTICS_URL", "http://127.0.0.1:8088")
    inventory_url = os.getenv("AI_INVENTORY_URL", "http://127.0.0.1:8085")
    booking_url = os.getenv("AI_BOOKING_URL", "http://127.0.0.1:8084")

    def identity(response: Response, authorization: str = Header(default=""),
                 x_motoros_tenant: str = Header(default=""), x_motoros_ai_key: str = Header(default=""),
                 x_motoros_actor: str = Header(default="")):
        response.headers["Cache-Control"] = "no-store"
        if len(key) < 32 or not secrets.compare_digest(key.encode(), x_motoros_ai_key.encode()):
            raise DomainError(403, "AI gateway authorization required.")
        if not authorization.startswith("Bearer ") or len(authorization) > 8192:
            raise DomainError(401, "A valid session is required.")
        try:
            tenant = str(UUID(x_motoros_tenant))
        except ValueError as error:
            raise DomainError(403, "An active workshop is required.") from error
        if not re.fullmatch(r"[0-9a-f]{64}", x_motoros_actor):
            raise DomainError(403, "Staff identity is required.")
        if store is None:
            raise DomainError(503, "Analytics Intelligence storage is unavailable.")
        return tenant, x_motoros_actor, {
            "Authorization": authorization, "X-MotorOS-Tenant": tenant, "X-Correlation-ID": str(uuid4()),
        }

    def get(client, base, path, context, deadline, params=None):
        try:
            return get_json(client, base, path, context[2], deadline, params)
        except DomainError as error:
            raise DomainError(error.status, "An Analytics source is unavailable or access was denied.") from error

    def scope(client, context, deadline):
        access = get(client, tenant_url, "/api/me/permissions", context, deadline)
        if access.get("tenantId") != context[0] or not {"ANALYTICS_BRANCH_READ", "AI_ANALYTICS_USE"}.issubset(
            access.get("permissions", [])
        ):
            raise DomainError(403, "This role cannot use Analytics Intelligence.")
        return set(access.get("branches", []))

    def stored(context):
        return (history.c.tenant == context[0], history.c.actor == context[1],
                history.c.created_at > datetime.now(UTC) - timedelta(days=30))

    @app.get("/api/ai/analytics/query-history")
    def query_history(offset: int = Query(0, ge=0, le=1000), context=Depends(identity)):
        with httpx.Client(transport=transport, trust_env=False) as client:
            allowed = scope(client, context, monotonic() + 10)
        with store.engine.connect() as connection:
            rows = connection.execute(select(history).where(*stored(context))
                                      .order_by(history.c.created_at.desc(), history.c.id)
                                      .offset(offset).limit(21)).mappings().all()
        return {"queries": [{"id": row["id"], "question": row["question"], "spec": row["spec"]}
                            for row in rows[:20] if set(row["spec"]["branchIds"]).issubset(allowed)],
                "nextOffset": offset + 20 if len(rows) > 20 else None}

    @app.post("/api/ai/analytics/query")
    def query(body: Question, context=Depends(identity)):
        previous = None
        deadline = monotonic() + 25
        with httpx.Client(transport=transport, trust_env=False) as client:
            allowed = scope(client, context, deadline)
            if body.previousQueryId:
                with store.engine.connect() as connection:
                    previous = connection.execute(select(history.c.spec).where(
                        *stored(context), history.c.id == str(body.previousQueryId))).scalar_one_or_none()
                if not previous or not set(previous["branchIds"]).issubset(allowed):
                    raise DomainError(404, "Previous query is unavailable.")
            directory = get(client, tenant_url, "/api/branches", context, deadline, {"size": 100})
            # Recognize assigned labels only, and still pass every branch to the owning Analytics API.
            labels = {row["id"]: row["name"] for row in directory if row["id"] in allowed}
            spec = parse(body, allowed, labels, previous)
            params = [("metric", spec["metric"]), ("group", spec["groupBy"]),
                      *spec["dateRange"].items(), *(("branchId", bid) for bid in spec["branchIds"])]
            if spec["currency"]:
                params.append(("currency", spec["currency"]))
            result = get(client, analytics_url, "/api/analytics/metrics", context, deadline, params)
            if set(result["branchIds"]) != set(spec["branchIds"]):
                raise DomainError(503, "Analytics returned an unexpected scope.")
            if spec["groupBy"] == "service" and result["rows"]:
                services = get(client, booking_url, "/api/service-categories", context, deadline)
                labels = {row["id"]: row["name"] for row in services}
            if spec["groupBy"] == "part":
                # Limit extra owner API reads. Remaining records keep their stable catalog reference.
                labels = {}
                for row in result["rows"][:10]:
                    part = str(UUID(row["label"]))
                    try:
                        detail = get(client, inventory_url, "/api/parts/" + part, context, deadline)
                        if detail["id"] == part:
                            labels[part] = detail["name"] + " · " + detail["sku"]
                    except DomainError:
                        break
        rows = [{**row, "key": row["label"], "label": labels.get(row["label"], row["label"])}
                for row in result["rows"]]
        options = insights(rows, spec["groupBy"])
        emphasis = 0
        if provider and len(options) > 1:
            period = store.reserve(context[0], "business_analytics", 100)
            if period:
                try:
                    choice = provider.generate(
                        "Choose which precomputed insight to emphasize. 0 highlights the comparison; "
                        "1 directs the reader to the full breakdown. Return only the insight number.",
                        {"grouping": spec["groupBy"], "rows": len(rows), "options": [0, 1]},
                        Emphasis.model_json_schema())
                    selected = Emphasis.model_validate_json(choice.text, strict=True).insight
                    if selected in (0, 1):
                        emphasis = selected
                        store.record(context[0], "business_analytics", period, choice)
                except (ProviderFailure, ValidationError):
                    pass
        # Membership changes during interpretation must not expose the computed result or its history.
        with httpx.Client(transport=transport, trust_env=False) as client:
            if not set(spec["branchIds"]).issubset(scope(client, context, monotonic() + 6)):
                raise DomainError(403, "Reporting access changed. Run the query again.")
        query_id, now = str(uuid4()), datetime.now(UTC)
        with store.engine.begin() as connection:
            connection.execute(delete(history).where(history.c.created_at <= now - timedelta(days=30)))
            connection.execute(history.insert().values(id=query_id, tenant=context[0], actor=context[1],
                               question=body.question, spec=spec, created_at=now))
        label, definition = CATALOG[spec["metric"]]
        limitations = [
            "Event projections are eventually consistent. Quiet branches may show no recent projection.",
            "UTC dates use an exclusive end. Currency series are never added together.",
        ]
        if result["truncated"]:
            limitations.append("Only the first 100 result rows are shown.")
        if spec["metric"] == "collected_payments" and "revenue" in body.question.casefold():
            limitations.append("“Revenue” was interpreted as net collections. Ask for issued invoice value to compare invoices.")
        return {"queryId": query_id, "answer": options[emphasis], "title": label, "definition": definition,
                "spec": spec, "explanation": "Calculated from the Analytics Service's authorized projections.",
                "limitations": limitations, "rows": rows, "unit": result["unit"],
                "chart": {"type": {"total": "kpi", "month": "line"}.get(spec["groupBy"], "bar")},
                "asOf": result["asOf"], "freshness": result["freshness"],
                "staleBranchIds": result["staleBranchIds"]}

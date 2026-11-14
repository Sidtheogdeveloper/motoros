"""AI-owned persistence. The cache stores evidence identifiers only."""
from datetime import UTC, datetime, timedelta

from sqlalchemy import Boolean, ForeignKey, Column, Date, DateTime, Integer, JSON, MetaData, String, Table, delete, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

metadata = MetaData()
quotas = Table(
    "ai_usage_records", metadata,
    Column("tenant", String(36), primary_key=True),
    Column("feature", String(40), primary_key=True),
    Column("period", Date, primary_key=True),
    Column("attempts", Integer, nullable=False),
    Column("input_tokens", Integer, nullable=False),
    Column("output_tokens", Integer, nullable=False),
)
summaries = Table(
    "ai_history_summaries", metadata,
    Column("cache_key", String(64), primary_key=True),
    Column("tenant", String(36), nullable=False, index=True),
    Column("vehicle", String(36), nullable=False),
    Column("selection", JSON, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False, index=True),
)

invalidations = Table(
    "ai_history_invalidations", metadata,
    Column("tenant", String(36), primary_key=True),
    Column("vehicle", String(36), primary_key=True),
    Column("watermark", String(70), nullable=False),
)
feedback = Table(
    "ai_history_feedback", metadata,
    Column("cache_key", String(64), ForeignKey("ai_history_summaries.cache_key", ondelete="CASCADE"),
           primary_key=True),
    Column("actor", String(64), primary_key=True),
    Column("helpful", Boolean, nullable=False),
)


class Store:
    def __init__(self, engine, retention_hours: int = 24):
        self.engine = engine
        self.insert = sqlite_insert if engine.dialect.name == "sqlite" else pg_insert
        self.retention = timedelta(hours=retention_hours)

    def watermark(self, tenant, vehicle):
        with self.engine.connect() as connection:
            return connection.execute(select(invalidations.c.watermark).where(
                invalidations.c.tenant == tenant, invalidations.c.vehicle == vehicle,
            )).scalar_one_or_none()

    def invalidate(self, tenant, vehicle, watermark):
        with self.engine.begin() as connection:
            connection.execute(self.insert(invalidations).values(
                tenant=tenant, vehicle=vehicle, watermark=watermark,
            ).on_conflict_do_update(
                index_elements=["tenant", "vehicle"], set_={"watermark": watermark},
                where=invalidations.c.watermark < watermark,
            ))

    def feedback(self, key, actor):
        with self.engine.connect() as connection:
            return connection.execute(select(feedback.c.helpful).where(
                feedback.c.cache_key == key, feedback.c.actor == actor,
            )).scalar_one_or_none()

    def vote(self, key, actor, helpful):
        with self.engine.begin() as connection:
            connection.execute(self.insert(feedback).values(
                cache_key=key, actor=actor, helpful=helpful,
            ).on_conflict_do_update(
                index_elements=["cache_key", "actor"], set_={"helpful": helpful},
            ))

    def cached(self, tenant, key):
        with self.engine.connect() as connection:
            return connection.execute(
                select(summaries.c.selection, summaries.c.created_at).where(
                    summaries.c.cache_key == key, summaries.c.tenant == tenant,
                    summaries.c.created_at >= datetime.now(UTC) - self.retention,
                )
            ).first()

    def save(self, tenant, vehicle, key, selection):
        now = datetime.now(UTC)
        with self.engine.begin() as connection:
            connection.execute(self.insert(summaries).values(
                tenant=tenant, vehicle=vehicle, cache_key=key, selection=selection, created_at=now,
            ).on_conflict_do_update(index_elements=["cache_key"], set_={
                "selection": selection, "created_at": now,
            }))
        return now

    def reserve(self, tenant, feature, limit):
        period = datetime.now(UTC).date().replace(day=1)
        statement = self.insert(quotas).values(
            tenant=tenant, feature=feature, period=period, attempts=1, input_tokens=0, output_tokens=0,
        ).on_conflict_do_update(
            index_elements=["tenant", "feature", "period"],
            set_={"attempts": quotas.c.attempts + 1},
            where=quotas.c.attempts < limit,
        ).returning(quotas.c.period)
        with self.engine.begin() as connection:
            return connection.execute(statement).scalar_one_or_none()

    def record(self, tenant, feature, period, inference):
        with self.engine.begin() as connection:
            connection.execute(update(quotas).where(
                quotas.c.tenant == tenant, quotas.c.feature == feature, quotas.c.period == period,
            ).values(input_tokens=quotas.c.input_tokens + inference.input_tokens,
                     output_tokens=quotas.c.output_tokens + inference.output_tokens))

    def prune(self):
        with self.engine.begin() as connection:
            connection.execute(delete(summaries).where(
                summaries.c.created_at < datetime.now(UTC) - self.retention,
            ))

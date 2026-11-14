"""Tenant and staff scoped persistence for Copilot."""
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, JSON, String, Table
from sqlalchemy import delete, func, insert, select, text, update

from .storage import metadata
from .vehicle_history import DomainError

documents = Table(
    "ai_copilot_documents", metadata,
    Column("tenant", String(36), primary_key=True),
    Column("id", String(36), primary_key=True),
    Column("title", String(160), nullable=False),
    Column("kind", String(24), nullable=False),
    Column("version", Integer, nullable=False),
    Column("digest", String(64), nullable=False),
    Column("passages", JSON, nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
)
conversations = Table(
    "ai_copilot_conversations", metadata,
    Column("id", String(36), primary_key=True),
    Column("tenant", String(36), nullable=False),
    Column("actor", String(64), nullable=False),
    Column("job", String(36), nullable=False),
    Column("vehicle", String(36), nullable=False),
    Column("archived", Boolean, nullable=False),
    Column("turns", Integer, nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
)
Index("ix_copilot_scope", conversations.c.tenant, conversations.c.actor, conversations.c.job,
      conversations.c.updated_at)
messages = Table(
    "ai_copilot_turns", metadata,
    Column("conversation", String(36), ForeignKey("ai_copilot_conversations.id", ondelete="CASCADE"),
           primary_key=True),
    Column("number", Integer, primary_key=True),
    Column("question", String(1000), nullable=False),
    Column("citations", JSON, nullable=False),
    Column("helpful", Boolean),
)


class CopilotStore:
    def __init__(self, engine, retention_days):
        self.engine = engine
        self.retention = timedelta(days=retention_days)

    def scope(self, tenant, actor, job):
        return (
            conversations.c.tenant == tenant, conversations.c.actor == actor,
            conversations.c.job == job,
            conversations.c.updated_at >= datetime.now(UTC) - self.retention,
        )

    def get(self, tenant, actor, job, conversation):
        with self.engine.connect() as db:
            row = db.execute(select(conversations).where(
                *self.scope(tenant, actor, job), conversations.c.id == conversation,
            )).mappings().first()
            if row is None:
                raise DomainError(404, "Conversation unavailable.")
            return row

    def list(self, tenant, actor, job, offset, archived):
        with self.engine.connect() as db:
            return db.execute(select(conversations.c.id, conversations.c.updated_at,
                                     conversations.c.turns).where(
                *self.scope(tenant, actor, job), conversations.c.archived == archived,
            ).order_by(conversations.c.updated_at.desc(), conversations.c.id).offset(offset).limit(21)
            ).mappings().all()

    def turns(self, conversation, offset, limit):
        with self.engine.connect() as db:
            return db.execute(select(messages).where(messages.c.conversation == conversation)
                              .order_by(messages.c.number.desc()).offset(offset).limit(limit)
                              ).mappings().all()

    def append(self, tenant, actor, job, vehicle, current, question, citations):
        now = datetime.now(UTC)
        conversation = current["id"] if current else str(uuid4())
        number = current["turns"] + 1 if current else 1
        with self.engine.begin() as db:
            if current is None:
                db.execute(insert(conversations).values(
                    id=conversation, tenant=tenant, actor=actor, job=job, vehicle=vehicle,
                    archived=False, turns=1, updated_at=now,
                ))
            elif not db.execute(update(conversations).where(
                *self.scope(tenant, actor, job), conversations.c.id == conversation,
                conversations.c.archived.is_(False), conversations.c.turns == number - 1,
            ).values(turns=number, updated_at=now)).rowcount:
                raise DomainError(409, "Conversation changed. Reload it before asking again.")
            db.execute(insert(messages).values(conversation=conversation, number=number,
                                               question=question, citations=citations))
        return conversation, number

    def archive(self, tenant, actor, job, conversation):
        with self.engine.begin() as db:
            db.execute(update(conversations).where(*self.scope(tenant, actor, job),
                       conversations.c.id == conversation).values(archived=True))

    def vote(self, conversation, number, helpful):
        with self.engine.begin() as db:
            if not db.execute(update(messages).where(messages.c.conversation == conversation,
                       messages.c.number == number).values(helpful=helpful)).rowcount:
                raise DomainError(404, "Answer unavailable.")

    def docs(self, tenant, include_passages=False):
        columns = [documents.c.id, documents.c.title, documents.c.kind, documents.c.version]
        if include_passages:
            columns.append(documents.c.passages)
        with self.engine.connect() as db:
            return db.execute(select(*columns).where(documents.c.tenant == tenant)
                              .order_by(documents.c.title, documents.c.id)).mappings().all()

    def save_doc(self, tenant, doc, expected, **values):
        with self.engine.begin() as db:
            if expected is None:
                if self.engine.dialect.name == "postgresql":
                    db.execute(text("select pg_advisory_xact_lock(hashtext(:scope))"),
                               {"scope": "copilot-library:" + tenant})
                count = db.execute(select(func.count()).select_from(documents)
                                   .where(documents.c.tenant == tenant)).scalar_one()
                if count >= 20:
                    raise DomainError(409, "The library is full. Remove a document before adding one.")
                db.execute(insert(documents).values(tenant=tenant, id=doc, version=1, **values))
                return 1
            updated = db.execute(update(documents).where(
                documents.c.tenant == tenant, documents.c.id == doc,
                documents.c.version == expected,
            ).values(version=expected + 1, **values))
            if not updated.rowcount:
                raise DomainError(409, "Document changed or was removed. Reload and retry.")
            return expected + 1

    def remove_doc(self, tenant, doc, version):
        with self.engine.begin() as db:
            if not db.execute(delete(documents).where(documents.c.tenant == tenant,
                documents.c.id == doc, documents.c.version == version)).rowcount:
                raise DomainError(409, "Document changed or was removed. Reload and retry.")

    def prune(self):
        with self.engine.begin() as db:
            db.execute(delete(conversations).where(
                conversations.c.updated_at < datetime.now(UTC) - self.retention,
            ))

"""Prune expired cached selections using the configured AI database."""
import os
from datetime import UTC, datetime, timedelta

from sqlalchemy import create_engine, delete

from .analytics import history
from .copilot_store import CopilotStore
from .estimates import drafts
from .storage import Store


def main():
    engine = create_engine(os.environ["AI_DATABASE_URL"])
    try:
        Store(engine, int(os.getenv("AI_RETENTION_HOURS", "24"))).prune()
        days = max(1, min(int(os.getenv("AI_COPILOT_RETENTION_DAYS", "30")), 365))
        CopilotStore(engine, days).prune()
        with engine.begin() as connection:
            connection.execute(delete(drafts).where(drafts.c.expires_at <= datetime.now(UTC)))
            connection.execute(delete(history).where(history.c.created_at <= datetime.now(UTC) - timedelta(days=30)))
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()

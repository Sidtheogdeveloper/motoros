"""Run against the isolated, migrated AI development database only."""
import os
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from sqlalchemy import create_engine, inspect

from motoros_ai.providers import Inference
from motoros_ai.storage import Store


def main():
    engine = create_engine(os.environ["AI_DATABASE_URL"], pool_size=4)
    try:
        tables = set(inspect(engine).get_table_names())
        assert {"ai_history_summaries", "ai_usage_records", "alembic_version"} <= tables
        store = Store(engine)
        tenant, other, vehicle = (str(uuid4()) for _ in range(3))
        feature = "postgres_smoke"
        with ThreadPoolExecutor(max_workers=4) as workers:
            periods = list(workers.map(lambda _: store.reserve(tenant, feature, 3), range(8)))
        accepted = [period for period in periods if period]
        assert len(accepted) == 3
        store.record(tenant, feature, accepted[0], Inference("", 25, 5))
        key = uuid4().hex * 2
        assert store.cached(tenant, key) is None
        store.save(tenant, vehicle, key, '{"evidence":[1]}')
        assert store.cached(tenant, key).selection == '{"evidence":[1]}'
        assert store.cached(other, key) is None
        print("PostgreSQL migration, concurrent quota and cache isolation verified.")
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()

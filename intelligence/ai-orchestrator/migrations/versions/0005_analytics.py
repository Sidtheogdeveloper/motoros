"""Private analytics query history, without materialized result rows."""
from alembic import op
import sqlalchemy as sa

revision = "0005_analytics"
down_revision = "0004_estimates"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("ai_analytics_history",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant", sa.String(36), nullable=False),
        sa.Column("actor", sa.String(64), nullable=False),
        sa.Column("question", sa.String(300), nullable=False),
        sa.Column("spec", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_analytics_history_scope", "ai_analytics_history", ["tenant", "actor", "created_at"])
    op.create_index("ix_analytics_history_retention", "ai_analytics_history", ["created_at"])


def downgrade():
    op.drop_table("ai_analytics_history")

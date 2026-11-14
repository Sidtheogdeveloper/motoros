"""Initial history cache and usage ledger."""
from alembic import op
import sqlalchemy as sa

revision = "0001_history"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "ai_usage_records",
        sa.Column("tenant", sa.String(36), primary_key=True),
        sa.Column("feature", sa.String(40), primary_key=True),
        sa.Column("period", sa.Date(), primary_key=True),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False),
        sa.Column("output_tokens", sa.Integer(), nullable=False),
    )
    op.create_table(
        "ai_history_summaries",
        sa.Column("cache_key", sa.String(64), primary_key=True),
        sa.Column("tenant", sa.String(36), nullable=False),
        sa.Column("vehicle", sa.String(36), nullable=False),
        sa.Column("selection", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_ai_history_summaries_tenant", "ai_history_summaries", ["tenant"])
    op.create_index("ix_ai_history_summaries_created_at", "ai_history_summaries", ["created_at"])


def downgrade():
    op.drop_table("ai_history_summaries")
    op.drop_table("ai_usage_records")

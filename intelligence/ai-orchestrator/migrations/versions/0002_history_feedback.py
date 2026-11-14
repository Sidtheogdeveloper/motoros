"""Track cache invalidation watermarks and per-staff feedback."""
import sqlalchemy as sa
from alembic import op

revision = "0002_history_feedback"
down_revision = "0001_history"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "ai_history_invalidations",
        sa.Column("tenant", sa.String(36), primary_key=True),
        sa.Column("vehicle", sa.String(36), primary_key=True),
        sa.Column("watermark", sa.String(70), nullable=False),
    )
    op.create_table(
        "ai_history_feedback",
        sa.Column("cache_key", sa.String(64),
                  sa.ForeignKey("ai_history_summaries.cache_key", ondelete="CASCADE"), primary_key=True),
        sa.Column("actor", sa.String(64), primary_key=True),
        sa.Column("helpful", sa.Boolean(), nullable=False),
    )


def downgrade():
    op.drop_table("ai_history_feedback")
    op.drop_table("ai_history_invalidations")

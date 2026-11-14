"""Persist private, short-lived proposals for the estimate drafting workflow."""
from alembic import op
import sqlalchemy as sa

revision = "0004_estimates"
down_revision = "0003_copilot"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("ai_estimate_drafts",
        sa.Column("tenant", sa.String(36), primary_key=True),
        sa.Column("actor", sa.String(64), primary_key=True),
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("job", sa.String(36), nullable=False),
        sa.Column("body", sa.JSON(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_ai_estimate_drafts_expires_at", "ai_estimate_drafts", ["expires_at"])


def downgrade():
    op.drop_table("ai_estimate_drafts")

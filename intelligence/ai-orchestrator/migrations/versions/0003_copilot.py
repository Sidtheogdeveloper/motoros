"""Add the approved workshop library and private Copilot conversations."""
from alembic import op
import sqlalchemy as sa

revision = "0003_copilot"
down_revision = "0002_history_feedback"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("ai_copilot_documents",
        sa.Column("tenant", sa.String(36), primary_key=True),
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("digest", sa.String(64), nullable=False),
        sa.Column("passages", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False))
    op.create_table("ai_copilot_conversations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant", sa.String(36), nullable=False),
        sa.Column("actor", sa.String(64), nullable=False),
        sa.Column("job", sa.String(36), nullable=False),
        sa.Column("vehicle", sa.String(36), nullable=False),
        sa.Column("archived", sa.Boolean(), nullable=False),
        sa.Column("turns", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_copilot_scope", "ai_copilot_conversations",
                    ["tenant", "actor", "job", "updated_at"])
    op.create_table("ai_copilot_turns",
        sa.Column("conversation", sa.String(36),
                  sa.ForeignKey("ai_copilot_conversations.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("number", sa.Integer(), primary_key=True),
        sa.Column("question", sa.String(1000), nullable=False),
        sa.Column("citations", sa.JSON(), nullable=False),
        sa.Column("helpful", sa.Boolean()))


def downgrade():
    op.drop_table("ai_copilot_turns")
    op.drop_table("ai_copilot_conversations")
    op.drop_table("ai_copilot_documents")

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class SourceReference(BaseModel):
    resourceId: UUID
    branch: str
    date: datetime
    version: datetime


class Evidence(BaseModel):
    id: int
    category: str
    text: str
    resourceId: UUID


class RepeatedComplaint(BaseModel):
    text: str
    sourceIds: list[UUID]


class HistoryResponse(BaseModel):
    vehicleOverview: str
    recordedVisits: int
    highlights: list[Evidence]
    repeatedComplaints: list[RepeatedComplaint]


class Usage(BaseModel):
    inputTokens: int
    outputTokens: int
    cacheHit: bool


class TenantContext(BaseModel):
    branchId: UUID


class Summary(BaseModel):
    requestId: UUID
    summaryId: str | None
    helpful: bool | None
    feature: Literal["vehicle_history"]
    tenantContext: TenantContext
    modelIdentifier: str
    generatedAt: datetime
    response: HistoryResponse
    sourceReferences: list[SourceReference]
    warnings: list[str]
    reviewRequired: Literal[True]
    usageMetadata: Usage
    promptVersion: str


class SummaryList(BaseModel):
    summaries: list[Summary]


class Feedback(BaseModel):
    helpful: bool

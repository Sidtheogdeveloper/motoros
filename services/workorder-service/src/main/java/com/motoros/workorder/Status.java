package com.motoros.workorder;

import java.util.*;

public enum Status {
  CREATED,
  CHECKED_IN,
  INSPECTION,
  ESTIMATE_PENDING,
  AWAITING_APPROVAL,
  APPROVED,
  IN_PROGRESS,
  QUALITY_CHECK,
  READY_FOR_DELIVERY,
  DELIVERED,
  CLOSED,
  CANCELLED;

  public boolean canMoveTo(Status next) {
    if (next == CANCELLED)
      return Set.of(
              CREATED,
              CHECKED_IN,
              INSPECTION,
              ESTIMATE_PENDING,
              AWAITING_APPROVAL,
              APPROVED,
              IN_PROGRESS,
              QUALITY_CHECK,
              READY_FOR_DELIVERY)
          .contains(this);
    return switch (this) {
      case CREATED -> next == CHECKED_IN;
      case CHECKED_IN -> next == INSPECTION;
      case INSPECTION -> next == ESTIMATE_PENDING;
      case ESTIMATE_PENDING -> Set.of(AWAITING_APPROVAL, INSPECTION).contains(next);
      case AWAITING_APPROVAL -> Set.of(APPROVED, ESTIMATE_PENDING).contains(next);
      case APPROVED -> next == IN_PROGRESS;
      case IN_PROGRESS -> next == QUALITY_CHECK;
      case QUALITY_CHECK -> Set.of(IN_PROGRESS, READY_FOR_DELIVERY).contains(next);
      case READY_FOR_DELIVERY -> next == DELIVERED;
      case DELIVERED -> next == CLOSED;
      default -> false;
    };
  }
}

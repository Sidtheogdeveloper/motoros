package com.motoros.security;

import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.*;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestControllerAdvice
public class ApiErrors {
  @ExceptionHandler(ResponseStatusException.class)
  ResponseEntity<?> status(ResponseStatusException e, HttpServletRequest r) {
    return error(e.getStatusCode().value(), e.getReason(), r);
  }

  @ExceptionHandler({
    MethodArgumentNotValidException.class,
    org.springframework.http.converter.HttpMessageNotReadableException.class,
    org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class
  })
  ResponseEntity<?> invalid(Exception e, HttpServletRequest r) {
    return error(400, "Invalid input. Check required fields and formats.", r);
  }

  @ExceptionHandler({
    DataIntegrityViolationException.class,
    ObjectOptimisticLockingFailureException.class
  })
  ResponseEntity<?> conflict(Exception e, HttpServletRequest r) {
    return error(409, "Record conflict. Refresh and retry.", r);
  }

  @ExceptionHandler(Exception.class)
  ResponseEntity<?> unexpected(Exception e, HttpServletRequest r) {
    if (e instanceof org.springframework.web.ErrorResponse response) {
      var status = response.getStatusCode();
      var result = error(status.value(), HttpStatus.valueOf(status.value()).getReasonPhrase(), r);
      return ResponseEntity.status(status)
          .headers(response.getHeaders())
          .headers(result.getHeaders())
          .body(result.getBody());
    }
    org.slf4j.LoggerFactory.getLogger(getClass())
        .error(
            "Request failed correlationId={} type={}",
            r.getAttribute("correlationId"),
            e.getClass().getName());
    return error(500, "An internal error occurred", r);
  }

  private ResponseEntity<?> error(int status, String detail, HttpServletRequest r) {
    return ResponseEntity.status(status)
        .contentType(MediaType.APPLICATION_PROBLEM_JSON)
        .body(
            Map.of(
                "status",
                status,
                "title",
                detail == null ? "Request failed" : detail,
                "correlationId",
                String.valueOf(r.getAttribute("correlationId"))));
  }
}

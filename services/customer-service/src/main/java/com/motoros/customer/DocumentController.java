package com.motoros.customer;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class DocumentController {
  private final Documents documents;

  DocumentController(Documents documents) {
    this.documents = documents;
  }

  public record Upload(
      @NotBlank @Size(max = 180) String fileName,
      @NotBlank String contentType,
      @Min(1) @Max(10485760) long byteSize,
      @NotBlank String sha256,
      @NotNull UUID branchId,
      @NotBlank String visibility) {}

  @PostMapping("/{kind:vehicles|customers}/{id}/documents/uploads")
  @ResponseStatus(org.springframework.http.HttpStatus.CREATED)
  Map<String, Object> begin(
      @AuthenticationPrincipal Jwt j,
      @PathVariable String kind,
      @PathVariable UUID id,
      @Valid @RequestBody Upload in) {
    return documents.begin(j, kind, id, in);
  }

  @GetMapping("/{kind:vehicles|customers}/{id}/documents")
  Map<String, Object> list(
      @AuthenticationPrincipal Jwt j,
      @PathVariable String kind,
      @PathVariable UUID id,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return documents.list(j, kind, id, page, size);
  }

  @PostMapping("/documents/{id}/complete")
  Map<String, Object> complete(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @Valid @RequestBody CustomerController.Version in) {
    return documents.complete(j, id, in.version());
  }

  @PostMapping("/documents/{id}/download")
  Map<String, Object> download(@AuthenticationPrincipal Jwt j, @PathVariable UUID id) {
    return documents.download(j, id);
  }

  @PostMapping("/documents/{id}/archive")
  Map<String, Object> archive(
      @AuthenticationPrincipal Jwt j,
      @PathVariable UUID id,
      @Valid @RequestBody CustomerController.Version in) {
    return documents.archive(j, id, in.version());
  }
}

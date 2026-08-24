package com.nanaskitchens.api.kitchens;

import com.nanaskitchens.api.audit.AuditLog;
import com.nanaskitchens.api.audit.AuditLogRepository;
import com.nanaskitchens.api.storage.PhotoStorage;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.transaction.annotation.Transactional;

/**
 * Story 7.1 (FR19) — health/permit documents. Sellers upload PDF or image files to their
 * own kitchen; the list (with upload dates) is public on the kitchen profile. Reuses the
 * PhotoStorage provider from Story 1.3 (local disk now, S3 signed URLs later).
 */
@RestController
@RequestMapping("/kitchens/{kitchenId}/health-reports")
public class HealthReportsController {

    static final long MAX_REPORT_BYTES = 5 * 1024 * 1024;

    private final JdbcClient db;
    private final PhotoStorage storage;
    private final AuditLogRepository auditLogRepository;

    public HealthReportsController(JdbcClient db, PhotoStorage storage, AuditLogRepository auditLogRepository) {
        this.db = db;
        this.storage = storage;
        this.auditLogRepository = auditLogRepository;
    }

    /** Public list — buyers judge trust by documents + upload recency (front-end-spec). */
    @GetMapping
    public List<Map<String, Object>> list(@PathVariable String kitchenId) {
        return db.sql("""
                SELECT id, "fileUrl", filename, "uploadedAt" FROM "HealthReport"
                WHERE "kitchenId" = :kitchenId
                ORDER BY "uploadedAt" DESC
                """)
                .param("kitchenId", kitchenId)
                .query((rs, n) -> {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("id", rs.getString("id"));
                    row.put("fileUrl", rs.getString("fileUrl"));
                    row.put("filename", rs.getString("filename"));
                    row.put("uploadedAt", rs.getTimestamp("uploadedAt").toLocalDateTime());
                    return row;
                })
                .list();
    }

    @PostMapping
    @PreAuthorize("hasRole('SELLER')")
    @Transactional
    public List<Map<String, Object>> upload(
            Authentication auth, @PathVariable String kitchenId, @RequestParam("file") MultipartFile file)
            throws IOException {
        requireOwnedKitchen(auth.getName(), kitchenId);
        String contentType = file.getContentType();
        if (contentType == null || !PhotoStorage.EXTENSIONS.containsKey(contentType)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "UNSUPPORTED_DOCUMENT_TYPE");
        }
        if (file.getSize() == 0 || file.getSize() > MAX_REPORT_BYTES) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "DOCUMENT_TOO_LARGE");
        }
        String url = storage.store(file.getBytes(), contentType);
        // Display name only — the stored file keeps its own UUID name.
        String filename = file.getOriginalFilename() == null || file.getOriginalFilename().isBlank()
                ? "document"
                : file.getOriginalFilename().replaceAll("[\\r\\n\"<>]", "").trim();
        db.sql("""
                INSERT INTO "HealthReport" (id, "kitchenId", "fileUrl", filename)
                VALUES (:id, :kitchenId, :fileUrl, :filename)
                """)
                .param("id", UUID.randomUUID().toString())
                .param("kitchenId", kitchenId)
                .param("fileUrl", url)
                .param("filename", filename)
                .update();
        AuditLog log = new AuditLog();
        log.setActor(auth.getName());
        log.setEntity("Kitchen:" + kitchenId);
        log.setAction("upload_health_report");
        auditLogRepository.save(log);
        return list(kitchenId);
    }

    @DeleteMapping("/{reportId}")
    @PreAuthorize("hasRole('SELLER')")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void remove(Authentication auth, @PathVariable String kitchenId, @PathVariable String reportId) {
        requireOwnedKitchen(auth.getName(), kitchenId);
        int deleted = db.sql("DELETE FROM \"HealthReport\" WHERE id = :id AND \"kitchenId\" = :kitchenId")
                .param("id", reportId)
                .param("kitchenId", kitchenId)
                .update();
        if (deleted == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "REPORT_NOT_FOUND");
        }
    }

    private void requireOwnedKitchen(String sellerId, String kitchenId) {
        String ownerId = db.sql("SELECT \"sellerId\" FROM \"Kitchen\" WHERE id = :id")
                .param("id", kitchenId)
                .query(String.class)
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "KITCHEN_NOT_FOUND"));
        if (!ownerId.equals(sellerId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
    }
}

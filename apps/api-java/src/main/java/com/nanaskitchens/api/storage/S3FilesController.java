package com.nanaskitchens.api.storage;

import java.net.URI;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * The s3 half of {@code GET /files/{name}}; {@link FilesController} is the local-disk half and
 * exactly one of the two is active. Same url, different provider — which is the whole point:
 * the url written into the database when a photo was uploaded keeps working after a switch.
 *
 * <p>Answers a redirect to a short-lived presigned url rather than streaming the bytes. The
 * bucket stays private (no public-read policy to get wrong), the app does not sit in the path
 * of every image byte, and nothing with an expiry date is ever persisted.
 */
@RestController
@ConditionalOnProperty(name = "app.storage.provider", havingValue = "s3")
public class S3FilesController {

    private final S3PhotoStorage storage;

    public S3FilesController(S3PhotoStorage storage) {
        this.storage = storage;
    }

    @GetMapping("/files/{name}")
    public ResponseEntity<Void> serve(@PathVariable String name) {
        // Same guard as the local controller: UUID.ext only. Here it also keeps a crafted name
        // from being signed into a url for some other key in the bucket.
        if (!name.matches("[0-9a-f-]{36}\\.(jpg|png|webp|pdf)")) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        return ResponseEntity.status(HttpStatus.FOUND)
                .location(URI.create(storage.presignedUrl(name)))
                // Cacheable, but for less than the signature's lifetime — a cached redirect
                // that outlives its own target is a broken image.
                .header("Cache-Control", "private, max-age=300")
                .build();
    }
}

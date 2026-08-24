package com.nanaskitchens.api.storage;

import java.util.Map;
import java.util.UUID;

/**
 * Story 1.3 AC2 — photo storage behind a provider interface, same pattern as
 * payments/delivery: the S3 impl is selected with STORAGE_PROVIDER=s3, the local-disk one
 * keeps uploads working with zero configuration.
 *
 * <p>Both impls return the SAME url shape — {@code {public-base-url}/files/{name}} — and that
 * url is written into the database (Kitchen.photo, Dish.photo, the health report link). That
 * is deliberate and it is the constraint any future provider has to respect: a stored url has
 * to still resolve months later. Returning a presigned S3 url from here would look like it
 * worked and then rot in the database when the signature expired, so signing happens at READ
 * time in the controller instead, behind a url that never changes.
 */
public interface PhotoStorage {

    /**
     * All storable types; endpoints narrow this further (photos: images only, health
     * reports: images + pdf). Lives on the interface rather than on one impl — the check runs
     * on the upload path, which has no idea which provider is configured.
     */
    Map<String, String> EXTENSIONS = Map.of(
            "image/jpeg", "jpg",
            "image/png", "png",
            "image/webp", "webp",
            "application/pdf", "pdf");

    /** {@code {uuid}.{ext}} — FilesController only serves names matching exactly this shape. */
    static String newName(String contentType) {
        return UUID.randomUUID() + "." + EXTENSIONS.get(contentType);
    }

    /** Persists the bytes and returns a stable, publicly resolvable URL. */
    String store(byte[] bytes, String contentType);
}

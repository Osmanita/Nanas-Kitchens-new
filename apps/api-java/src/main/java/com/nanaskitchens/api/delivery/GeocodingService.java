package com.nanaskitchens.api.delivery;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Free-tier geocoding via OpenStreetMap Nominatim (fine for dev; production swaps in a paid
 * geocoder behind this same seam). Returns null when the address cannot be resolved — callers
 * treat that as "cannot verify", not as a hard failure, so patchy coverage (e.g. Northern
 * Cyprus) does not block real orders.
 */
@Service("deliveryGeocodingService")
public class GeocodingService {

    public record Point(double lat, double lng, String countryCode) {
    }

    private static final Logger log = LoggerFactory.getLogger(GeocodingService.class);

    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(4)).build();
    private final JsonMapper jsonMapper;

    public GeocodingService(JsonMapper jsonMapper) {
        this.jsonMapper = jsonMapper;
    }

    /**
     * Tiered lookup: the full address first, then progressively drop leading tokens
     * ("sunset valley a30 kalkanli guzelyurt" → ... → "kalkanli guzelyurt") so site/house
     * codes that OSM does not know cannot hide the locality. Returns null only when no
     * variant resolves.
     */
    public Point geocode(String address) {
        String[] tokens = address.trim().replaceAll("[,;]+", " ").split("\\s+");
        for (int drop = 0; drop <= Math.min(3, tokens.length - 2); drop++) {
            String candidate = String.join(" ",
                    java.util.Arrays.copyOfRange(tokens, drop, tokens.length));
            Point point = lookup(candidate);
            if (point != null) {
                return point;
            }
            try {
                Thread.sleep(1100); // Nominatim usage policy: max 1 request/second
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return null;
            }
        }
        return null;
    }

    private Point lookup(String address) {
        try {
            String url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&q="
                    + URLEncoder.encode(address, StandardCharsets.UTF_8);
            HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                    .header("User-Agent", "NanasKitchensDev/1.0 (delivery radius check)")
                    .timeout(Duration.ofSeconds(5))
                    .GET()
                    .build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                log.warn("Geocoding HTTP {} for address lookup", response.statusCode());
                return null;
            }
            JsonNode results = jsonMapper.readTree(response.body());
            if (!results.isArray() || results.isEmpty()) {
                return null;
            }
            JsonNode first = results.get(0);
            JsonNode countryNode = first.path("address").path("country_code");
            String countryCode = countryNode.isMissingNode() || countryNode.isNull()
                    ? null
                    : countryNode.asString();
            return new Point(first.get("lat").asDouble(), first.get("lon").asDouble(), countryCode);
        } catch (Exception e) {
            log.warn("Geocoding failed, skipping radius check: {}", e.toString());
            return null;
        }
    }
}

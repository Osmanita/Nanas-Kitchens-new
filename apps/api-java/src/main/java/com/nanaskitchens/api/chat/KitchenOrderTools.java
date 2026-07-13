package com.nanaskitchens.api.chat;

import com.nanaskitchens.api.inventory.InventoryService;
import com.nanaskitchens.api.kitchens.KitchensService;
import com.nanaskitchens.api.orders.OrdersService;
import com.nanaskitchens.api.orders.dto.CreateOrderRequest;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;

/**
 * Agent tools (NFR3: same capabilities as the MCP server), all backed by this service's own
 * domain services. Errors are returned as JSON strings so the model can recover (e.g. offer
 * alternatives on PORTIONS_CONFLICT) instead of the stream aborting.
 */
public class KitchenOrderTools {

    private static final Logger log = LoggerFactory.getLogger(KitchenOrderTools.class);

    private final KitchensService kitchens;
    private final OrdersService orders;
    private final InventoryService inventory;
    private final JsonMapper jsonMapper;
    private final String buyerId;

    KitchenOrderTools(
            KitchensService kitchens,
            OrdersService orders,
            InventoryService inventory,
            JsonMapper jsonMapper,
            String buyerId) {
        this.kitchens = kitchens;
        this.orders = orders;
        this.inventory = inventory;
        this.jsonMapper = jsonMapper;
        this.buyerId = buyerId;
    }

    @Tool(description = "Search for kitchens within 10 miles. Give either lat/lng coordinates or a city/postal-code location (for example 43065). Returns name, cuisine, distance, and live portions left.")
    public String searchKitchens(
            Double lat,
            Double lng,
            @ToolParam(required = false, description = "A city, address, or postal code supplied by the buyer, such as 43065. Use this when lat/lng are not available.")
                    String location,
            @ToolParam(
                            required = false,
                            description = "Exact tag, one of: turkish, chinese, mexican, indian, italian, "
                                    + "japanese, korean, vietnamese, lebanese, ethiopian, persian, greek, thai, "
                                    + "other. Map the user's language to these tags (e.g. \"Türk mutfağı\" -> turkish). "
                                    + "Omit to list all cuisines.")
                    String cuisine) {
        if (lat != null && lng != null) {
            return guarded(() -> nearbyOrDemo(lat, lng, cuisine));
        }
        if (location != null && !location.isBlank()) {
            return guarded(() -> {
                List<?> results = kitchens.searchByLocation(location, cuisine);
                return results.isEmpty() ? demoFallback(cuisine) : results;
            });
        }
        if (lat == null || lng == null) {
            return jsonMapper.writeValueAsString(Map.of(
                    "error", "LOCATION_REQUIRED",
                    "message", "Ask the user for their city or coordinates, then search again."));
        }
        return guarded(() -> kitchens.search(lat, lng, cuisine));
    }

    /** Keep the demo conversational when the browser's real location has no local listings. */
    private Object nearbyOrDemo(double lat, double lng, String cuisine) {
        List<?> results = kitchens.search(lat, lng, cuisine);
        return results.isEmpty() ? demoFallback(cuisine) : results;
    }

    private Map<String, Object> demoFallback(String cuisine) {
        // Powell, OH 43065 — the checked-in demo kitchens live around this point.
        return Map.of(
                "results", kitchens.search(40.1578, -83.0752, cuisine),
                "fallbackLocation", "43065 (Powell, OH)",
                "message", "No matching kitchens are currently listed near the browser location. "
                        + "Showing the seeded demo marketplace instead.");
    }

    @Tool(description = "Get the published daily menu for a kitchen.")
    public String getMenu(
            @ToolParam(description = "The kitchen's UUID from searchKitchens results; the exact kitchen name also works")
                    String kitchenId,
            @ToolParam(required = false, description = "ISO date string (YYYY-MM-DD), defaults to today") String date) {
        // The chat UI only carries text across turns, so the model often has the kitchen NAME
        // but not the UUID from an earlier turn. Resolve names to ids instead of failing.
        return guarded(() -> kitchens.publishedMenu(kitchens.resolveKitchenId(kitchenId), date));
    }

    @Tool(description = "Check live remaining portions for a list of menu item IDs.")
    public String checkPortions(List<String> menuItemIds) {
        return guarded(() -> inventory.remaining(menuItemIds));
    }

    @Tool(
            description =
                    "Create an order. With confirm=false returns a priced summary only (FR15). "
                            + "Call with confirm=false first, show summary to user, then call with confirm=true "
                            + "after explicit confirmation. menuDayId and menuItemId values must come from a "
                            + "fresh getMenu call. readySlot is the pickup/delivery time as ISO datetime "
                            + "(e.g. 2026-07-10T17:00:00Z) or HH:mm for today (e.g. 17:00).")
    public String createOrder(CreateOrderRequest input) {
        return guarded(() -> orders.place(buyerId, input));
    }

    @Tool(description = "Get the status of an existing order.")
    public String getOrderStatus(String orderId) {
        return guarded(() -> orders.detail(buyerId, orderId));
    }

    @Tool(description = "Cancel an order. Inventory is automatically restored.")
    public String cancelOrder(String orderId) {
        return guarded(() -> orders.cancel(buyerId, orderId));
    }

    private String guarded(java.util.function.Supplier<Object> call) {
        try {
            Object result = call.get();
            return result == null ? "null" : jsonMapper.writeValueAsString(result);
        } catch (ResponseStatusException e) {
            return jsonMapper.writeValueAsString(Map.of(
                    "error", e.getReason() != null ? e.getReason() : "ERROR",
                    "status", e.getStatusCode().value()));
        } catch (RuntimeException e) {
            // e.g. a stale/guessed UUID hitting a uuid column. Give the model something it can
            // recover from (re-fetch ids and retry) instead of aborting the tool call.
            log.warn("Tool call failed (model likely used a stale/guessed id): {}", e.toString());
            return jsonMapper.writeValueAsString(Map.of(
                    "error", "TOOL_ERROR",
                    "message", "Invalid or stale ids. Call searchKitchens and getMenu again to refresh, then retry."));
        }
    }
}

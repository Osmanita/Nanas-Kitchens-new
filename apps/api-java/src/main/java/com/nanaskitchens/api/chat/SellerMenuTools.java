package com.nanaskitchens.api.chat;

import com.nanaskitchens.api.kitchens.KitchensService;
import com.nanaskitchens.api.kitchens.dto.KitchenProfile;
import com.nanaskitchens.api.menus.MenusService;
import com.nanaskitchens.api.menus.dto.CreateMenuDayRequest;
import com.nanaskitchens.api.menus.dto.DishRequest;
import com.nanaskitchens.api.menus.dto.UpdateMenuDayRequest;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;

/**
 * Agent tools for the seller-side menu builder: the kitchen owner describes the day's cooking
 * in plain language and the agent turns it into dishes, a dated menu, and a publish. Every call
 * resolves the kitchen from the JWT subject, so a seller can only ever touch their own kitchen.
 */
public class SellerMenuTools {

    private static final Logger log = LoggerFactory.getLogger(SellerMenuTools.class);

    private final KitchensService kitchens;
    private final MenusService menus;
    private final JsonMapper jsonMapper;
    private final String sellerId;

    SellerMenuTools(KitchensService kitchens, MenusService menus, JsonMapper jsonMapper, String sellerId) {
        this.kitchens = kitchens;
        this.menus = menus;
        this.jsonMapper = jsonMapper;
        this.sellerId = sellerId;
    }

    @Tool(description = "Get the signed-in seller's own kitchen: id, name, cuisine, and whether the "
            + "compliance attestation needed for publishing is signed. Call this first.")
    public String getMyKitchen() {
        return guarded(() -> {
            KitchenProfile kitchen = kitchens.sellerKitchen(sellerId);
            Map<String, Object> summary = new LinkedHashMap<>();
            summary.put("id", kitchen.id());
            summary.put("name", kitchen.name());
            summary.put("cuisineTag", kitchen.cuisineTag());
            summary.put("canPublish", kitchen.complianceAttestedAt() != null);
            return summary;
        });
    }

    @Tool(description = "List the kitchen's saved dish library (id, name, price, dietary tags). "
            + "Reuse an existing dish instead of creating a duplicate.")
    public String listDishes() {
        return guarded(() -> menus.listDishes(sellerId, kitchenId()));
    }

    @Tool(description = "Save a new dish to the kitchen's library. priceCents is the price in cents "
            + "(a $12 dish is 1200). dietaryTags are lowercase, e.g. vegetarian, vegan, gluten-free, halal.")
    public String createDish(
            @ToolParam(description = "Dish name as the buyer will see it") String name,
            @ToolParam(description = "One short appetising sentence") String description,
            @ToolParam(description = "Price in cents, e.g. 1200 for $12.00") Integer priceCents,
            @ToolParam(required = false, description = "Lowercase dietary tags") List<String> dietaryTags) {
        return guarded(() -> menus.createDish(
                sellerId, kitchenId(), new DishRequest(name, description, null, priceCents, dietaryTags)));
    }

    @Tool(description = "List the kitchen's menu days with their status (draft/published) and items. "
            + "Pass a date (YYYY-MM-DD) to look at one day.")
    public String listMenuDays(@ToolParam(required = false, description = "ISO date YYYY-MM-DD") String date) {
        return guarded(() -> menus.listMenuDays(sellerId, kitchenId(), date));
    }

    @Tool(description = "Create a DRAFT menu for one date. readyWindows are the pickup/delivery time "
            + "windows, e.g. start 17:00, end 20:00, slotMinutes 30. items pair a dishId from the dish "
            + "library with how many portions will be cooked. This does not publish — call publishMenuDay after.")
    public String createMenuDay(CreateMenuDayRequest input) {
        return guarded(() -> menus.createMenuDay(sellerId, kitchenId(), input));
    }

    @Tool(description = "Change a DRAFT menu day. Both fields are optional; items is a full replace of "
            + "the day's dishes and portions. Published menus cannot be edited here.")
    public String updateMenuDay(String menuDayId, UpdateMenuDayRequest input) {
        return guarded(() -> menus.updateMenuDay(sellerId, kitchenId(), menuDayId, input));
    }

    @Tool(description = "Publish a draft menu day so buyers can order it. Requires the compliance "
            + "attestation to be signed and the menu to have at least one dish.")
    public String publishMenuDay(String menuDayId) {
        return guarded(() -> menus.publish(sellerId, kitchenId(), menuDayId));
    }

    private String kitchenId() {
        return kitchens.sellerKitchen(sellerId).id();
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
            log.warn("Seller tool call failed: {}", e.toString());
            return jsonMapper.writeValueAsString(Map.of(
                    "error", "TOOL_ERROR",
                    "message", "That call failed. Re-read the kitchen and dish list, then retry."));
        }
    }
}

package com.nanaskitchens.api.orders.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Pattern;
import java.util.List;

/** Mirrors CreateOrderInput in packages/core (FR15: confirm is enforced server-side). */
public record CreateOrderRequest(
        @NotBlank String kitchenId,
        @NotBlank String menuDayId,
        @NotEmpty @Valid List<Item> items,
        @NotBlank String readySlot,
        @Pattern(regexp = "pickup|delivery") String fulfillment,
        // Required for delivery orders; street address the courier drops off at.
        String deliveryAddress,
        @Min(0) Integer courierTipCents,
        boolean confirm) {

    public record Item(@NotBlank String menuItemId, @Min(1) int qty) {
    }
}

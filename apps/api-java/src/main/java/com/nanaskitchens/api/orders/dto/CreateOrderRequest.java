package com.nanaskitchens.api.orders.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Pattern;
import java.util.List;

/** Mirrors CreateOrderInput in packages/core (FR15: confirm is enforced server-side).
 * courierTipCents/confirm/qty are boxed, not primitive: the chat agent's tool-call JSON
 * sometimes omits or nulls an "inapplicable" field (e.g. tip on a pickup order) instead of
 * defaulting it itself, and binding null into a primitive int/boolean throws a raw Jackson
 * error instead of a recoverable one — the compact constructor below normalizes those. */
public record CreateOrderRequest(
        @NotBlank String kitchenId,
        @NotBlank String menuDayId,
        @NotEmpty @Valid List<Item> items,
        @NotBlank String readySlot,
        @Pattern(regexp = "pickup|delivery") String fulfillment,
        // Required for delivery orders; street address the courier drops off at.
        String deliveryAddress,
        @Min(0) Integer courierTipCents,
        Boolean confirm) {

    public CreateOrderRequest {
        if (courierTipCents == null) courierTipCents = 0;
        if (confirm == null) confirm = false;
    }

    public record Item(@NotBlank String menuItemId, @Min(1) Integer qty) {
        public Item {
            if (qty == null) qty = 1;
        }
    }
}

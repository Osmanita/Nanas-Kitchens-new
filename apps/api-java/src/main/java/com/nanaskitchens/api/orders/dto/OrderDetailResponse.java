package com.nanaskitchens.api.orders.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.nanaskitchens.api.kitchens.dto.MenuDayResponse;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * Same nested shape the NestJS detail endpoint returned (order + items + menuItem + dish +
 * kitchenName). FR10: pickupAddress is only present for confirmed pickup orders.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record OrderDetailResponse(
        String id,
        String buyerId,
        String kitchenId,
        String menuDayId,
        String status,
        LocalDateTime readySlot,
        String fulfillment,
        int totalCents,
        int commissionCents,
        String paymentIntentId,
        LocalDateTime refundedAt,
        String idempotencyKey,
        LocalDateTime createdAt,
        List<Item> items,
        String kitchenName,
        String pickupAddress,
        String pickupTimeZone,
        Map<String, Object> deliveryJob) {

    public record Item(
            String id,
            String orderId,
            String menuItemId,
            int qty,
            int unitPriceCents,
            MenuItemRef menuItem) {
    }

    public record MenuItemRef(
            String id,
            String menuDayId,
            String dishId,
            int portionsTotal,
            int portionsRemaining,
            MenuDayResponse.Dish dish) {
    }
}

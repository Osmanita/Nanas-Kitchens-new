package com.nanaskitchens.api.orders;

import com.nanaskitchens.api.orders.dto.CreateOrderRequest;
import com.nanaskitchens.api.orders.dto.OrderDetailResponse;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/orders")
public class OrdersController {

    private final OrdersService orders;

    public OrdersController(OrdersService orders) {
        this.orders = orders;
    }

    @PostMapping
    public Map<String, Object> place(Authentication auth, @Valid @RequestBody CreateOrderRequest request) {
        return orders.place(auth.getName(), request);
    }

    /** Buyer order history — most recent first. */
    @GetMapping
    public List<Map<String, Object>> mine(
            Authentication auth, @RequestParam(required = false) String status) {
        return orders.listForBuyer(auth.getName(), status);
    }

    @GetMapping("/{id}")
    public OrderDetailResponse detail(Authentication auth, @PathVariable String id) {
        return orders.detail(auth.getName(), id);
    }

    @PostMapping("/{id}/cancel")
    public Map<String, Object> cancel(Authentication auth, @PathVariable String id) {
        return orders.cancel(auth.getName(), id);
    }

    @PostMapping("/{id}/checkout")
    public Map<String, Object> checkout(Authentication auth, @PathVariable String id) {
        return orders.checkout(auth.getName(), id);
    }

    // ── Story 4.1: seller lifecycle transitions ───────────────────────────────

    @PostMapping("/{id}/accept")
    @PreAuthorize("hasRole('SELLER')")
    public Map<String, Object> accept(Authentication auth, @PathVariable String id) {
        return orders.transition(auth.getName(), id, "accepted");
    }

    @PostMapping("/{id}/decline")
    @PreAuthorize("hasRole('SELLER')")
    public Map<String, Object> decline(Authentication auth, @PathVariable String id) {
        return orders.transition(auth.getName(), id, "declined");
    }

    @PostMapping("/{id}/preparing")
    @PreAuthorize("hasRole('SELLER')")
    public Map<String, Object> preparing(Authentication auth, @PathVariable String id) {
        return orders.transition(auth.getName(), id, "preparing");
    }

    @PostMapping("/{id}/ready")
    @PreAuthorize("hasRole('SELLER')")
    public Map<String, Object> ready(Authentication auth, @PathVariable String id) {
        return orders.transition(auth.getName(), id, "ready");
    }

    @PostMapping("/{id}/complete")
    @PreAuthorize("hasRole('SELLER')")
    public Map<String, Object> complete(Authentication auth, @PathVariable String id) {
        return orders.transition(auth.getName(), id, "completed");
    }
}

/** Story 4.1 — seller order dashboard listing, kept beside the kitchens routes. */
@RestController
class KitchenOrdersController {

    private final OrdersService orders;

    KitchenOrdersController(OrdersService orders) {
        this.orders = orders;
    }

    @GetMapping("/kitchens/{kitchenId}/orders")
    @PreAuthorize("hasRole('SELLER')")
    public List<Map<String, Object>> list(
            Authentication auth, @PathVariable String kitchenId, @RequestParam(required = false) String status) {
        return orders.listForKitchen(auth.getName(), kitchenId, status);
    }
}

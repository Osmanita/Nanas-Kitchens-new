package com.nanaskitchens.api.chat.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import java.util.List;

public record ChatRequest(@NotEmpty @Valid List<ChatMessage> messages, Location location) {

    /** Browser geolocation, sent only when the buyer has explicitly granted permission. */
    public record Location(Double lat, Double lng) {
        public boolean isUsable() {
            return lat != null && lng != null
                    && lat >= -90 && lat <= 90
                    && lng >= -180 && lng <= 180;
        }
    }
}

package com.nanaskitchens.api.auth.dto;

import jakarta.validation.constraints.Pattern;

public record UpdateMeRequest(
        // Loose E.164-ish check — sellers/buyers type this by hand, don't over-validate.
        @Pattern(regexp = "^$|^[+0-9 ()-]{7,20}$", message = "INVALID_PHONE") String phone) {
}

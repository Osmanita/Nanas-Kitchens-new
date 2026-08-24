package com.nanaskitchens.api.auth.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record RegisterRequest(
        @Email @NotBlank String email,
        @NotBlank @Size(min = 8) String password,
        // Only self-serve roles; inspector/admin are assigned by an admin (mirrors AC2).
        // @NotBlank as well as @Pattern: jakarta treats null as valid for @Pattern, so a
        // request with no role passed validation and then failed further down as a 500.
        @NotBlank @Pattern(regexp = "buyer|seller") String role) {
}

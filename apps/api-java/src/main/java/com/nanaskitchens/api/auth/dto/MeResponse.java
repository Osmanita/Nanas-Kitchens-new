package com.nanaskitchens.api.auth.dto;

import com.nanaskitchens.api.common.Role;

public record MeResponse(String id, String email, Role role, String phone) {
}

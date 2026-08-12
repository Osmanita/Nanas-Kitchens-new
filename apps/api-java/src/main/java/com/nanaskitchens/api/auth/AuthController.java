package com.nanaskitchens.api.auth;

import com.nanaskitchens.api.auth.dto.LoginRequest;
import com.nanaskitchens.api.auth.dto.MeResponse;
import com.nanaskitchens.api.auth.dto.RefreshRequest;
import com.nanaskitchens.api.auth.dto.RegisterRequest;
import com.nanaskitchens.api.auth.dto.TokenPairResponse;
import com.nanaskitchens.api.auth.dto.UpdateMeRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/auth")
public class AuthController {

    private final AuthService authService;
    private final UserRepository users;

    public AuthController(AuthService authService, UserRepository users) {
        this.authService = authService;
        this.users = users;
    }

    @PostMapping("/register")
    public TokenPairResponse register(@Valid @RequestBody RegisterRequest request) {
        return authService.register(request.email(), request.password(), request.role());
    }

    @PostMapping("/login")
    public TokenPairResponse login(@Valid @RequestBody LoginRequest request) {
        return authService.login(request.email(), request.password());
    }

    @PostMapping("/refresh")
    public TokenPairResponse refresh(@Valid @RequestBody RefreshRequest request) {
        return authService.refresh(request.refreshToken());
    }

    /** Own account (any role) — currently just email/role/phone; phone is editable below. */
    @GetMapping("/me")
    public MeResponse me(Authentication auth) {
        User u = users.findById(auth.getName())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        return new MeResponse(u.getId(), u.getEmail(), u.getRole(), u.getPhone());
    }

    @PatchMapping("/me")
    public MeResponse updateMe(Authentication auth, @Valid @RequestBody UpdateMeRequest request) {
        User u = users.findById(auth.getName())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (request.phone() != null) {
            u.setPhone(request.phone().isBlank() ? null : request.phone().trim());
        }
        users.save(u);
        return new MeResponse(u.getId(), u.getEmail(), u.getRole(), u.getPhone());
    }
}

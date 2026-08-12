package com.nanaskitchens.api.security;

import static org.assertj.core.api.Assertions.assertThat;

import com.nanaskitchens.api.common.Role;
import io.jsonwebtoken.Claims;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class JwtServiceTest {

    // >= 32 bytes, matches the HS256 key-length guard in JwtService's constructor.
    private static final String SECRET = "test-only-secret-key-at-least-32-bytes!!";

    @Test
    void issuedTokenParsesBackToTheSameUserAndRole() {
        JwtService jwt = new JwtService(SECRET, 480);
        String userId = UUID.randomUUID().toString();

        String token = jwt.issueAccessToken(userId, Role.seller);
        Optional<Claims> claims = jwt.parseClaims(token);

        assertThat(claims).isPresent();
        assertThat(claims.get().getSubject()).isEqualTo(userId);
        assertThat(claims.get().get("role", String.class)).isEqualTo("seller");
    }

    @Test
    void expiredTokenFailsToParse() {
        // Negative TTL backdates expiration below "now", so the freshly issued token is
        // already expired the instant it's parsed — exercises the expiry path without sleeping.
        JwtService jwt = new JwtService(SECRET, -1);
        String token = jwt.issueAccessToken(UUID.randomUUID().toString(), Role.buyer);

        assertThat(jwt.parseClaims(token)).isEmpty();
    }

    @Test
    void garbageTokenFailsToParse() {
        JwtService jwt = new JwtService(SECRET, 480);
        assertThat(jwt.parseClaims("not.a.jwt")).isEmpty();
    }

    @Test
    void tokenSignedWithADifferentSecretIsRejected() {
        JwtService issuer = new JwtService(SECRET, 480);
        JwtService verifier = new JwtService("a-completely-different-32-byte-secret!!", 480);

        String token = issuer.issueAccessToken(UUID.randomUUID().toString(), Role.admin);

        assertThat(verifier.parseClaims(token)).isEmpty();
    }

    @Test
    void constructorRejectsSecretsShorterThan32Bytes() {
        org.junit.jupiter.api.Assertions.assertThrows(
                IllegalStateException.class, () -> new JwtService("too-short", 480));
    }
}

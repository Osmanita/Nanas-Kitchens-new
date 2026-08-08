package com.nanaskitchens.api.config;

import com.nanaskitchens.api.security.JwtAuthenticationFilter;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    private final JwtAuthenticationFilter jwtAuthenticationFilter;
    private final List<String> corsAllowedOriginPatterns;

    public SecurityConfig(
            JwtAuthenticationFilter jwtAuthenticationFilter,
            @Value("${app.cors.allowed-origin-patterns:http://localhost:*}") List<String> corsAllowedOriginPatterns) {
        this.jwtAuthenticationFilter = jwtAuthenticationFilter;
        this.corsAllowedOriginPatterns = corsAllowedOriginPatterns;
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http.csrf(csrf -> csrf.disable())
                .cors(Customizer.withDefaults())
                .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        // SSE streaming (chat) ends with an ASYNC re-dispatch through this filter
                        // chain; the original REQUEST dispatch was already authorized, and denying
                        // here aborts the committed response mid-stream.
                        .dispatcherTypeMatchers(jakarta.servlet.DispatcherType.ASYNC)
                        .permitAll()
                        .requestMatchers("/", "/health", "/error", "/auth/register", "/auth/login", "/auth/refresh")
                        .permitAll()
                        // search / public profile / published menu are public, like the NestJS service;
                        // seller endpoints under /kitchens/{id}/... (dishes, menu-days) stay authenticated
                        .requestMatchers(org.springframework.http.HttpMethod.GET,
                                "/kitchens/search", "/kitchens/*", "/kitchens/*/menu",
                                "/kitchens/*/portions/stream", "/kitchens/*/reviews", "/kitchens/*/polls",
                                "/kitchens/*/health-reports", "/files/*",
                                // courier tracking links are opened by people who are not logged in;
                                // DeliveryController exposes progress only, no buyer identity or address
                                "/track/*")
                        .permitAll()
                        // partner callbacks authenticate via their own signatures, not JWT
                        // (delivery: HMAC; stripe: Stripe-Signature header)
                        .requestMatchers(org.springframework.http.HttpMethod.POST,
                                "/webhooks/delivery/*", "/webhooks/stripe")
                        .permitAll()
                        .anyRequest()
                        .authenticated())
                .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }

    /** Browser clients (Next.js web, KMP dev shells) call from other localhost ports in dev. */
    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOriginPatterns(corsAllowedOriginPatterns);
        config.setAllowedMethods(List.of("GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("Authorization", "Content-Type"));
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8();
    }
}

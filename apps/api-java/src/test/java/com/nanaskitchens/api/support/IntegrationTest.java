package com.nanaskitchens.api.support;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * Base class for tests that need the real schema and PostGIS functions (ST_DWithin,
 * ST_MakePoint, ...) the raw-SQL service layer relies on — an in-memory/H2 substitute
 * would silently pass tests that production would fail. One container is shared across
 * every subclass in the JVM (started once in the static initializer) to keep the suite fast.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
public abstract class IntegrationTest {

    protected static final PostgreSQLContainer<?> POSTGRES;

    static {
        POSTGRES = new PostgreSQLContainer<>(
                DockerImageName.parse("postgis/postgis:16-3.4").asCompatibleSubstituteFor("postgres"))
                .withDatabaseName("culture_eats_test")
                .withUsername("culture")
                .withPassword("culture");
        POSTGRES.start();
        try (Connection connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())) {
            MigrationRunner.applyAll(connection);
        } catch (SQLException e) {
            throw new IllegalStateException("Could not connect to the test container to run migrations", e);
        }
    }

    @DynamicPropertySource
    static void datasourceProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> POSTGRES.getJdbcUrl() + "?stringtype=unspecified");
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        // Eagerly constructed at context startup (see GoogleGenAiChatAutoConfiguration) but
        // never actually called by the order/kitchen-search flows these tests exercise.
        registry.add("spring.ai.google.genai.api-key", () -> "test-key-not-real");
        registry.add("app.menus.daily-rollover", () -> "false");
        // app.jwt.secret and app.address-enc-key deliberately have no defaults in
        // application.yml (a committed fallback secret is a real hole), so the test
        // context supplies its own. JwtService requires at least 32 bytes.
        registry.add("app.jwt.secret", () -> "integration-test-jwt-secret-32-bytes-min");
        registry.add("app.address-enc-key", () -> "integration-test-address-enc-key-32b");
        registry.add("app.delivery.provider", () -> "mock");
        registry.add("app.payments.provider", () -> "mock");
    }
}

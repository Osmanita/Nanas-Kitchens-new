package com.nanaskitchens.api.support;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * Base class for tests that need the real schema and PostGIS functions (ST_DWithin,
 * ST_MakePoint, ...) the raw-SQL service layer relies on — an in-memory/H2 substitute
 * would silently pass tests that production would fail. The database is prepared once per
 * JVM (static initializer) and shared by every subclass to keep the suite fast.
 *
 * <p>Two ways to get that database:
 *
 * <ul>
 *   <li><b>TEST_DATABASE_URL</b> — an already-running Postgres+PostGIS. This is the path CI
 *       uses (service container) and the one that works on a Windows box where Docker
 *       Desktop's named pipes answer the {@code docker} CLI but not docker-java, which is
 *       what Testcontainers needs (see CLAUDE.md). Locally: {@code docker compose up -d},
 *       then point it at a scratch database on that same server.
 *   <li><b>Testcontainers</b> — the default when the variable is unset.
 * </ul>
 *
 * <p>The external path wipes {@code schema public} before replaying the migrations, so it
 * refuses any database whose name does not end in {@code _test}. Losing the dev database to
 * a mistyped URL is not a risk worth carrying for a bit of convenience.
 */
// MOCK (the default), not NONE: SecurityConfig declares a SecurityFilterChain bean taking
// HttpSecurity, and the only thing that defines HttpSecurity is @EnableWebSecurity, applied by
// ServletWebSecurityAutoConfiguration under @ConditionalOnWebApplication(SERVLET). With NONE the
// context is not a web application, that autoconfiguration is skipped, and every integration test
// dies at refresh with "no qualifying bean of type HttpSecurity". MOCK builds a servlet context
// over MockServletContext and binds no port.
@SpringBootTest
public abstract class IntegrationTest {

    /** The address key the whole test context shares — TestData encrypts fixtures with it. */
    public static final String ADDRESS_ENC_KEY = "integration-test-address-enc-key-32b";

    private static final String JDBC_URL;
    private static final String USERNAME;
    private static final String PASSWORD;

    static {
        String externalUrl = System.getenv("TEST_DATABASE_URL");
        if (externalUrl != null && !externalUrl.isBlank()) {
            requireTestDatabaseName(externalUrl);
            JDBC_URL = externalUrl;
            USERNAME = envOrDefault("TEST_DATABASE_USER", "culture");
            PASSWORD = envOrDefault("TEST_DATABASE_PASSWORD", "culture");
        } else {
            PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>(
                    DockerImageName.parse("postgis/postgis:16-3.4").asCompatibleSubstituteFor("postgres"))
                    .withDatabaseName("culture_eats_test")
                    .withUsername("culture")
                    .withPassword("culture");
            postgres.start();
            JDBC_URL = postgres.getJdbcUrl();
            USERNAME = postgres.getUsername();
            PASSWORD = postgres.getPassword();
        }
        try (Connection connection = DriverManager.getConnection(JDBC_URL, USERNAME, PASSWORD)) {
            if (externalUrl != null && !externalUrl.isBlank()) {
                resetSchema(connection);
            }
            MigrationRunner.applyAll(connection);
        } catch (SQLException e) {
            throw new IllegalStateException("Could not prepare the test database at " + JDBC_URL, e);
        }
    }

    private static String envOrDefault(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }

    /** A container is disposable; someone else's database is not. */
    private static void requireTestDatabaseName(String jdbcUrl) {
        String path = jdbcUrl.split("\\?", 2)[0];
        String database = path.substring(path.lastIndexOf('/') + 1);
        if (!database.endsWith("_test")) {
            throw new IllegalStateException(
                    "TEST_DATABASE_URL must point at a database whose name ends in '_test' (got '"
                            + database + "') — the schema is dropped before every run.");
        }
    }

    private static void resetSchema(Connection connection) throws SQLException {
        try (Statement statement = connection.createStatement()) {
            // The migrations are the full history from an empty database, so replaying them
            // over last run's tables would fail on the first CREATE TABLE.
            statement.execute("DROP SCHEMA IF EXISTS public CASCADE");
            statement.execute("CREATE SCHEMA public");
        }
    }

    @DynamicPropertySource
    static void datasourceProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> JDBC_URL + "?stringtype=unspecified");
        registry.add("spring.datasource.username", () -> USERNAME);
        registry.add("spring.datasource.password", () -> PASSWORD);
        // Eagerly constructed at context startup (see GoogleGenAiChatAutoConfiguration) but
        // never actually called by the order/kitchen-search flows these tests exercise.
        registry.add("spring.ai.google.genai.api-key", () -> "test-key-not-real");
        registry.add("app.menus.daily-rollover", () -> "false");
        // app.jwt.secret and app.address-enc-key deliberately have no defaults in
        // application.yml (a committed fallback secret is a real hole), so the test
        // context supplies its own. JwtService requires at least 32 bytes.
        registry.add("app.jwt.secret", () -> "integration-test-jwt-secret-32-bytes-min");
        registry.add("app.address-enc-key", () -> ADDRESS_ENC_KEY);
        registry.add("app.delivery.webhook-secret", () -> "integration-test-delivery-webhook-secret");
        registry.add("app.delivery.provider", () -> "mock");
        registry.add("app.payments.provider", () -> "mock");
    }
}

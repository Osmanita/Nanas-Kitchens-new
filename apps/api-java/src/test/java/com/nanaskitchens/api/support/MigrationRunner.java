package com.nanaskitchens.api.support;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Stream;

/**
 * Replays the Prisma-owned migration files (apps/api/prisma/migrations/*&#47;migration.sql)
 * against a fresh test database, in the same folder order Prisma itself would apply them.
 * Schema/migrations are Prisma's source of truth (see CLAUDE.md) — tests must use the exact
 * same DDL production runs on, not a hand-maintained copy that can drift.
 */
public final class MigrationRunner {

    private MigrationRunner() {
    }

    // apps/api-java is Maven's working directory for `mvn test`; migrations live in the
    // sibling NestJS package that still owns the Prisma schema.
    private static final Path MIGRATIONS_DIR = Path.of("../api/prisma/migrations");

    public static void applyAll(Connection connection) {
        List<Path> migrationFiles;
        try (Stream<Path> dirs = Files.list(MIGRATIONS_DIR)) {
            migrationFiles = dirs.filter(Files::isDirectory)
                    .sorted(Comparator.comparing(Path::getFileName))
                    .map(dir -> dir.resolve("migration.sql"))
                    .filter(Files::exists)
                    .toList();
        } catch (IOException e) {
            throw new UncheckedIOException("Could not list " + MIGRATIONS_DIR.toAbsolutePath(), e);
        }
        if (migrationFiles.isEmpty()) {
            throw new IllegalStateException("No migrations found under " + MIGRATIONS_DIR.toAbsolutePath()
                    + " — is the test running from apps/api-java?");
        }
        try (Statement statement = connection.createStatement()) {
            for (Path file : migrationFiles) {
                String sql = Files.readString(file);
                for (String stmt : sql.split(";")) {
                    String trimmed = stmt.strip();
                    if (!trimmed.isEmpty()) {
                        statement.execute(trimmed);
                    }
                }
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        } catch (SQLException e) {
            throw new IllegalStateException("Migration replay failed", e);
        }
    }
}

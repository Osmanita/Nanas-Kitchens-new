package com.nanaskitchens.api.support;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
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
                for (String stmt : splitStatements(Files.readString(file))) {
                    try {
                        statement.execute(stmt);
                    } catch (SQLException e) {
                        throw new IllegalStateException("Migration replay failed in " + file + ": " + stmt, e);
                    }
                }
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        } catch (SQLException e) {
            throw new IllegalStateException("Migration replay failed", e);
        }
    }

    /**
     * Splits a migration file into executable statements on top-level semicolons only.
     * A plain {@code sql.split(";")} also cuts inside comments and literals — 0003_reviews'
     * header comment contains a semicolon, which used to hand Postgres the fragment
     * {@code Kitchen.ratingAvg...} — so every construct that can legally contain a ';' is
     * consumed whole here instead.
     */
    static List<String> splitStatements(String sql) {
        List<String> statements = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        // Comment-only (or empty) trailing text is not a statement; tracking whether anything
        // executable was seen is cheaper than re-scanning the buffer to find out.
        boolean hasCode = false;
        int i = 0;
        while (i < sql.length()) {
            char c = sql.charAt(i);
            int dollarBody = c == '$' ? dollarQuotedEnd(sql, i) : -1;
            int end;
            if (c == '-' && i + 1 < sql.length() && sql.charAt(i + 1) == '-') {
                end = sql.indexOf('\n', i);
                end = end < 0 ? sql.length() : end;
            } else if (c == '/' && i + 1 < sql.length() && sql.charAt(i + 1) == '*') {
                end = blockCommentEnd(sql, i);
            } else if (c == '\'' || c == '"') {
                end = quotedEnd(sql, i, c, c == '\'' && isEscapeStringPrefix(sql, i));
                hasCode = true;
            } else if (dollarBody > 0) {
                end = dollarBody;
                hasCode = true;
            } else if (c == ';') {
                if (hasCode) {
                    statements.add(current.toString().strip());
                }
                current.setLength(0);
                hasCode = false;
                i++;
                continue;
            } else {
                current.append(c);
                hasCode |= !Character.isWhitespace(c);
                i++;
                continue;
            }
            current.append(sql, i, end);
            i = end;
        }
        if (hasCode) {
            statements.add(current.toString().strip());
        }
        return statements;
    }

    // Postgres block comments nest: the first */ inside /* /* */ */ does not close the comment.
    private static int blockCommentEnd(String sql, int start) {
        int depth = 0;
        int i = start;
        while (i < sql.length()) {
            if (sql.startsWith("/*", i)) {
                depth++;
                i += 2;
            } else if (sql.startsWith("*/", i)) {
                depth--;
                i += 2;
                if (depth == 0) {
                    return i;
                }
            } else {
                i++;
            }
        }
        // Unterminated: let Postgres report it rather than guessing where the statement ended.
        return sql.length();
    }

    // A doubled quote ('' or "") is an escaped quote, not the end of the literal. Backslash
    // escapes only apply to E'...' — with standard_conforming_strings on, a lone backslash in
    // a plain literal is just a backslash.
    private static int quotedEnd(String sql, int start, char quote, boolean backslashEscapes) {
        int i = start + 1;
        while (i < sql.length()) {
            char c = sql.charAt(i);
            if (backslashEscapes && c == '\\') {
                i += 2;
            } else if (c != quote) {
                i++;
            } else if (i + 1 < sql.length() && sql.charAt(i + 1) == quote) {
                i += 2;
            } else {
                return i + 1;
            }
        }
        return sql.length();
    }

    private static boolean isEscapeStringPrefix(String sql, int quoteIndex) {
        if (quoteIndex == 0 || Character.toUpperCase(sql.charAt(quoteIndex - 1)) != 'E') {
            return false;
        }
        // Only a standalone E prefixes an escape string; the E ending an identifier like TABLE
        // belongs to that word.
        return quoteIndex < 2 || !isTagChar(sql.charAt(quoteIndex - 2));
    }

    /**
     * Index just past a {@code $$ ... $$} / {@code $tag$ ... $tag$} body, or -1 when this '$'
     * opens no such body — {@code $1} placeholders and stray dollars must fall through.
     */
    private static int dollarQuotedEnd(String sql, int start) {
        int i = start + 1;
        while (i < sql.length() && isTagChar(sql.charAt(i))) {
            if (i == start + 1 && Character.isDigit(sql.charAt(i))) {
                return -1;
            }
            i++;
        }
        if (i >= sql.length() || sql.charAt(i) != '$') {
            return -1;
        }
        String tag = sql.substring(start, i + 1);
        int end = sql.indexOf(tag, i + 1);
        return end < 0 ? sql.length() : end + tag.length();
    }

    private static boolean isTagChar(char c) {
        return c == '_' || Character.isLetterOrDigit(c);
    }
}

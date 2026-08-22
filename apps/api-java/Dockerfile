# syntax=docker/dockerfile:1
#
# Spring Boot API (:8080) — the primary backend.
#
# Build from the REPO ROOT, not from this directory:
#   docker build -f apps/api-java/Dockerfile -t nanas/api-java .
#
# Health check for the ALB target group / ECS container healthCheck: GET /health
# (public in SecurityConfig, no auth needed).

# ---------- build ----------
# Uses the repo's own mvnw rather than a maven:* image so the Maven version matches
# CI and local exactly.
#
# Invoked as `sh ./mvnw`, not `./mvnw`, on purpose: the build context is the working
# tree, and a Windows working tree carries no POSIX execute bit. Going through sh also
# means the exec bit is irrelevant. The other half of that problem — CRLF line endings
# turning the shebang into "/bin/sh\r" — is fixed in .gitattributes, and `sh` would not
# have saved us from it.
FROM eclipse-temurin:21-jdk AS build
WORKDIR /build

COPY apps/api-java/.mvn/ .mvn/
COPY apps/api-java/mvnw apps/api-java/pom.xml ./
COPY apps/api-java/src/ src/

# The cache mount keeps ~/.m2 across local rebuilds. It is a no-op on a cold CI/ECR
# builder, which just re-resolves — correct either way.
# Tests are skipped on purpose: CI already runs them (including *IntegrationTest against
# a postgis service container) and the image build must not depend on a database.
RUN --mount=type=cache,target=/root/.m2 sh ./mvnw -B -DskipTests package

# ---------- runtime ----------
# Debian (noble) rather than Alpine on purpose: this app pulls in BouncyCastle and the
# Spring AI clients, and musl has a history of surprising native-lib edge cases. The
# extra ~40 MB is not worth debugging a glibc/musl difference in production.
FROM eclipse-temurin:21-jre-noble AS runtime

RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --create-home app

WORKDIR /app

# Only one jar is produced; *.jar deliberately does not match the .jar.original that
# spring-boot-maven-plugin leaves beside it.
COPY --from=build /build/target/*.jar app.jar

# STORAGE_PROVIDER=local writes here. It is EPHEMERAL per task on Fargate — uploads
# vanish on redeploy and are invisible to other tasks. Present so the local/dev path
# still works; switch to STORAGE_PROVIDER=s3 before this matters (E4).
RUN mkdir -p /app/uploads && chown app:app /app/uploads
ENV UPLOADS_DIR=/app/uploads

USER app
EXPOSE 8080

# MaxRAMPercentage instead of a fixed -Xmx: the JVM then sizes itself from the ECS task
# memory limit, so changing the task definition is enough — no image rebuild.
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "-jar", "/app/app.jar"]

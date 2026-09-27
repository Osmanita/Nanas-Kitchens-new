#!/usr/bin/env bash
# Disposable Linux-only container checks. All credentials here are isolated test fixtures.
set -euo pipefail
kind="${1:?web, api or migrate}"
image="${2:?image tag}"
prefix="nanas-smoke-$kind-$RANDOM"
scratch="$(mktemp -d)"
cleanup() {
  docker rm -f "$prefix-app" "$prefix-db" "$prefix-cache" >/dev/null 2>&1 || true
  docker network rm "$prefix" >/dev/null 2>&1 || true
  rm -f "$scratch/cert.pem" "$scratch/key.pem" "$scratch/trust.jks"
  rmdir "$scratch"
}
trap cleanup EXIT
image_user="$(docker image inspect --format '{{.Config.User}}' "$image")"
[[ -n "$image_user" && "$image_user" != root && "$image_user" != 0 ]]

check_health() {
  for _attempt in $(seq 1 90); do
    if curl --connect-timeout 2 --max-time 10 --fail --silent http://127.0.0.1:13000/health; then return 0; fi
    sleep 2
  done
  docker logs "$prefix-app"
  echo 'Container did not become ready' >&2
  return 1
}
if [[ "$kind" == web ]]; then
  docker run -d --name "$prefix-app" -p 127.0.0.1:13000:3000 "$image"
  check_health
  exit 0
fi

docker network create "$prefix" >/dev/null
# A private CA/hostname fixture exercises strict TLS instead of disabling verification.
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -keyout "$scratch/key.pem" \
  -out "$scratch/cert.pem" -subj "/CN=$prefix-db" \
  -addext "subjectAltName=DNS:$prefix-db,DNS:$prefix-cache" >/dev/null 2>&1
chmod 755 "$scratch"
chmod 644 "$scratch/cert.pem" "$scratch/key.pem"
docker run -d --name "$prefix-db" --network "$prefix" \
  -v "$scratch:/tls:ro" -e POSTGRES_USER=nanas_admin -e 'POSTGRES_PASSWORD=fixture:@/?#password' \
  -e POSTGRES_DB=culture_eats postgis/postgis:16-3.4 sh -c '
    cp /tls/cert.pem /tmp/server.crt; cp /tls/key.pem /tmp/server.key
    chown postgres:postgres /tmp/server.crt /tmp/server.key; chmod 600 /tmp/server.key
    exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tmp/server.crt -c ssl_key_file=/tmp/server.key'
db_ready=false
for _attempt in $(seq 1 60); do
  if docker exec "$prefix-db" pg_isready -h 127.0.0.1 -U nanas_admin -d culture_eats >/dev/null; then
    db_ready=true; break
  fi
  sleep 2
done
test "$db_ready" = true || { docker logs "$prefix-db"; exit 1; }

if [[ "$kind" == migrate ]]; then
  docker run --rm --network "$prefix" -v "$scratch/cert.pem:/etc/ssl/certs/rds-ca-bundle.pem:ro" \
    -e "DB_HOST=$prefix-db" -e DB_USER=nanas_admin -e 'DB_PASSWORD=fixture:@/?#password' \
    -e DB_NAME=culture_eats -e APP_DB_PASSWORD=fixture-app-password "$image"
  docker exec -e PGPASSWORD=fixture-app-password "$prefix-db" \
    psql -h 127.0.0.1 -U nanas_app -d culture_eats -v ON_ERROR_STOP=1 -c 'SELECT count(*) FROM "User";'
  if docker exec -e PGPASSWORD=fixture-app-password "$prefix-db" \
    psql -h 127.0.0.1 -U nanas_app -d culture_eats -v ON_ERROR_STOP=1 -c 'CREATE TABLE forbidden (id int);'; then
    echo 'Application role unexpectedly has schema-management permission' >&2; exit 1
  fi
  exit 0
fi
[[ "$kind" == api ]] || { echo 'Unknown image kind' >&2; exit 1; }

docker run -d --name "$prefix-cache" --network "$prefix" -v "$scratch:/tls:ro" \
  redis:7-alpine redis-server --port 0 --tls-port 6379 --tls-cert-file /tls/cert.pem \
  --tls-key-file /tls/key.pem --tls-ca-cert-file /tls/cert.pem --tls-auth-clients no \
  --requirepass fixtureRedisPassword
docker run --rm --user 0 --entrypoint keytool -v "$scratch:/tls" "$image" \
  -importcert -noprompt -alias fixture -file /tls/cert.pem -keystore /tls/trust.jks -storepass changeit
chmod 644 "$scratch/trust.jks"
docker run -d --name "$prefix-app" --network "$prefix" -p 127.0.0.1:13000:8080 \
  -v "$scratch/cert.pem:/etc/ssl/certs/rds-ca-bundle.pem:ro" -v "$scratch/trust.jks:/tmp/trust.jks:ro" \
  -e 'JAVA_TOOL_OPTIONS=-Djavax.net.ssl.trustStore=/tmp/trust.jks -Djavax.net.ssl.trustStorePassword=changeit' \
  -e SPRING_PROFILES_ACTIVE=ecs -e "DB_HOST=$prefix-db" -e DB_USER=nanas_admin \
  -e 'DB_PASSWORD=fixture:@/?#password' -e "REDIS_HOST=$prefix-cache" -e REDIS_PASSWORD=fixtureRedisPassword \
  -e JWT_SECRET=fixture-jwt-signing-secret-32-characters \
  -e ADDRESS_ENC_KEY=fixture-address-secret-32-characters \
  -e DELIVERY_WEBHOOK_SECRET=fixture-delivery-secret-32-characters \
  -e GEMINI_API_KEY=fixture-not-a-real-ai-key -e STRIPE_SECRET_KEY=sk_test_fixture \
  -e STRIPE_PUBLISHABLE_KEY=pk_test_fixture -e STRIPE_WEBHOOK_SECRET=whsec_fixture \
  -e S3_BUCKET=fixture-not-a-real-bucket -e AWS_REGION=us-east-2 "$image"
check_health
# Readiness must fail when Redis disappears while process liveness remains healthy.
docker stop "$prefix-cache" >/dev/null
status="$(curl --max-time 10 --silent --output /dev/null --write-out '%{http_code}' http://127.0.0.1:13000/health)"
test "$status" = 503
curl --max-time 5 --fail --silent http://127.0.0.1:13000/health/live

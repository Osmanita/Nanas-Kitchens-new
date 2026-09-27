#!/usr/bin/env bash
# Exercises the release gate with fake AWS/Docker; never contacts an AWS account.
set -euo pipefail
deployment_script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy.sh"
scratch="$(mktemp -d)"
cleanup() {
  rm -f "$scratch/bin/aws" "$scratch/bin/docker" "$scratch/bin/git" \
    "$scratch/infra/ecs/foundation.yml" "$scratch/calls" "$scratch/result"
  rmdir "$scratch/bin" "$scratch/infra/ecs" "$scratch/infra" "$scratch"
}
trap cleanup EXIT
mkdir -p "$scratch/bin" "$scratch/infra/ecs"
touch "$scratch/infra/ecs/foundation.yml"
cat > "$scratch/bin/git" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == rev-parse ]]; then printf '%040d\n' 1; fi
exit 0
MOCK
cat > "$scratch/bin/docker" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == login ]]; then cat >/dev/null; fi
if [[ "$1" == build && "$TEST_CASE" == build-failed ]]; then exit 1; fi
echo "docker $*" >> "$TEST_CALLS"
MOCK
cat > "$scratch/bin/aws" <<'MOCK'
#!/usr/bin/env bash
echo "$*" >> "$TEST_CALLS"
case "$1 $2" in
  'acm describe-certificate') echo '{"Certificate":{"Status":"ISSUED","SubjectAlternativeNames":["nanaskitchens.app","api.nanaskitchens.app","www.nanaskitchens.app"]}}' ;;
  'cloudformation describe-stacks')
    if [[ "$*" == *nanas-foundation-migration* ]]; then echo 'migration-task'; else
      echo '[{"OutputKey":"WebRepository","OutputValue":"registry/web"},{"OutputKey":"ApiRepository","OutputValue":"registry/api"},{"OutputKey":"MigrationRepository","OutputValue":"registry/migrate"},{"OutputKey":"Cluster","OutputValue":"cluster"},{"OutputKey":"PrivateSubnets","OutputValue":"subnet-a,subnet-b"},{"OutputKey":"MigrationSecurityGroup","OutputValue":"sg-migrate"},{"OutputKey":"LoadBalancerDns","OutputValue":"alb.example.test"}]'
    fi ;;
  'ecr get-login-password') echo 'fixture-token' ;;
  'ecr describe-images')
    if [[ "$TEST_CASE" == build-failed ]]; then exit 1; fi
    printf 'sha256:%064d\n' 1 ;;
  'ecs run-task')
    if [[ "$TEST_CASE" == launch-failed ]]; then echo '{"failures":[{"reason":"capacity"}],"tasks":[]}'
    else echo '{"failures":[],"tasks":[{"taskArn":"task-1"}]}'
    fi ;;
  'ecs describe-tasks')
    code=0; if [[ "$TEST_CASE" == migration-failed ]]; then code=1; fi
    printf '{"failures":[],"tasks":[{"lastStatus":"STOPPED","containers":[{"name":"migrate","exitCode":%d}]}]}\n' "$code" ;;
  'cloudformation deploy'|'ecs wait') ;;
  *) echo "Unexpected AWS call: $*" >&2; exit 1 ;;
esac
MOCK
chmod +x "$scratch/bin/"*
export PATH="$scratch/bin:$PATH" TEST_CALLS="$scratch/calls"
export CERTIFICATE_ARN='arn:aws:acm:us-east-2:123456789012:certificate/fixture'
export FOUNDATION_STACK=nanas-foundation DOMAIN_NAME=nanaskitchens.app
cd "$scratch"
for TEST_CASE in launch-failed migration-failed build-failed success; do
  export TEST_CASE
  : > "$TEST_CALLS"
  status=0
  bash "$deployment_script" > "$scratch/result" 2>&1 || status=$?
  if [[ "$TEST_CASE" == success ]]; then
    test "$status" -eq 0 || { cat "$scratch/result"; exit 1; }
    grep -q 'cloudformation deploy --stack-name nanas-foundation-app' "$TEST_CALLS"
  else
    test "$status" -ne 0
    if grep -q 'cloudformation deploy --stack-name nanas-foundation-app' "$TEST_CALLS"; then
      echo "Unsafe application rollout after $TEST_CASE" >&2; exit 1
    fi
  fi
  echo "Passed: $TEST_CASE"
done
cd /

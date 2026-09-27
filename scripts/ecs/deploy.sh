#!/usr/bin/env bash
# Run from the repository root in Bash (WSL/Git Bash/Linux). Creates/updates AWS services.
set -euo pipefail
export AWS_REGION="${AWS_REGION:-us-east-2}"
export AWS_DEFAULT_REGION="$AWS_REGION"
export AWS_PAGER=""
foundation="${FOUNDATION_STACK:-nanas-foundation}"
domain="${DOMAIN_NAME:-nanaskitchens.app}"
desired_count="${DESIRED_COUNT:-1}"
: "${CERTIFICATE_ARN:?Set CERTIFICATE_ARN to the issued ACM certificate in AWS_REGION}"
for command in aws docker jq git; do
  command -v "$command" >/dev/null || { echo "Missing tool: $command" >&2; exit 1; }
done
test -f infra/ecs/foundation.yml || { echo 'Run from the repository root.' >&2; exit 1; }
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo 'Commit tracked changes before publishing an image.' >&2; exit 1
fi
commit="$(git rev-parse HEAD)"
tag="${IMAGE_TAG:-${commit:0:12}-${domain//./-}}"
[[ "$tag" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$ ]] || { echo 'Invalid IMAGE_TAG' >&2; exit 1; }

certificate="$(aws acm describe-certificate --certificate-arn "$CERTIFICATE_ARN" --output json)"
echo "$certificate" | jq -e --arg domain "$domain" '
  .Certificate.Status == "ISSUED" and
  (.Certificate.SubjectAlternativeNames | index($domain) != null and
    ((index("*." + $domain) != null) or
     (index("api." + $domain) != null and index("www." + $domain) != null)))' >/dev/null || {
  echo 'Certificate must be issued and cover the apex, www and api hostnames.' >&2; exit 1;
}
outputs="$(aws cloudformation describe-stacks --stack-name "$foundation" --query 'Stacks[0].Outputs' --output json)"
output() { echo "$outputs" | jq -er --arg key "$1" '.[] | select(.OutputKey == $key) | .OutputValue'; }
web_repo="$(output WebRepository)"
api_repo="$(output ApiRepository)"
migrate_repo="$(output MigrationRepository)"
registry="${web_repo%%/*}"
aws ecr get-login-password | docker login --username AWS --password-stdin "$registry"

publish() {
  local repository="$1" dockerfile="$2" image_digest
  # Tags are immutable. Reuse a successfully published image on a retried deployment.
  image_digest="$(aws ecr describe-images --repository-name "${repository#*/}" \
    --image-ids "imageTag=$tag" --query 'imageDetails[0].imageDigest' --output text 2>/dev/null || true)"
  if [[ -z "$image_digest" || "$image_digest" == None ]]; then
    docker build --platform linux/amd64 -f "$dockerfile" \
      --label "org.opencontainers.image.revision=$commit" \
      --build-arg "NEXT_PUBLIC_API_URL=https://api.$domain" -t "$repository:$tag" . >&2 || return $?
    docker push "$repository:$tag" >&2 || return $?
    image_digest="$(aws ecr describe-images --repository-name "${repository#*/}" \
      --image-ids "imageTag=$tag" --query 'imageDetails[0].imageDigest' --output text)"
  fi
  [[ "$image_digest" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo 'Missing image digest' >&2; return 1; }
  printf '%s@%s' "$repository" "$image_digest"
}
web_image="$(publish "$web_repo" apps/web/Dockerfile)"
api_image="$(publish "$api_repo" apps/api-java/Dockerfile)"
migrate_image="$(publish "$migrate_repo" apps/api/Dockerfile.migrate)"

aws cloudformation deploy --stack-name "$foundation-migration" --template-file infra/ecs/migration.yml \
  --parameter-overrides "FoundationStack=$foundation" "MigrationImage=$migrate_image" \
  --no-fail-on-empty-changeset
task_definition="$(aws cloudformation describe-stacks --stack-name "$foundation-migration" \
  --query "Stacks[0].Outputs[?OutputKey=='TaskDefinition'].OutputValue | [0]" --output text)"
cluster="$(output Cluster)"
subnets="$(output PrivateSubnets)"
security_group="$(output MigrationSecurityGroup)"
network="$(jq -nc --arg subnets "$subnets" --arg sg "$security_group" \
  '{awsvpcConfiguration:{subnets:($subnets|split(",")),securityGroups:[$sg],assignPublicIp:"DISABLED"}}')"
run="$(aws ecs run-task --cluster "$cluster" --task-definition "$task_definition" \
  --launch-type FARGATE --platform-version 1.4.0 --network-configuration "$network" --output json)"
echo "$run" | jq -e '(.failures | length) == 0 and (.tasks | length) == 1' >/dev/null || {
  echo 'Migration could not start; application deployment stopped.' >&2; exit 1;
}
task="$(echo "$run" | jq -er '.tasks[0].taskArn')"
echo "Waiting for migration: $task"
aws ecs wait tasks-stopped --cluster "$cluster" --tasks "$task"
result="$(aws ecs describe-tasks --cluster "$cluster" --tasks "$task" --output json)"
echo "$result" | jq -e '(.failures | length) == 0 and .tasks[0].lastStatus == "STOPPED" and
  ([.tasks[0].containers[] | select(.name == "migrate")][0].exitCode == 0)' >/dev/null || {
  echo "Migration failed. Read /ecs/$foundation/migrate in CloudWatch. Application was not updated." >&2; exit 1;
}

# No application stack update is attempted unless the actual migration container exited 0.
aws cloudformation deploy --stack-name "$foundation-app" --template-file infra/ecs/application.yml \
  --parameter-overrides "FoundationStack=$foundation" "DomainName=$domain" \
    "CertificateArn=$CERTIFICATE_ARN" "WebImage=$web_image" "ApiImage=$api_image" "DesiredCount=$desired_count" \
  --no-fail-on-empty-changeset
echo "Services deployed. Point Cloudflare DNS to: $(output LoadBalancerDns)"
echo "Web: https://$domain | API: https://api.$domain"

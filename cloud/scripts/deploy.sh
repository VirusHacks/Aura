#!/usr/bin/env bash
# Deploys the AEROSCOPE CDK stacks with the AWS CLI only — no `cdk deploy`,
# no CDK bootstrap. Every change goes through a CloudFormation change set
# that is printed for review; nothing is applied without --execute.
#
#   scripts/deploy.sh                      # synth, upload assets, create + show change sets (no changes applied)
#   scripts/deploy.sh --execute Data       # apply the reviewed change set for Aeroscope-<stage>-Data
#   scripts/deploy.sh --execute App        # then the App stack (it imports values from Data)
#   STAGE=dev AWS_PROFILE=… scripts/deploy.sh
#
# Never deletes stacks, buckets or tables. Change sets that would remove or
# replace a resource are flagged in the summary.
set -euo pipefail
# Print AWS CLI output straight to the terminal (no interactive pager).
export AWS_PAGER=""

cd "$(dirname "$0")/.."
STAGE="${STAGE:-dev}"
EXECUTE=""
TARGET=""
if [[ "${1:-}" == "--execute" ]]; then
  EXECUTE=1
  TARGET="${2:?usage: deploy.sh --execute Data|App}"
fi

REGION="$(node -p "require('./cdk.json').context.stages['$STAGE'].region")"
BUCKET="$(node -p "require('./cdk.json').context.stages['$STAGE'].assetsBucket")"
STACKS=("Aeroscope-$STAGE-Data" "Aeroscope-$STAGE-App")
TAGS=(Key=Project,Value=AEROSCOPE "Key=Environment,Value=$STAGE" Key=ManagedBy,Value=AWS-CDK)
STATE_DIR="cdk.out/.changesets"

aws_() { aws --region "$REGION" "$@"; }

stack_status() {
  aws_ cloudformation describe-stacks --stack-name "$1" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NONE"
}

if [[ -n "$EXECUTE" ]]; then
  STACK="Aeroscope-$STAGE-$TARGET"
  CS_FILE="$STATE_DIR/$STACK"
  [[ -f "$CS_FILE" ]] || { echo "No reviewed change set for $STACK. Run scripts/deploy.sh first." >&2; exit 1; }
  CS="$(cat "$CS_FILE")"
  BEFORE="$(stack_status "$STACK")"
  echo "Executing $CS on $STACK ($BEFORE)…"
  aws_ cloudformation execute-change-set --stack-name "$STACK" --change-set-name "$CS"
  if [[ "$BEFORE" == "REVIEW_IN_PROGRESS" || "$BEFORE" == "NONE" ]]; then
    aws_ cloudformation wait stack-create-complete --stack-name "$STACK"
  else
    aws_ cloudformation wait stack-update-complete --stack-name "$STACK"
  fi
  rm -f "$CS_FILE"
  echo "$STACK: $(stack_status "$STACK")"
  aws_ cloudformation describe-stacks --stack-name "$STACK" --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output table
  exit 0
fi

echo "== Synthesizing (local only; no AWS calls)"
rm -rf cdk.out
CDK_OUTDIR=cdk.out CDK_CONTEXT_JSON="$(node -p "JSON.stringify({...require('./cdk.json').context, stage: '$STAGE'})")" \
  npx tsx bin/aeroscope.ts >/dev/null
mkdir -p "$STATE_DIR"

for STACK in "${STACKS[@]}"; do
  echo
  echo "== $STACK: uploading assets to s3://$BUCKET"
  # Each line: <source path> <packaging> <object key>
  node -e '
    const m = require(`./cdk.out/${process.argv[1]}.assets.json`);
    for (const f of Object.values(m.files)) {
      for (const d of Object.values(f.destinations)) console.log(f.source.path, f.source.packaging ?? "file", d.objectKey);
    }' "$STACK" | while read -r SRC PACKAGING KEY; do
    if aws_ s3api head-object --bucket "$BUCKET" --key "$KEY" >/dev/null 2>&1; then
      echo "   = $KEY (unchanged)"
      continue
    fi
    if [[ "$PACKAGING" == "zip" ]]; then
      ZIP="$(mktemp -t aeroscope).zip"
      (cd "cdk.out/$SRC" && zip -qr -X "$ZIP" .)
      aws_ s3 cp "$ZIP" "s3://$BUCKET/$KEY" --only-show-errors
      rm -f "$ZIP"
    else
      aws_ s3 cp "cdk.out/$SRC" "s3://$BUCKET/$KEY" --only-show-errors
    fi
    echo "   + $KEY"
  done

  TEMPLATE_KEY="aeroscope-cdk/$STAGE/templates/$STACK-$(shasum -a 256 "cdk.out/$STACK.template.json" | cut -c1-16).json"
  aws_ s3 cp "cdk.out/$STACK.template.json" "s3://$BUCKET/$TEMPLATE_KEY" --only-show-errors
  TEMPLATE_URL="https://$BUCKET.s3.$REGION.amazonaws.com/$TEMPLATE_KEY"

  STATUS="$(stack_status "$STACK")"
  if [[ "$STATUS" == "ROLLBACK_COMPLETE" ]]; then
    echo "   $STACK failed to create and was rolled back (it holds no resources). Remove the empty stack, then re-run:"
    echo "     aws cloudformation delete-stack --stack-name $STACK --region $REGION && aws cloudformation wait stack-delete-complete --stack-name $STACK --region $REGION"
    continue
  fi
  TYPE=UPDATE
  [[ "$STATUS" == "NONE" || "$STATUS" == "REVIEW_IN_PROGRESS" ]] && TYPE=CREATE
  if [[ "$TYPE" == "CREATE" && "$STACK" == *-App ]] && [[ "$(stack_status "Aeroscope-$STAGE-Data")" != *COMPLETE ]]; then
    echo "   App stack waits for the Data stack: execute Data first, then re-run this script."
    continue
  fi
  CS="aeroscope-$(date -u +%Y%m%d%H%M%S)"
  echo "== $STACK: creating $TYPE change set $CS"
  aws_ cloudformation create-change-set \
    --stack-name "$STACK" --change-set-name "$CS" --change-set-type "$TYPE" \
    --template-url "$TEMPLATE_URL" \
    --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND \
    --tags "${TAGS[@]}" \
    --description "AEROSCOPE $STAGE deploy" >/dev/null
  if ! aws_ cloudformation wait change-set-create-complete --stack-name "$STACK" --change-set-name "$CS" 2>/dev/null; then
    REASON="$(aws_ cloudformation describe-change-set --stack-name "$STACK" --change-set-name "$CS" --query StatusReason --output text)"
    echo "   No change set: $REASON"
    aws_ cloudformation delete-change-set --stack-name "$STACK" --change-set-name "$CS" >/dev/null 2>&1 || true
    continue
  fi
  echo "$CS" > "$STATE_DIR/$STACK"
  aws_ cloudformation describe-change-set --stack-name "$STACK" --change-set-name "$CS" \
    --query 'Changes[].ResourceChange.[Action,LogicalResourceId,ResourceType,Replacement]' --output table
  RISKY="$(aws_ cloudformation describe-change-set --stack-name "$STACK" --change-set-name "$CS" \
    --query "length(Changes[?ResourceChange.Action=='Remove' || ResourceChange.Replacement=='True'])" --output text | head -1)"
  if [[ "$RISKY" != "0" ]]; then
    echo "   !! $RISKY change(s) REMOVE or REPLACE a resource. Review before executing."
  else
    echo "   No removals or replacements."
  fi
  echo "   Apply with: scripts/deploy.sh --execute ${STACK##*-}"
done

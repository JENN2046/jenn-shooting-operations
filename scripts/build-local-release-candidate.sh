#!/usr/bin/env bash
# Local-only exact Git source build. No push, service creation or production access.
set -euo pipefail
if [[ $# != 3 ]]; then
  echo 'Usage: build-local-release-candidate.sh <full-source-sha> <node-alpine-repo@sha256:digest> <new-output-directory>' >&2
  exit 2
fi
revision=$1
base=$2
output=$3
[[ $revision =~ ^[0-9a-f]{40}$ ]] || exit 2
[[ $base =~ ^node@sha256:[0-9a-f]{64}$ ]] || exit 2
repo=$(git rev-parse --show-toplevel)
[[ $(git -C "$repo" rev-parse "$revision^{commit}") == "$revision" ]] || exit 2
[[ ! -e $output ]] || { echo 'Output must be new; existing evidence is preserved.' >&2; exit 2; }
mkdir -p "$output"
output=$(cd "$output" && pwd)
context=$(mktemp -d)
trap 'rm -rf "$context"' EXIT
git -C "$repo" archive "$revision" > "$output/source.tar"
tar -xf "$output/source.tar" -C "$context"
[[ $(head -n 1 "$context/Dockerfile") == 'FROM node:24.21.0-alpine' ]] || exit 2
{ printf 'FROM %s\n' "$base"; tail -n +2 "$context/Dockerfile"; } > "$context/Dockerfile.candidate"
cp "$context/Dockerfile.candidate" "$output/Dockerfile.candidate"
epoch=$(git -C "$repo" show -s --format=%ct "$revision")
docker image inspect "$base" --format '{{.Os}}/{{.Architecture}}' > "$output/base-platform.txt"
docker build --platform linux/amd64 --provenance=false --build-arg "SOURCE_DATE_EPOCH=$epoch" \
  --label "org.opencontainers.image.revision=$revision" \
  --label 'org.opencontainers.image.source=https://github.com/JENN2046/jenn-shooting-operations' \
  --iidfile "$output/image-id.txt" -f "$context/Dockerfile.candidate" "$context" \
  > "$output/build.log" 2>&1
image=$(cat "$output/image-id.txt")
[[ $image =~ ^sha256:[0-9a-f]{64}$ ]] || exit 2
[[ $(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}') == "$revision" ]] || exit 2
tag="jenn-shooting-operations:prod-$revision"
existing=$(docker image inspect "$tag" --format '{{.Id}}' 2>/dev/null || true)
[[ -z $existing || $existing == "$image" ]] || { echo 'Existing diagnostic tag differs; refusing to overwrite.' >&2; exit 1; }
docker tag "$image" "$tag"
docker image inspect "$image" --format '{{json .}}' > "$output/image-inspect.json"
printf '%s\n' "$base" > "$output/base-reference.txt"
printf '%s\n' "$revision" > "$output/source-revision.txt"
git -C "$repo" rev-parse "$revision^{tree}" > "$output/source-tree.txt"
printf '%s\n' "$epoch" > "$output/source-date-epoch.txt"
printf '%s\n' "$tag" > "$output/diagnostic-tag.txt"
sha256sum "$output/source.tar" "$output/Dockerfile.candidate" > "$output/input-sha256.txt"
printf 'Local candidate: %s\nSource: %s\nDiagnostic tag: %s\n' "$image" "$revision" "$tag"

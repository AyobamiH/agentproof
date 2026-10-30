#!/bin/bash
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
E=/tmp/gaia-macos15-evidence
mkdir -p "$E"
on_exit() {
  rc=$?
  if [ "$rc" -ne 0 ]; then
    printf 'GAIA MACOS ARM64 FREEZE DID NOT PASS: exit=%s\n' "$rc" | tee "$E/failure.txt"
  fi
}
trap on_exit EXIT

echo "=== CircleCI environment ==="
uname -s
uname -m
sw_vers -productVersion
xcodebuild -version
test "$(uname -s)" = Darwin
test "$(uname -m)" = arm64
sw_vers -productVersion | grep -E '^15\.'
test -n "$GAIA_EXPECTED_SHA"
test -n "$GAIA_REF"

echo "=== Checkout exact GAIA contribution commit ==="
git clone --no-tags --depth 1 --single-branch --branch "$GAIA_REF" https://github.com/AyobamiH/gaia.git gaia
cd gaia
actual="$(git rev-parse HEAD)"
printf 'Git checkout SHA: %s\n' "$actual"
test "$actual" = "$GAIA_EXPECTED_SHA"
grep -A 4 -- '- os: macos-15' .github/workflows/build_flagship_sidecar.yml | grep 'platform: darwin-arm64'
test -z "$(git status --porcelain)"

echo "=== Install uv and Python 3.12 ==="
if ! command -v uv >/dev/null 2>&1; then
  brew install uv
fi
uv --version
uv python install 3.12
uv venv .venv-freeze --python 3.12
.venv-freeze/bin/python --version

echo "=== Install upstream frozen-binary dependency set ==="
uv pip install --python .venv-freeze \
  -e ".[api,rag,diarize,browser]" \
  -e hub/agents/gaia/python \
  anthropic \
  pandas \
  matplotlib \
  tiktoken \
  pyinstaller

PACKAGING=hub/agents/gaia/python/packaging
FREEZE_DIST="$PACKAGING/dist"
echo "=== Upstream PyInstaller freeze.py --onefile ==="
.venv-freeze/bin/python "$PACKAGING/freeze.py" --onefile
test -s "$FREEZE_DIST/gaia-agent"
echo "=== Confirm Mach-O arm64 binary ==="
file "$FREEZE_DIST/gaia-agent"
file "$FREEZE_DIST/gaia-agent" | grep -E 'Mach-O.*arm64'
lipo -archs "$FREEZE_DIST/gaia-agent" | grep -E '(^| )arm64($| )'

echo "=== Upstream smoke_test.py (the actual frozen binary) ==="
.venv-freeze/bin/python "$PACKAGING/smoke_test.py" "$FREEZE_DIST/gaia-agent"

echo "=== Compute release-compatible metadata ==="
.venv-freeze/bin/python - "$FREEZE_DIST/gaia-agent" "$E" "$GAIA_EXPECTED_SHA" <<'PY'
import hashlib,json,os,platform,subprocess,sys,datetime
binary,dest,sha=sys.argv[1:4]
with open(binary,'rb') as f:
    digest=hashlib.file_digest(f,'sha256').hexdigest()
size=os.path.getsize(binary)
report={
  'status':'PASS','source_repo':'AyobamiH/gaia',
  'upstream_pr':'https://github.com/amd/gaia/pull/6172',
  'source_sha':sha,'circleci_project':'gh/AyobamiH/agentproof',
  'harness_sha':os.environ.get('CIRCLE_SHA1',''),
  'circleci_job':os.environ.get('CIRCLE_JOB',''),
  'circleci_build_num':os.environ.get('CIRCLE_BUILD_NUM',''),
  'macos':subprocess.check_output(['sw_vers','-productVersion'],text=True).strip(),
  'machine':platform.machine(),'system':platform.system(),
  'python':subprocess.check_output(['.venv-freeze/bin/python','--version'],text=True).strip(),
  'artifact':'gaia-agent-darwin-arm64','sha256':digest,'size_bytes':size,
  'upstream_freeze':'hub/agents/gaia/python/packaging/freeze.py --onefile',
  'upstream_smoke':'hub/agents/gaia/python/packaging/smoke_test.py: PASS',
  'scope':'CircleCI genuine macOS 15 arm64 binary freeze; no release/production/publish; distinct from GitHub Actions job execution',
  'completed_utc':datetime.datetime.now(datetime.timezone.utc).isoformat()
}
with open(os.path.join(dest,'macos15-gaia-build-receipt.json'),'w') as f:json.dump(report,f,indent=2)
with open(os.path.join(dest,'sidecar-darwin-arm64.meta.json'),'w') as f:
    json.dump([{'component':'sidecar','platform':'darwin-arm64','filename':'gaia-agent-darwin-arm64','executable':'gaia-agent','sha256':digest,'size':size}],f,indent=2)
print(json.dumps(report,indent=2))
PY

size="$(stat -f %z "$FREEZE_DIST/gaia-agent")"
if [ "$size" -le 250000000 ];then
  cp "$FREEZE_DIST/gaia-agent" "$E/gaia-agent-darwin-arm64"
  echo "Binary copied to CircleCI artifacts"
else
  echo "Binary exceeds conservative artifact limit; hashes and smoke evidence retained" | tee "$E/artifact-size-policy.txt"
fi
echo '=== GAIA MACOS ARM64 FREEZE AND SMOKE: PASS ==='

#!/bin/bash
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
E=/tmp/gaia-email-macos15-evidence
mkdir -p "$E"
on_exit() {
  rc=$?
  if [ "$rc" -ne 0 ]; then
    printf 'GAIA EMAIL MACOS ARM64 FREEZE DID NOT PASS: exit=%s\n' "$rc" | tee "$E/failure.txt"
  fi
}
trap on_exit EXIT

echo "=== CircleCI genuine macOS 15 arm64 executor ==="
uname -s
uname -m
sw_vers -productVersion
xcodebuild -version
test "$(uname -s)" = Darwin
test "$(uname -m)" = arm64
sw_vers -productVersion | grep -E '^15\.'

echo "=== Exact GAIA PR #6172 source checkout ==="
git clone --no-tags --depth 1 --single-branch --branch "$GAIA_REF" https://github.com/AyobamiH/gaia.git gaia
cd gaia
test "$(git rev-parse HEAD)" = "$GAIA_EXPECTED_SHA"
grep -A 4 -- '- os: macos-15' .github/workflows/release_agent_email.yml | grep 'platform: darwin-arm64'
test -z "$(git status --porcelain)"
echo "Pinned source commit: $GAIA_EXPECTED_SHA"

echo "=== Upstream email-agent Python 3.12 + frozen dependency set ==="
if ! command -v uv >/dev/null 2>&1; then
  brew install uv
fi
uv --version
uv python install 3.12
uv venv .venv-freeze --python 3.12
uv pip install --python .venv-freeze \
  -e ".[api]" -e hub/agents/email/python \
  "faiss-cpu>=1.7.0" tiktoken pyinstaller
.venv-freeze/bin/python --version

echo "=== Required email-agent runtime import chain ==="
.venv-freeze/bin/python -c "import gaia_agent_email.query_routes"
PACKAGING=hub/agents/email/python/packaging
FREEZE_DIST="$PACKAGING/dist"
echo "=== Upstream email freeze.py --onefile ==="
.venv-freeze/bin/python "$PACKAGING/freeze.py" --onefile
test -s "$FREEZE_DIST/email-agent"

echo "=== Verify Mach-O arm64 executable ==="
file "$FREEZE_DIST/email-agent"
file "$FREEZE_DIST/email-agent" | grep -E 'Mach-O.*arm64'
lipo -archs "$FREEZE_DIST/email-agent" | grep -E '(^| )arm64($| )'

echo "=== Upstream email smoke_test.py ==="
.venv-freeze/bin/python "$PACKAGING/smoke_test.py" "$FREEZE_DIST/email-agent"

echo "=== Prepare evidence and artifact hashes ==="
.venv-freeze/bin/python - "$FREEZE_DIST/email-agent" "$E" "$GAIA_EXPECTED_SHA" <<'PY'
import hashlib,json,os,platform,subprocess,sys,datetime
binary,dest,sha=sys.argv[1:4]
with open(binary,'rb') as f:
    digest=hashlib.file_digest(f,'sha256').hexdigest()
size=os.path.getsize(binary)
report={
  'status':'PASS',
  'source_repo':'AyobamiH/gaia',
  'upstream_pr':'https://github.com/amd/gaia/pull/6172',
  'source_sha':sha,
  'circleci_project':'gh/AyobamiH/agentproof',
  'harness_sha':os.environ.get('CIRCLE_SHA1',''),
  'circleci_job':os.environ.get('CIRCLE_JOB',''),
  'circleci_build_num':os.environ.get('CIRCLE_BUILD_NUM',''),
  'macos':subprocess.check_output(['sw_vers','-productVersion'],text=True).strip(),
  'machine':platform.machine(),
  'system':platform.system(),
  'python':subprocess.check_output(['.venv-freeze/bin/python','--version'],text=True).strip(),
  'artifact':'email-agent-darwin-arm64',
  'sha256':digest,'size_bytes':size,
  'upstream_import':'gaia_agent_email.query_routes: PASS',
  'upstream_freeze':'hub/agents/email/python/packaging/freeze.py --onefile',
  'upstream_smoke':'hub/agents/email/python/packaging/smoke_test.py: PASS',
  'scope':'CircleCI genuine macOS15 ARM64 email-agent freeze; no release, payment, production, or publish',
  'completed_utc':datetime.datetime.now(datetime.timezone.utc).isoformat()
}
with open(os.path.join(dest,'macos15-email-build-receipt.json'),'w') as f:json.dump(report,f,indent=2)
with open(os.path.join(dest,'email-sidecar-darwin-arm64.meta.json'),'w') as f:
 json.dump([{'platform':'darwin-arm64','filename':'email-agent-darwin-arm64','executable':'email-agent','sha256':digest,'size':size}],f,indent=2)
print(json.dumps(report,indent=2))
PY
size="$(stat -f %z "$FREEZE_DIST/email-agent")"
if [ "$size" -le 250000000 ];then
  cp "$FREEZE_DIST/email-agent" "$E/email-agent-darwin-arm64"
  echo "Email binary copied to CircleCI artifacts"
else
  echo "Email binary exceeds upload size policy; receipt and smoke retained" | tee "$E/artifact-size-policy.txt"
fi
echo '=== GAIA EMAIL MACOS ARM64 FREEZE AND SMOKE: PASS ==='

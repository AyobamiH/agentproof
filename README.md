# Isolated AMD GAIA macOS 15 release-build evidence harness

This temporary CircleCI-only orphan branch runs on the existing, connected
public CircleCI project gh/AyobamiH/agentproof, whose Free-plan m4pro.medium
macOS execution was independently demonstrated on 2026-10-29.

No AgentProof application files or .github/workflows are included. No changes
are made to protected main. No paid services, GitHub Actions or deployments.
The job clones the public GAIA contributor branch and asserts the exact SHA
4808ed81903ab226ea71a2d030b9dfdbba436a58 before freeze and smoke.

The job uses Xcode 16.4.0 (macOS 15.3.2, arm64), instead of the macOS 26 image
used for the older AgentProof canary. The build subprocess has a 2100-second
deadline, consuming at most about 7000 compute credits at 200 credits/minute,
under the 30000 Free monthly credits previously observed for this organisation.

Evidence: /tmp/gaia-macos15-evidence uploaded as CircleCI artifacts. A green
CircleCI job demonstrates the actual frozen ARM64 binary and smoke test on
macOS 15, not the upstream GitHub Actions workflow or a release.

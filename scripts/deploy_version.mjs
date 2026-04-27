import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const frontendRoot = resolve(repoRoot, "frontend");
const packageJsonPath = resolve(frontendRoot, "package.json");
const deployVersionPath = resolve(frontendRoot, "app", "lib", "deploy-version.json");

// BEGIN DEPLOY_VERSION_FUNCTION_DO_NOT_TOUCH
// DO NOT TOUCH, MOVE, RENAME, OR REFORMAT THIS FUNCTION.
// It is intentionally protected by backend/tests/test_version_guard.py.
// It must remain stable so every Vercel deploy gets a unique visible version.
export function createDeployVersion({ baseVersion, now, commitSha, deploymentId, isDeploy }) {
  const buildDate = now.toISOString();
  if (!isDeploy) {
    return {
      version: baseVersion,
      buildDate,
      source: "local",
    };
  }

  const stamp = buildDate.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const sha = (commitSha || "no-sha").slice(0, 7);
  const deploy = (deploymentId || "deploy").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10);

  return {
    version: `${baseVersion}+deploy.${stamp}.${sha}.${deploy}`,
    buildDate,
    source: "vercel",
  };
}
// END DEPLOY_VERSION_FUNCTION_DO_NOT_TOUCH

function readBaseVersion() {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  return packageJson.version;
}

function writeDeployVersionFile(payload) {
  writeFileSync(deployVersionPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function main() {
  const isDeploy = process.env.VERCEL === "1" || process.env.MAINTAI_FORCE_DEPLOY_VERSION === "1";
  const shouldCreateLocalBase = !isDeploy && !existsSync(deployVersionPath);

  if (isDeploy || shouldCreateLocalBase) {
    const payload = createDeployVersion({
      baseVersion: readBaseVersion(),
      now: new Date(),
      commitSha: process.env.VERCEL_GIT_COMMIT_SHA,
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_URL,
      isDeploy,
    });

    writeDeployVersionFile(payload);
    console.log(`[deploy-version] ${payload.version}`);
  } else {
    console.log("[deploy-version] local build: versione deploy invariata");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// Cache the gh CLI token promise to avoid repeated subprocess calls
// and prevent concurrent duplicate invocations
let ghTokenPromise: Promise<string | null> | undefined;

/**
 * Resolve a GitHub token from environment variables or gh CLI
 * Priority: OPENSRC_GITHUB_TOKEN > GITHUB_TOKEN > GH_TOKEN > `gh auth token`
 */
export async function getGitHubToken(): Promise<string | null> {
  const envToken =
    process.env.OPENSRC_GITHUB_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN;

  if (envToken) {
    return envToken;
  }

  // Try gh CLI as fallback (promise cached for concurrent safety)
  if (!ghTokenPromise) {
    ghTokenPromise = getGhCliToken();
  }

  return ghTokenPromise;
}

/**
 * Resolve a GitLab token from environment variables
 * Priority: OPENSRC_GITLAB_TOKEN > GITLAB_TOKEN
 */
export async function getGitLabToken(): Promise<string | null> {
  // async for interface consistency with getGitHubToken
  return (
    process.env.OPENSRC_GITLAB_TOKEN || process.env.GITLAB_TOKEN || null
  );
}

/**
 * Get token for a given git host
 */
export async function getTokenForHost(
  host: string,
): Promise<string | null> {
  if (host === "github.com") {
    return getGitHubToken();
  }
  if (host === "gitlab.com") {
    return getGitLabToken();
  }
  return null;
}

/**
 * Rewrite an HTTPS clone URL to include authentication.
 * GitHub uses x-access-token, everything else uses oauth2.
 */
export function getAuthenticatedCloneUrl(
  repoUrl: string,
  token: string,
): string {
  const url = new URL(repoUrl);

  if (url.hostname === "github.com") {
    url.username = "x-access-token";
  } else {
    url.username = "oauth2";
  }
  url.password = token;

  return url.toString();
}

/**
 * Strip tokens from error messages to prevent leakage.
 * Handles both raw and URL-encoded forms of the token.
 */
export function sanitizeError(error: string, token: string): string {
  const encoded = encodeURIComponent(token);
  return error.replaceAll(token, "***").replaceAll(encoded, "***");
}

/**
 * Format a clone error with appropriate auth guidance
 */
export function formatCloneError(
  rawError: string | undefined,
  token: string | null,
  host: string,
): string {
  let error = rawError || "Clone failed";
  if (token) {
    error = sanitizeError(error, token);
  } else {
    error += `\n${getAuthHelpMessage(host)}`;
  }
  return error;
}

/**
 * Get a user-facing help message for authentication
 */
export function getAuthHelpMessage(host: string): string {
  if (host === "github.com") {
    return [
      "Authentication required for private repository. Either:",
      "  1. Set GITHUB_TOKEN environment variable",
      "  2. Install GitHub CLI and run: gh auth login",
      "  3. Set OPENSRC_GITHUB_TOKEN for opensrc-specific access",
    ].join("\n");
  }

  if (host === "gitlab.com") {
    return [
      "Authentication required for private repository. Either:",
      "  1. Set GITLAB_TOKEN environment variable",
      "  2. Set OPENSRC_GITLAB_TOKEN for opensrc-specific access",
    ].join("\n");
  }

  return "Authentication required for private repository. Set up credentials for this host.";
}

/**
 * Try to get a token from the gh CLI
 */
async function getGhCliToken(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("gh", ["auth", "token"], {
      timeout: 5000,
    });
    const token = stdout.trim();
    return token || null;
  } catch {
    return null;
  }
}

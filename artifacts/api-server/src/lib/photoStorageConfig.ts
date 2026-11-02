export class PhotoStorageConfigurationError extends Error {
  constructor() {
    super("Private photo storage configuration is missing or invalid.");
  }
}

// Only private storage is required here. Public asset paths are not a
// prerequisite for athlete uploads. Never include configured values in errors.
export function privatePhotoStorageLocation(env: NodeJS.ProcessEnv = process.env) {
  const dir = env.PRIVATE_OBJECT_DIR?.trim().replace(/\/+$/, "") ?? "";
  const match = /^\/([a-z0-9][a-z0-9._-]+)\/([a-zA-Z0-9/._-]+)$/.exec(dir);
  if (!match || match[2]!.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new PhotoStorageConfigurationError();
  }
  const publicPaths = (env.PUBLIC_OBJECT_SEARCH_PATHS ?? "").split(",")
    .map((path) => path.trim().replace(/\/+$/, "")).filter(Boolean);
  if (publicPaths.some((path) => dir === path || dir.startsWith(`${path}/`) || path.startsWith(`${dir}/`))) {
    throw new PhotoStorageConfigurationError();
  }
  return { dir, bucketName: match[1]!, prefix: `${match[2]!}/` };
}

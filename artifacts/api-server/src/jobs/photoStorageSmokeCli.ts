import { runPhotoStorageSmoke } from "../lib/photoStorageSmoke";

// Dedicated CLI entrypoint, never imported by API startup or health handlers.
try {
  const result = await runPhotoStorageSmoke();
  console.log(JSON.stringify({ check: "private-photo-storage", ...result }));
  if (result.status !== "passed") process.exitCode = 1;
} catch {
  console.error(JSON.stringify({ check: "private-photo-storage", status: "failed", stage: "setup" }));
  process.exitCode = 1;
}

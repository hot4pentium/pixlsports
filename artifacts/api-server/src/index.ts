import app from "./app";
import { logger } from "./lib/logger";
import { startExpiredAccountPurgeSchedule } from "./jobs/purgeCancelledAccounts";
import { startHypeCardSharePurgeSchedule } from "./jobs/purgeHypeCardShares";
import { startSupporterPhotoUploadPurgeSchedule } from "./jobs/purgeSupporterPhotoUploads";
import { startProjectMediaUploadClaimPurgeSchedule } from "./jobs/purgeProjectMediaUploadClaims";
import { startPlannerNotificationSchedule } from "./jobs/plannerNotifications";
import { startAthleteInviteFanAlertSchedule } from "./jobs/athleteInviteFanAlerts";
import { startAthleteInvitePhotoUploadPurgeSchedule } from "./jobs/purgeAthleteInvitePhotoUploads";
import { retireStandaloneCalendars } from "./jobs/retireStandaloneCalendars";

async function startServer() {
  const rawPort = process.env["PORT"];

  if (!rawPort) {
    throw new Error(
      "PORT environment variable is required but was not provided.",
    );
  }

  const port = Number(rawPort);

  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  if (process.env.NODE_ENV === "production") {
    try {
      const counts = await retireStandaloneCalendars();
      logger.info(counts, "Standalone Calendar retirement cleanup complete");
    } catch {
      logger.error(
        { error: "Standalone Calendar retirement failed; API startup aborted" },
        "API server startup failed",
      );
      process.exit(1);
    }
  }

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
    startExpiredAccountPurgeSchedule();
    startHypeCardSharePurgeSchedule();
    startSupporterPhotoUploadPurgeSchedule();
    startProjectMediaUploadClaimPurgeSchedule();
    startPlannerNotificationSchedule();
    startAthleteInviteFanAlertSchedule();
    startAthleteInvitePhotoUploadPurgeSchedule();
  });
}

void startServer().catch(() => {
  logger.error(
    { error: "API startup failed before accepting traffic" },
    "API server startup failed",
  );
  process.exit(1);
});

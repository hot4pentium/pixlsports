import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import { runPlannerNotificationJob } from "./plannerNotifications";

async function main() {
  try {
    await runPlannerNotificationJob();
    logger.info("Game On alert check completed");
  } catch {
    logger.error("Game On alert check failed");
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
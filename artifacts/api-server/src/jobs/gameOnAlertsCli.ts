import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import { runScheduledGameOnReminders } from "./gameOnReminderQueue";

async function main() {
  try {
    const result = await runScheduledGameOnReminders();
    logger.info(result, "Game On alert check completed");
  } catch {
    logger.error("Game On alert check failed");
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
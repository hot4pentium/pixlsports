import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import { retireStandaloneCalendars } from "./retireStandaloneCalendars";

void retireStandaloneCalendars()
  .then((counts) => logger.info({ counts }, "Standalone Calendar cleanup complete"))
  .catch((error: unknown) => {
    logger.error({ err: error }, "Standalone Calendar cleanup failed");
    process.exitCode = 1;
  })
  .finally(() => pool.end());
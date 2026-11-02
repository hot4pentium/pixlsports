import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { checkPhotoStorageReadiness } from "../lib/photoStorageReadiness";

export function createHealthRouter(checkStorage = checkPhotoStorageReadiness): IRouter {
const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Separate from API liveness: an upload outage must not stop other tools.
router.get("/healthz/photo-storage", async (_req, res) => {
  const result = await checkStorage();
  res.set("Cache-Control", "no-store").status(result.status === "ready" ? 200 : 503).json(result);
});

return router;
}

export default createHealthRouter();

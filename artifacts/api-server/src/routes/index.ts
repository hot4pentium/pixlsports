import { Router, type IRouter } from "express";
import healthRouter from "./health";
import projectsRouter from "./projects";
import scheduleSharesRouter from "./scheduleShares";
import storageRouter from "./storage";
import accountAccessRouter from "./accountAccess";
import accountLifecycleRouter from "./accountLifecycle";
import billingRouter from "./billing";
import hypeCardSharesRouter from "./hypeCardShares";
import supporterPhotoRouter from "./supporterPhoto";
import checklistSharesRouter from "./checklistShares";
import statTrackerSharesRouter from "./statTrackerShares";
import webPushRouter from "./webPush";

const router: IRouter = Router();

router.use(healthRouter);
router.use(accountLifecycleRouter);
router.use(billingRouter);
router.use(projectsRouter);
router.use(scheduleSharesRouter);
router.use(hypeCardSharesRouter);
router.use(storageRouter);
router.use(accountAccessRouter);
router.use(supporterPhotoRouter);
router.use(checklistSharesRouter);
router.use(statTrackerSharesRouter);
  router.use(webPushRouter);

export default router;

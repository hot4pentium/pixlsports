import { Router, type IRouter } from "express";
import healthRouter from "./health";
import projectsRouter from "./projects";
import scheduleSharesRouter from "./scheduleShares";
import coachCalendarRouter from "./coachCalendar";
import storageRouter from "./storage";
import accountAccessRouter from "./accountAccess";
import accountLifecycleRouter from "./accountLifecycle";
import billingRouter from "./billing";
import hypeCardSharesRouter from "./hypeCardShares";

const router: IRouter = Router();

router.use(healthRouter);
router.use(accountLifecycleRouter);
router.use(billingRouter);
router.use(projectsRouter);
router.use(scheduleSharesRouter);
router.use(hypeCardSharesRouter);
router.use(coachCalendarRouter);
router.use(storageRouter);
router.use(accountAccessRouter);

export default router;

import { Router, type IRouter } from "express";
import healthRouter from "./health";
import projectsRouter from "./projects";
import scheduleSharesRouter from "./scheduleShares";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(projectsRouter);
router.use(scheduleSharesRouter);
router.use(storageRouter);

export default router;

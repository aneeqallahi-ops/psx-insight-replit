import { Router, type IRouter } from "express";
import healthRouter from "./health";
import marketRouter from "./market";
import marketsRouter from "./markets";
import stockRouter from "./stock";
import portfolioRouter from "./portfolio";
import symbolsRouter from "./symbols";
import newsRouter from "./news";
import announcementsRouter from "./announcements";
import agentRouter from "./agent";
import notificationsRouter from "./notifications";

const router: IRouter = Router();

router.use(healthRouter);
router.use(marketRouter);
router.use(marketsRouter);
router.use(stockRouter);
router.use(portfolioRouter);
router.use(symbolsRouter);
router.use(newsRouter);
router.use(announcementsRouter);
router.use(agentRouter);
router.use(notificationsRouter);

export default router;

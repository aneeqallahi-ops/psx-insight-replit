import path from "node:path";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

declare global {
  namespace Express {
    interface Request {
      portfolioSessionId: string;
    }
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function portfolioSession(req: Request, res: Response, next: NextFunction) {
  const key = req.headers['x-portfolio-key'] as string | undefined;
  if (!key || !UUID_RE.test(key)) {
    res.status(400).json({ error: 'Missing or invalid X-Portfolio-Key header' });
    return;
  }
  req.portfolioSessionId = key.toLowerCase();
  next();
}

const app: Express = express();

// Behind Railway's proxy, trust the first hop so req.ip is the real client IP
// (used by the per-IP rate limiter on the public Q&A endpoint).
app.set('trust proxy', 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/portfolio/positions", portfolioSession);
app.use("/api/portfolio/lots", portfolioSession);
app.use("/api/portfolio/tax-profile", portfolioSession);
app.use("/api/agent/portfolio-review", portfolioSession);
app.use("/api/notifications", portfolioSession);
app.use("/api", router);

const staticDir = process.env.STATIC_DIR?.trim();
if (staticDir) {
  const resolvedStatic = path.resolve(staticDir);
  logger.info({ staticDir: resolvedStatic }, "Serving frontend static files");
  app.use(express.static(resolvedStatic, { index: false, maxAge: "1h" }));
  app.get(/^\/(?!api(\/|$)).*/, (_req, res) => {
    res.sendFile(path.join(resolvedStatic, "index.html"));
  });
}

export default app;

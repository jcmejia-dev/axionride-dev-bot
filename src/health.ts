import express from "express";

export function startHealthServer(port: number) {
  const app = express();
  app.disable("x-powered-by");
  app.get("/health", (_request, response) => response.json({ status: "ok", service: "axionride-dev-bot" }));
  app.use((_request, response) => response.status(404).json({ error: "not_found" }));
  app.use((_error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    response.status(500).json({ error: "internal_error" });
  });
  return app.listen(port, () => console.log(`Health server listening on port ${port}`));
}


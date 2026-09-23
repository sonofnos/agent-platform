import "dotenv/config";
import { loadConfig } from "./config/index.js";
import { buildContainer } from "./container.js";
import { createPool } from "./db/pool.js";
import { migrate } from "./db/migrate.js";
import { buildApp } from "./http/app.js";
import { seedDemoData } from "./seed.js";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const pool = createPool(config.databaseUrl);

  await migrate(pool);

  const container = buildContainer(pool, config);
  await seedDemoData(pool, container);

  const app = buildApp(pool, config, container);
  app.listen(config.port, () => {
    console.log(`agent-platform listening on :${config.port} (llm base url: ${config.llm.baseUrl ?? "fake/offline"}, chat models: ${[config.llm.chatModel, ...config.llm.fallbackChatModels].join(" -> ")})`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

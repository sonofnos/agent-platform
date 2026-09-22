import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { migrate } from "../../src/db/migrate.js";

export async function startTestDb(): Promise<{ container: StartedPostgreSqlContainer; pool: pg.Pool }> {
  const container = await new PostgreSqlContainer("pgvector/pgvector:pg16")
    .withDatabase("agent_platform_test")
    .withUsername("agent_platform")
    .withPassword("agent_platform")
    .start();

  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);

  return { container, pool };
}

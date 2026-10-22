// Plain Redis over REDIS_URL (what Vercel's Redis store gives you), as an alternative to Upstash's REST API.
// One client per server instance, reused across requests. Replies come back in the same shape as
// Upstash's `result`: strings, numbers, arrays or null.
import { createClient } from "redis";

type Client = ReturnType<typeof createClient>;
let client: Promise<Client> | undefined;

function connect(url: string): Promise<Client> {
  if (!client) {
    const c = createClient({ url });
    c.on("error", () => {}); // a dropped connection is retried by the client; failed commands still throw
    client = c.connect().catch((e) => {
      client = undefined;
      throw e;
    });
  }
  return client;
}

export async function redisUrlCommand<T = unknown>(url: string, args: (string | number)[]): Promise<T> {
  const c = await connect(url);
  return (await c.sendCommand(args.map(String))) as T;
}

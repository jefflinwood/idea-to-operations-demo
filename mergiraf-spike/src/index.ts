// Worker in front of the Mergiraf container. Requests are bearer-authenticated
// when SPIKE_KEY is set, then forwarded to a container instance.
import { Container, getContainer } from "@cloudflare/containers";

type Env = Cloudflare.Env & { SPIKE_KEY?: string };

const POOL_SIZE = 4;

export class MergeContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "5m";
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (env.SPIKE_KEY && request.headers.get("authorization") !== `Bearer ${env.SPIKE_KEY}`) {
      return new Response("unauthorized", { status: 401 });
    }
    // A small pool: concurrent integrations each run tsc, which is CPU-bound, so spread them over instances.
    const instance = `pool-${Math.floor(Math.random() * POOL_SIZE)}`;
    return getContainer(env.MERGE as any, instance).fetch(request);
  },
};

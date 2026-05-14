import { Composio } from "@composio/core";
import { VercelProvider } from "@composio/vercel";
import { env } from "~/env";

export function isComposioConfigured(): boolean {
  return !!env.COMPOSIO_API_KEY;
}

export function createComposioClient() {
  if (!env.COMPOSIO_API_KEY) {
    throw new Error(
      "COMPOSIO_API_KEY is not configured. Please add it in the Vars section of your v0 settings."
    );
  }
  return new Composio({
    apiKey: env.COMPOSIO_API_KEY,
    provider: new VercelProvider(),
  });
}

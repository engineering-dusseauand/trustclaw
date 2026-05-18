import { smoothStream, UI_MESSAGE_STREAM_HEADERS } from "ai";
import { z } from "zod";
import { createClient } from "~/lib/supabase/server";
import { db } from "~/server/clients/db";
import { prepareAgentRun } from "~/server/api/routers/trustclaw/agent/setup";
import {
  setStreamingMessage,
  getStreamingMessage,
} from "~/server/clients/redis";
import { getStreamContext } from "./stream-store";

const chatRequestBody = z.object({
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant", "system"]),
      content: z.string().optional(),
      parts: z.array(z.record(z.unknown())).optional(),
    }),
  ),
});

/**
 * Resolves the current user from Supabase Auth cookies and returns their
 * ComposioClawInstance, or null if either lookup fails. Mirrors the auth
 * shape used by the tRPC context in src/server/api/trpc.ts so this route
 * stays consistent with the rest of the app after the Better Auth →
 * Supabase Auth migration.
 */
async function getAuthenticatedInstance(): Promise<
  { userId: string; instanceId: string } | null
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const instance = await db.composioClawInstance.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  if (!instance) return null;

  return { userId: user.id, instanceId: instance.id };
}

export const maxDuration = 60;

export async function POST(request: Request) {
  const authResult = await getAuthenticatedInstance();
  if (!authResult) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { instanceId } = authResult;

  const body = chatRequestBody.safeParse(await request.json());
  if (!body.success) {
    return new Response("Invalid request body", { status: 400 });
  }

  const lastUserMessage = [...body.data.messages]
    .reverse()
    .find((m) => m.role === "user");
  const userText =
    lastUserMessage?.parts
      ?.filter(
        (p): p is { type: string; text: string } =>
          typeof p === "object" &&
          p !== null &&
          "type" in p &&
          p.type === "text" &&
          "text" in p &&
          typeof p.text === "string",
      )
      .map((p) => p.text)
      .join("\n") ?? "";
  if (!userText.trim()) {
    return new Response("Empty message", { status: 400 });
  }

  const prepareResult = await prepareAgentRun({
    instanceId,
    userMessage: userText,
    source: "web",
  });

  const { agent, messages } = prepareResult.result;

  const streamId = crypto.randomUUID();
  await setStreamingMessage(instanceId, streamId);

  // agent.stream() returns streamText() result - supports toUIMessageStreamResponse
  // Pass request.signal so the agent stops when the client disconnects (stop button)
  const result = await agent.stream({
    prompt: messages,
    experimental_transform: smoothStream(),
    abortSignal: request.signal,
  });

  const streamContext = getStreamContext();
  return result.toUIMessageStreamResponse({
    headers: {
      "X-Stream-Id": streamId,
    },
    ...(streamContext
      ? {
          consumeSseStream: ({ stream }) => {
            void streamContext.createNewResumableStream(
              streamId,
              () => stream,
            );
          },
        }
      : {}),
  });
}

export async function GET(request: Request) {
  const authResult = await getAuthenticatedInstance();
  if (!authResult) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { instanceId } = authResult;
  const url = new URL(request.url);
  const streamId = url.searchParams.get("streamId");

  if (!streamId) {
    return new Response("Missing streamId", { status: 400 });
  }

  const activeStreamId = await getStreamingMessage(instanceId);
  if (activeStreamId !== streamId) {
    return new Response("Stream not found or not yours", { status: 404 });
  }

  const streamContext = getStreamContext();
  if (!streamContext) {
    return new Response("Stream resumption not available", { status: 204 });
  }
  const stream = await streamContext.resumeExistingStream(streamId);
  if (!stream) {
    return new Response("Stream already completed", { status: 204 });
  }

  return new Response(stream.pipeThrough(new TextEncoderStream()), {
    headers: UI_MESSAGE_STREAM_HEADERS,
  });
}

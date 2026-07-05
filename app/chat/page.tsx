import { cookies } from "next/headers";

import ChatClient, { InitialChatData } from "./chat-client";
import { hashToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureProactiveChatGreeting } from "@/services/chat/proactiveGreetingService";

type ChatPageProps = {
  searchParams?: Promise<{
    sessionId?: string;
  }>;
};

const AUTH_TOKEN_KEY = "xinqingAuthToken";
const LOCAL_DEMO_TOKEN_PREFIX = "local_demo_";

const loadInitialChat = async (requestedSessionId?: string): Promise<InitialChatData> => {
  const token = (await cookies()).get(AUTH_TOKEN_KEY)?.value;
  if (!token) return null;
  if (token.startsWith(LOCAL_DEMO_TOKEN_PREFIX)) return null;

  try {
    const session = await prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        expiresAt: true,
        user: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    if (!session || session.expiresAt <= new Date() || session.user.status !== "ACTIVE") {
      return null;
    }

    const chatSession =
      requestedSessionId
        ? await prisma.chatSession.findFirst({
            where: {
              id: requestedSessionId,
              userId: session.user.id,
            },
            select: { id: true },
          })
        : await prisma.chatSession.findFirst({
            where: { userId: session.user.id },
            orderBy: { updatedAt: "desc" },
            select: { id: true },
          });

    if (!chatSession) return null;

    await ensureProactiveChatGreeting({
      sessionId: chatSession.id,
      userId: session.user.id,
    });

    const items = await prisma.chatMessage.findMany({
      where: {
        sessionId: chatSession.id,
        userId: session.user.id,
      },
      orderBy: { createdAt: "asc" },
      take: 50,
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
        aiGeneration: {
          select: {
            promptVersion: true,
          },
        },
      },
    });

    return {
      sessionId: chatSession.id,
      messages: items
        .filter((item) => item.role === "USER" || item.role === "ASSISTANT")
        .map((item) => ({
          id: item.id,
          role: item.role.toLowerCase() as "user" | "assistant",
          text: item.content,
          createdAt: item.createdAt.toISOString(),
          promptVersion: item.aiGeneration?.promptVersion ?? null,
        })),
    };
  } catch {
    return null;
  }
};

export default async function ChatPage({ searchParams }: ChatPageProps) {
  const params = await searchParams;
  const initialChat = await loadInitialChat(params?.sessionId);

  return <ChatClient initialChat={initialChat} />;
}

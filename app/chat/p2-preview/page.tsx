import ChatClient, { InitialChatData } from "../chat-client";

/**
 * Dedicated P2 provisional-marker preview route.
 * No query string required — avoids browsers that over-encode `=` as `%3D`.
 * Still requires server `P2_PUBLICATION_ENABLED=1`; does not switch site-wide V1.
 */
export default function P2PublicationPreviewPage() {
  const initialChat: InitialChatData = null;
  return (
    <ChatClient
      initialChat={initialChat}
      forceP2PublicationOptIn
      p2PreviewTransport="qwen"
    />
  );
}

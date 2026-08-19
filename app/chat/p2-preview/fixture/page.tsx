import ChatClient, { InitialChatData } from "../../chat-client";

/**
 * Evaluation-only model-free publication fixture.
 * The server route also requires two explicit flags and refuses production mode.
 */
export default function P2PublicationFixturePreviewPage() {
  const initialChat: InitialChatData = null;
  return (
    <ChatClient
      initialChat={initialChat}
      forceP2PublicationOptIn
      p2PreviewTransport="fixture"
    />
  );
}

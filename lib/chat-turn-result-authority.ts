export type ChatSessionAuthority = Readonly<{
  sessionId: string;
  generation: number;
}>;

export type ChatTurnResultAuthority = ChatSessionAuthority &
  Readonly<{
    turnId: string;
  }>;

export type ChatTurnAuthorityState = Readonly<{
  session: ChatSessionAuthority;
  latestTurn: ChatTurnResultAuthority | null;
}>;

export const createChatTurnAuthorityState = (sessionId: string): ChatTurnAuthorityState => ({
  session: { sessionId, generation: 0 },
  latestTurn: null,
});

export const advanceChatSessionAuthority = (
  current: ChatTurnAuthorityState,
  sessionId: string
): ChatTurnAuthorityState => ({
  session: {
    sessionId,
    generation: current.session.generation + 1,
  },
  latestTurn: null,
});

export const submitChatTurnAuthority = (
  current: ChatTurnAuthorityState,
  turnId: string
): { state: ChatTurnAuthorityState; result: ChatTurnResultAuthority } => {
  const result = { ...current.session, turnId };
  return {
    state: { ...current, latestTurn: result },
    result,
  };
};

export const canApplyChatTurnResult = ({
  current,
  result,
}: {
  current: ChatTurnAuthorityState;
  result: ChatTurnResultAuthority;
}) =>
  current.session.sessionId === result.sessionId &&
  current.session.generation === result.generation &&
  current.latestTurn?.sessionId === result.sessionId &&
  current.latestTurn.generation === result.generation &&
  current.latestTurn.turnId === result.turnId;

export const canApplyChatSessionResult = ({
  current,
  result,
}: {
  current: ChatTurnAuthorityState;
  result: ChatSessionAuthority;
}) =>
  current.session.sessionId === result.sessionId &&
  current.session.generation === result.generation;

export const resolveChatTurnResult = <Value>({
  current,
  result,
  previousValue,
  nextValue,
}: {
  current: ChatTurnAuthorityState;
  result: ChatTurnResultAuthority;
  previousValue: Value;
  nextValue: Value;
}) =>
  canApplyChatTurnResult({ current, result }) ? nextValue : previousValue;

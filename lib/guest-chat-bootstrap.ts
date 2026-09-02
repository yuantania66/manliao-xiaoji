type MessageIdentity = {
  id: string;
};

export const loadGuestGreetingAfterHistoryReady = async <T>({
  onHistoryReady,
  loadGreeting,
}: {
  onHistoryReady: () => void;
  loadGreeting: () => Promise<T>;
}) => {
  onHistoryReady();
  return loadGreeting();
};

export const reconcileGuestGreetingMessages = <T extends MessageIdentity>({
  baseline,
  current,
  loaded,
}: {
  baseline: T[];
  current: T[];
  loaded: T[];
}) => {
  const changedDuringGreeting =
    current.length !== baseline.length ||
    current.some((message, index) => message.id !== baseline[index]?.id);

  return {
    messages: changedDuringGreeting ? current : loaded,
    changedDuringGreeting,
  };
};

const getShanghaiHour = (date: Date) => {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    hour12: false,
  }).format(date);
  return Number(hour);
};

const initialGreetings = [
  "早。今天可以从一句很小的话开始。",
  "午安。你来了，我在。想随便说点什么也可以。",
  "下午好。今天到这会儿，过得还好吗？",
  "晚上好。今天有什么想先放在这里的吗？",
  "这么晚还在。可以不用讲清楚，先放一句也行。",
] as const;

const returnGreetings = [
  "你来了。今天先从哪里开始都行。",
  "你回来了。中间这一会儿，过得还好吗？",
  "你回来了。刚才到现在，有什么想放下的吗？",
  "你回来了。今天剩下的这一点时间，可以慢慢说。",
  "你回来了。这个点不用撑着讲完整，留一句也行。",
] as const;

const proactiveGreetingTexts: readonly string[] = [...initialGreetings, ...returnGreetings];

const pickByHour = (items: readonly string[], date: Date) => {
  const hour = getShanghaiHour(date);

  if (hour >= 5 && hour < 11) {
    return items[0];
  }

  if (hour >= 11 && hour < 14) {
    return items[1];
  }

  if (hour >= 14 && hour < 18) {
    return items[2];
  }

  if (hour >= 18 && hour < 23) {
    return items[3];
  }

  return items[4];
};

export const createProactiveGreeting = (date = new Date()) => pickByHour(initialGreetings, date);

export const createReturnGreeting = (date = new Date()) => pickByHour(returnGreetings, date);

export const isProactiveGreetingText = (value: string) =>
  proactiveGreetingTexts.includes(value.trim());

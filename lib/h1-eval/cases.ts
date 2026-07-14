import type { H1EvalCase } from "./types";

const singleTurn = "单轮输入，无前文。";

export const H1_EVAL_CASES: H1EvalCase[] = [
  { id: "001", group: "S1", cohort: "confirmed", userInput: "1", necessaryContext: singleTurn, baselineReply: "我看到你发的是“1”。现在的线索还不够，我先不替它加上含义。你可以继续。" },
  { id: "002", group: "S1", cohort: "confirmed", userInput: "2", necessaryContext: singleTurn, baselineReply: "我看到你发的是“2”。现在的线索还不够，我先不替它加上含义。你可以继续。" },
  { id: "003", group: "S1", cohort: "confirmed", userInput: "三", necessaryContext: singleTurn, baselineReply: "我看到你发的是“三”。现在的线索还不够，我先不替它加上含义。你可以继续。" },
  { id: "004", group: "S1", cohort: "confirmed", userInput: "0", necessaryContext: singleTurn, baselineReply: "我看到你发的是“0”。现在的线索还不够，我先不替它加上含义。你可以继续。" },
  { id: "005", group: "S1", cohort: "confirmed", userInput: "99", necessaryContext: singleTurn, baselineReply: "我看到你发的是“99”。现在的线索还不够，我先不替它加上含义。你可以继续。" },
  { id: "006", group: "S1", cohort: "confirmed", userInput: "3.5", necessaryContext: singleTurn, baselineReply: "我看到你发的是“3.5”。现在的线索还不够，我先不替它加上含义。你可以继续。" },
  { id: "007", group: "S1", cohort: "confirmed", userInput: "2024", necessaryContext: singleTurn, baselineReply: "我看到你发的是“2024”。现在的线索还不够，我先不替它加上含义。你可以继续。" },
  { id: "008", group: "S1", cohort: "confirmed", userInput: "7", necessaryContext: singleTurn, baselineReply: "我看到你发的是“7”。现在的线索还不够，我先不替它加上含义。你可以继续。" },
  { id: "009", group: "S1", cohort: "guard", userInput: "①", necessaryContext: singleTurn, baselineReply: "看到你发了这个，我不太确定你想怎么用它。" },
  { id: "010", group: "S1", cohort: "confirmed", userInput: "-1", necessaryContext: singleTurn, baselineReply: "我看到你发的是“-1”。现在的线索还不够，我先不替它加上含义。你可以继续。" },
  { id: "014", group: "S1", cohort: "confirmed", userInput: "好", necessaryContext: singleTurn, baselineReply: "我看到你发的是“好”。现在的线索还不够，我先不替它加上含义。你可以继续。" },
  { id: "016", group: "S1", cohort: "confirmed", userInput: "嗯", necessaryContext: singleTurn, baselineReply: "我看到你发的是“嗯”。现在的线索还不够，我先不替它加上含义。你可以继续。" },
  { id: "019", group: "S1", cohort: "confirmed", userInput: "🙂", necessaryContext: singleTurn, baselineReply: "我看到你发的是“🙂”。现在的线索还不够，我先不替它加上含义。你可以继续。" },
  { id: "020", group: "S1", cohort: "confirmed", userInput: "😶‍🌫️", necessaryContext: singleTurn, baselineReply: "我看到你发的是“😶‍🌫️”。现在的线索还不够，我先不替它加上含义。你可以继续。" },
  { id: "021", group: "S1", cohort: "confirmed", userInput: "😭", necessaryContext: singleTurn, baselineReply: "我看到你发的是“😭”。现在的线索还不够，我先不替它加上含义。你可以继续。" },
  { id: "022", group: "S1", cohort: "confirmed", userInput: "😡", necessaryContext: singleTurn, baselineReply: "我看到你发的是“😡”。现在的线索还不够，我先不替它加上含义。你可以继续。" },
  { id: "023", group: "S1", cohort: "confirmed", userInput: "🫠", necessaryContext: singleTurn, baselineReply: "我看到你发的是“🫠”。现在的线索还不够，我先不替它加上含义。你可以继续。" },
  { id: "024", group: "S1", cohort: "confirmed", userInput: "🙃", necessaryContext: singleTurn, baselineReply: "我看到你发的是“🙃”。现在的线索还不够，我先不替它加上含义。你可以继续。" },
  { id: "025", group: "S1", cohort: "confirmed", userInput: "💔", necessaryContext: singleTurn, baselineReply: "我看到你发的是“💔”。现在的线索还不够，我先不替它加上含义。你可以继续。" },
  { id: "026", group: "S1", cohort: "confirmed", userInput: "👀", necessaryContext: singleTurn, baselineReply: "我看到你发的是“👀”。现在的线索还不够，我先不替它加上含义。你可以继续。" },
  { id: "093", group: "S1", cohort: "confirmed", userInput: "……", necessaryContext: singleTurn, baselineReply: "我看到你发的是“……”。现在的线索还不够，我先不替它加上含义。你可以继续。" },

  { id: "011", group: "S2", cohort: "confirmed", userInput: "累", necessaryContext: singleTurn, baselineReply: "听到你说累了。" },
  { id: "012", group: "S2", cohort: "confirmed", userInput: "烦", necessaryContext: singleTurn, baselineReply: "听到你说烦了。" },
  { id: "013", group: "S2", cohort: "confirmed", userInput: "怕", necessaryContext: singleTurn, baselineReply: "嗯，这个“怕”我接住了。" },
  { id: "018", group: "S2", cohort: "pending", userInput: "空", necessaryContext: singleTurn, baselineReply: "嗯，我在这里。" },
  { id: "039", group: "S2", cohort: "confirmed", userInput: "突然觉得自己什么都做不好。", necessaryContext: singleTurn, baselineReply: "听到你说突然有这种感觉。" },
  { id: "067", group: "S2", cohort: "pending", userInput: "又来了。", necessaryContext: "输入明确引用重复事件，但没有更早对话。", baselineReply: "嗯，我听到了。" },
  { id: "070", group: "S2", cohort: "confirmed", userInput: "今天不太行。", necessaryContext: singleTurn, baselineReply: "嗯，听到了。" },

  { id: "030", group: "S3", cohort: "confirmed", userInput: "梦里我和已经很久不联系的朋友又见面了，可是谁都没说话。", necessaryContext: singleTurn, baselineReply: "梦见很久没联系的人，却谁都没开口。" },
  { id: "034", group: "S3", cohort: "confirmed", userInput: "我最近总做同一个梦，门就在面前，可我怎么也打不开。", necessaryContext: singleTurn, baselineReply: "门就在眼前却打不开，这个画面好像一直重复出现。" },
  { id: "036", group: "S3", cohort: "pending", userInput: "我现在特别烦，谁来跟我说话都觉得吵。", necessaryContext: singleTurn, baselineReply: "听起来现在连说话声都让人烦。" },
  { id: "040", group: "S3", cohort: "guard", userInput: "今天有一小会儿很开心，但马上又觉得不应该开心。", necessaryContext: singleTurn, baselineReply: "听到你说开心之后，马上又觉得不该这样。" },
  { id: "043", group: "S3", cohort: "guard", userInput: "我好像很委屈，但讲出来又觉得自己矫情。", necessaryContext: singleTurn, baselineReply: "委屈和觉得自己矫情，好像同时都在。" },
  { id: "056", group: "S3", cohort: "guard", userInput: "我妈每次打电话都问工作和对象，我知道她关心我，但真的很有压力。", necessaryContext: singleTurn, baselineReply: "知道是关心，但压力还是实实在在落在那儿了。" },
  { id: "057", group: "S3", cohort: "pending", userInput: "伴侣说想一个人静静，我脑子里马上就开始想他是不是不爱我了。", necessaryContext: singleTurn, baselineReply: "听到他说想静静，你心里马上就冒出了这个念头。" },
  { id: "062", group: "S3", cohort: "guard", userInput: "我总是在关系里先道歉，哪怕我也觉得自己没做错。", necessaryContext: singleTurn, baselineReply: "明明觉得自己没错，却还是先开口道歉了。" },
  { id: "065", group: "S3", cohort: "confirmed", userInput: "有点累。", necessaryContext: singleTurn, baselineReply: "嗯，有点累。" },

  { id: "073", group: "S4", cohort: "guard", userInput: "这几个月我一直在考虑要不要换工作。现在的岗位稳定，收入也还可以，同事大多相处得不错，可我每天做的事情都让我觉得越来越没有意义。另一方面，我又担心离开以后会后悔，担心找不到合适的机会，也担心家里人觉得我太任性。我列过很多利弊，但每次看完还是停在原地，好像怎么选都会失去一些东西。", necessaryContext: singleTurn, baselineReply: "列了那么多利弊还是停在原地，好像怎么选都绕不开那些担心。" },
  { id: "075", group: "S4", cohort: "guard", userInput: "昨天开会时领导当着所有人的面说我的方案考虑得不够成熟。我当时笑着说会继续改，散会后也正常把修改项整理了出来，可到了晚上那句话一直在脑子里重复。我知道一次方案被否定不代表我不行，也知道领导说的有些地方确实有道理，但我还是会把它变成对自己的整体否定，越想越觉得难受。", necessaryContext: singleTurn, baselineReply: "理智上知道该怎么看，但晚上那句话还是反复转成了对自己的否定。" },
  { id: "076", group: "S4", cohort: "guard", userInput: "我最近睡得很差。不是完全睡不着，而是每晚都会在差不多的时间醒来，然后开始想白天发生的事：哪句话是不是说错了，别人那个表情是不是不耐烦，明天的事情会不会出问题。有时候我知道这些想法没有依据，可身体还是很紧。白天我又会装得和平常一样，因为不想让别人觉得我太脆弱。", necessaryContext: singleTurn, baselineReply: "夜里反复想那些事，身体又紧着，白天还要撑着像平常一样，听起来真的很耗人。" },
];

export const getH1EvalCase = (id: string) => H1_EVAL_CASES.find((item) => item.id === id);

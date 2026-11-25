const GENERATED_NAMES = Object.freeze([
  "山眠",
  "松露",
  "海盐",
  "月白",
  "风铃",
  "星野",
  "云岫",
  "青禾",
  "小满",
  "晚风",
  "木棉",
  "晴川"
]);

const AVATAR_GRADIENTS = Object.freeze([
  "linear-gradient(135deg, #657d70, #e9c9aa)",
  "linear-gradient(135deg, #819b8c, #d9c2a4)",
  "linear-gradient(135deg, #697f8a, #d7b39c)",
  "linear-gradient(135deg, #8b9387, #ead8b8)",
  "linear-gradient(135deg, #7b708c, #d9c4b2)",
  "linear-gradient(135deg, #587d7a, #e4c39f)"
]);

// Keep legacy identity and guest mappings stable; profile generation has its own pool.
const PROFILE_NAMES = Object.freeze([
  "山眠", "松露", "海盐", "月白", "风铃", "星野", "云岫", "青禾",
  "小满", "晚风", "木棉", "晴川", "晨雾", "溪桥", "竹影", "芦雪",
  "林泉", "清露", "雨桐", "初霁", "苔青", "云栖", "柳岸", "听雨",
  "秋实", "春涧", "夏木", "冬阳", "白榆", "青岚", "远岫", "微澜",
  "知秋", "浅溪", "稻香", "露微", "野渡", "汀兰", "烟渚", "鹤汀",
  "沐雨", "归云", "桑榆", "石泉", "萤光", "雪霁", "南枝", "竹风"
]);

const PROFILE_AVATAR_GRADIENTS = Object.freeze([
  "linear-gradient(135deg, #315e50, #52745b)",
  "linear-gradient(135deg, #24635d, #3c7d70)",
  "linear-gradient(135deg, #255d70, #44788c)",
  "linear-gradient(135deg, #344f7b, #5d7096)",
  "linear-gradient(135deg, #4d4d7d, #746a91)",
  "linear-gradient(135deg, #654b74, #856883)",
  "linear-gradient(135deg, #78485f, #926576)",
  "linear-gradient(135deg, #7c4e42, #986856)",
  "linear-gradient(135deg, #755837, #8c7047)",
  "linear-gradient(135deg, #686336, #7c764a)",
  "linear-gradient(135deg, #4c643d, #6a7c4c)",
  "linear-gradient(135deg, #3c6756, #627b6c)",
  "linear-gradient(135deg, #385f64, #66797a)",
  "linear-gradient(135deg, #4d5d70, #6b7788)",
  "linear-gradient(135deg, #60575b, #847078)",
  "linear-gradient(135deg, #715650, #897163)"
]);

const normalizeIndex = (value, length) => {
  const index = Number.isInteger(value) ? value : 0;
  return ((index % length) + length) % length;
};

const hashText = (value) => {
  let hash = 2166136261;
  for (const character of String(value || "慢聊")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const getGeneratedIdentity = (seed) => {
  const hash = hashText(seed);
  const nameIndex = hash % GENERATED_NAMES.length;
  const avatarIndex = Math.floor(hash / GENERATED_NAMES.length) % AVATAR_GRADIENTS.length;
  const nickname = GENERATED_NAMES[nameIndex];
  return {
    nameIndex,
    nickname,
    initial: nickname.slice(0, 1),
    avatarIndex,
    avatarStyle: AVATAR_GRADIENTS[avatarIndex]
  };
};

const getIdentityAt = (nameIndex, avatarIndex) => {
  const safeNameIndex = normalizeIndex(nameIndex, GENERATED_NAMES.length);
  const safeAvatarIndex = normalizeIndex(avatarIndex, AVATAR_GRADIENTS.length);
  const nickname = GENERATED_NAMES[safeNameIndex];
  return {
    nameIndex: safeNameIndex,
    nickname,
    initial: nickname.slice(0, 1),
    avatarIndex: safeAvatarIndex,
    avatarStyle: AVATAR_GRADIENTS[safeAvatarIndex]
  };
};

const getRandomIdentity = () => getGeneratedIdentity(`${Date.now()}:${Math.random()}`);
const getAvatarStyle = (avatarIndex) => AVATAR_GRADIENTS[normalizeIndex(avatarIndex, AVATAR_GRADIENTS.length)];
const getNextAvatarIndex = (avatarIndex) => normalizeIndex(avatarIndex + 1, AVATAR_GRADIENTS.length);

const getRandomProfileIdentity = (recent = [], current = {}) => {
  const history = recent.slice(-8);
  const usedNames = new Set([...history.map((identity) => identity.nickname), current.nickname]);
  const usedStyles = new Set([...history.map((identity) => identity.avatarStyle), current.avatarStyle]);
  const names = PROFILE_NAMES.filter((nickname) => !usedNames.has(nickname));
  const styles = PROFILE_AVATAR_GRADIENTS.filter((avatarStyle) => !usedStyles.has(avatarStyle));
  const nickname = names[Math.floor(Math.random() * names.length)];
  const avatarStyle = styles[Math.floor(Math.random() * styles.length)];
  const characters = Array.from(nickname);
  return { nickname, initial: characters[1] || characters[0] || "慢", avatarStyle };
};

module.exports = {
  GENERATED_NAMES,
  getAvatarStyle,
  getGeneratedIdentity,
  getIdentityAt,
  getNextAvatarIndex,
  getRandomIdentity,
  getRandomProfileIdentity
};

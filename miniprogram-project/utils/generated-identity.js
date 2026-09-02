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

module.exports = {
  GENERATED_NAMES,
  getAvatarStyle,
  getGeneratedIdentity,
  getIdentityAt,
  getNextAvatarIndex,
  getRandomIdentity
};

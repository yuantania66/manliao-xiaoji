const USER_CORRECTION_PATTERN =
  /你是不是.*(没懂|没理解)|你.*(没懂|没理解|理解错|理解偏|误会|误解|说错)|^(其实)?不是(这个意思|这意思|这样的|这样|那个|因为这个)|不是我想表达的|我不是在说这个|我想纠正一下|我来纠正一下|我纠正一下|我(刚刚|刚才)?是不是没表达清楚/;

const NEGATED_CORRECTION_PATTERN = /不是在说.*(你|你们|AI|ai|机器人).*(理解错|理解偏|没懂|没理解|误会|误解)|不是说.*(你|你们|AI|ai|机器人).*(理解错|理解偏|没懂|没理解|误会|误解)/;

export const isUserCorrection = (text: string): boolean => {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (NEGATED_CORRECTION_PATTERN.test(normalized)) return false;
  return USER_CORRECTION_PATTERN.test(normalized);
};

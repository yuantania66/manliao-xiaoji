const USER_CORRECTION_PATTERN = /不是这个意思|不是这意思|你没懂|你没理解|你理解错|你说错|你是不是.*(没懂|没理解)/;

export const isUserCorrection = (text: string): boolean => USER_CORRECTION_PATTERN.test(text);

export const replacementFactFromCorrection = (message: string) => {
  const contrast = message.match(
    /(?:不是|不叫)([^，,。；;\s]{1,18}?)[，,；;\s]*(?:而?是|叫)([^，,。；;]{1,24})/u
  );
  const replacement = contrast?.[2]?.trim();
  return replacement?.replace(/^(?:我|你)(?:的)?/u, "").trim() || null;
};

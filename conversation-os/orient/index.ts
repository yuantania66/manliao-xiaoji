import { OrientInput, Orientation } from "../types";

export const orient = ({ notice }: OrientInput): Orientation => ({
  currentUnderstanding: notice.observations.map((observation) => observation.text),
  unknowns: ["用户希望这些表达如何被理解，仍需由后续对话共同校准。"],
  possibleDirections: ["先承接已观察到的内容，不把观察扩展成结论。"],
});

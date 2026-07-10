export const timelineProjectionIdFromEvidenceId = (evidenceId: string) =>
  `timeline_${evidenceId}`;

export const understandingProjectionIdFromEvidenceId = (evidenceId: string) =>
  `understanding_${evidenceId}`;

export const relationshipProjectionIdFromEvidenceIdAndDisplayName = ({
  evidenceId,
  displayNameKey,
}: {
  evidenceId: string;
  displayNameKey: string;
}) => `relationship_${evidenceId}_${displayNameKey}`;

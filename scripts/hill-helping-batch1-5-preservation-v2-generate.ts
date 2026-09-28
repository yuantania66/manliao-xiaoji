import { writeFileSync } from "node:fs";

import {
  derivePreservationV2Dataset,
  loadPreservationV1Source,
  PRESERVATION_V1_SHA256,
  PRESERVATION_V2_DATASET_PATH,
  serializePreservationV2Dataset,
} from "./hill-helping-batch1-5-preservation-v2-lib";

const { source, sha256 } = loadPreservationV1Source();
if (sha256 !== PRESERVATION_V1_SHA256) throw new Error("Preservation v1 source changed; refusing to derive v2.");
const dataset = derivePreservationV2Dataset({ source, sourceSha256: sha256 });
writeFileSync(PRESERVATION_V2_DATASET_PATH, serializePreservationV2Dataset(dataset), { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify({
  output: PRESERVATION_V2_DATASET_PATH,
  provenance: dataset.derivation.provenance,
}, null, 2));

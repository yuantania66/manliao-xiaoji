import { cleanupPrivateStagedNoteMedia } from "../lib/note-media-storage";

cleanupPrivateStagedNoteMedia()
  .then(() => console.log("Committed account-cancel media staging cleanup passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

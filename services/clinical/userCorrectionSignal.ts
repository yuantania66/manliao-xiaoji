// Compatibility export. Conversation OS owns repair evidence; Clinical may consume it
// but no longer keeps a second correction classifier.
export { isAssistantRepairSignal as isUserCorrection } from "@/conversation-os/control";

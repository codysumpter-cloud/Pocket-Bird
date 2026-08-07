import { initializeApplication } from "../../application.js";
import { initializeBuddy } from "../../buddy.js";
import { ObsidianContext } from "../../context.js";

const context = new ObsidianContext();
initializeApplication(context).then(() => initializeBuddy()).catch((error) => console.error("Pocket Buddy failed to start", error));
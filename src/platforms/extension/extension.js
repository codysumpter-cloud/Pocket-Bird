import { initializeApplication } from "../../application.js";
import { initializeBuddy } from "../../buddy.js";
import { BrowserExtensionContext } from "../../context.js";

const context = new BrowserExtensionContext();
initializeApplication(context).then(() => initializeBuddy()).catch((error) => console.error("Pocket Buddy failed to start", error));
import { initializeApplication } from "../../application.js";
import { initializeBuddy } from "../../buddy.js";
import { UserScriptContext } from "../../context.js";

const context = new UserScriptContext();
initializeApplication(context).then(() => initializeBuddy()).catch((error) => console.error("Pocket Buddy failed to start", error));
import { initializeApplication } from "../../application.js";
import { initializeBuddy } from "../../buddy.js";
import { LocalContext } from "../../context.js";

const context = new LocalContext();
initializeApplication(context).then(() => initializeBuddy()).catch((error) => console.error("Pocket Buddy failed to start", error));
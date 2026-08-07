import { initializeApplication } from "../../application.js";
import { UserScriptContext } from "../../context.js";
import { initializeBuddyLayer } from "../../buddy/layer.js";

initializeApplication(new UserScriptContext());
initializeBuddyLayer().catch((error) => console.error("Pocket Buddy core failed to start", error));

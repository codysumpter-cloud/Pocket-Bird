import { initializeApplication } from "../../application.js";
import { BrowserExtensionContext } from "../../context.js";
import { initializeBuddyLayer } from "../../buddy/layer.js";

initializeApplication(new BrowserExtensionContext());
initializeBuddyLayer().catch((error) => console.error("Pocket Buddy core failed to start", error));

import { initializeApplication } from "../../application.js";
import { ObsidianContext } from "../../context.js";
import { initializeBuddyLayer } from "../../buddy/layer.js";

initializeApplication(new ObsidianContext());
initializeBuddyLayer().catch((error) => console.error("Pocket Buddy core failed to start", error));

import { initializeApplication } from "../../application.js";
import { LocalContext } from "../../context.js";
import { initializeBuddyLayer } from "../../buddy/layer.js";

initializeApplication(new LocalContext());
initializeBuddyLayer().catch((error) => console.error("Pocket Buddy core failed to start", error));

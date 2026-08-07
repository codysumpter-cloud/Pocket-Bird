import { getShadowRoot, makeClosable, makeDraggable, makeElement, onClick } from "./shared.js";

const HOME_ID = "pocket-buddy-home";
const COLS = 8;
const ROWS = 6;
const TILE_W = 56;
const TILE_H = 28;
const ORIGIN_X = 360;
const ORIGIN_Y = 76;
const ACTOR_STEP_MS = 850;
const HUMAN_IDLE_STEP_MS = 1700;

const FURNITURE = Object.freeze([
	{ id: "bed", label: "Bed", cell: { x: 1, y: 1 }, action: "rest", block: true },
	{ id: "bowl", label: "Food bowl", cell: { x: 6, y: 1 }, action: "feed", block: true },
	{ id: "toy", label: "Toy", cell: { x: 5, y: 4 }, action: "play", block: false },
	{ id: "chair", label: "Chair", cell: { x: 2, y: 4 }, action: null, block: true },
]);

let activeHome = null;

export function isBuddyHomeOpen() {
	return Boolean(activeHome?.window?.isConnected);
}

export function closeBuddyHome() {
	activeHome?.close();
}

/**
 * Open the lightweight Home presentation. Buddy state remains owned by the
 * Buddy core; this layer only decides room positions and turns furniture use
 * into care intents.
 * @param {{
 *   getBuddySnapshot: () => any,
 *   onCare: (action: string) => void|Promise<void>,
 *   getPetCanvas: () => HTMLCanvasElement|null,
 *   onOpenChange?: (open: boolean) => void,
 *   initialMode?: "play"|"idle"
 * }} options
 */
export function openBuddyHome(options) {
	if (isBuddyHomeOpen()) {
		activeHome.window.style.display = "flex";
		return activeHome;
	}
	installHomeStyles();

	const content = makeElement("pocket-buddy-home-content");
	const toolbar = makeElement("pocket-buddy-home-toolbar");
	const playButton = document.createElement("button");
	playButton.textContent = "Play";
	const idleButton = document.createElement("button");
	idleButton.textContent = "Idle";
	const help = makeElement("pocket-buddy-home-help", "WASD / arrows move your human. Click Buddy to pet. Click furniture to use it.");
	toolbar.append(playButton, idleButton);

	const stage = document.createElement("canvas");
	stage.className = "pocket-buddy-home-stage";
	stage.width = 720;
	stage.height = 480;
	stage.tabIndex = 0;
	stage.setAttribute("aria-label", "Playable Buddy Home");
	content.append(toolbar, stage, help);

	const windowElement = createWindow(HOME_ID, "Buddy Home", content, () => close());
	center(windowElement);

	const ctx = stage.getContext("2d");
	if (!ctx) {
		windowElement.remove();
		throw new Error("Buddy Home needs a 2D canvas context.");
	}
	ctx.imageSmoothingEnabled = false;

	let mode = options.initialMode === "idle" ? "idle" : "play";
	let human = { x: 1, y: 4 };
	let buddy = { x: 4, y: 3 };
	let humanFacing = "right";
	let buddyFacing = "left";
	let closed = false;
	let lastBuddyStep = 0;
	let lastHumanIdleStep = 0;
	let animationFrame = 0;

	function syncButtons() {
		playButton.classList.toggle("active", mode === "play");
		idleButton.classList.toggle("active", mode === "idle");
	}

	function setMode(next) {
		mode = next === "idle" ? "idle" : "play";
		syncButtons();
		stage.focus();
	}

	onClick(playButton, () => setMode("play"));
	onClick(idleButton, () => setMode("idle"));

	const keyHandler = (event) => {
		if (closed || mode !== "play" || !windowElement.isConnected) return;
		const direction = directionForKey(event.key);
		if (!direction) return;
		event.preventDefault();
		human = step(human, direction, buddy);
		humanFacing = direction.x < 0 ? "left" : direction.x > 0 ? "right" : humanFacing;
	};
	document.addEventListener("keydown", keyHandler);

	stage.addEventListener("click", (event) => {
		const rect = stage.getBoundingClientRect();
		const scaleX = stage.width / Math.max(1, rect.width);
		const scaleY = stage.height / Math.max(1, rect.height);
		const x = (event.clientX - rect.left) * scaleX;
		const y = (event.clientY - rect.top) * scaleY;
		const buddyPoint = project(buddy);
		if (Math.hypot(x - buddyPoint.x, y - (buddyPoint.y - 24)) < 34) {
			void options.onCare("pet");
			return;
		}
		for (const item of FURNITURE) {
			const point = project(item.cell);
			if (Math.hypot(x - point.x, y - (point.y - 12)) < 34 && item.action) {
				void options.onCare(item.action);
				return;
			}
		}
	});

	function close() {
		if (closed) return;
		closed = true;
		document.removeEventListener("keydown", keyHandler);
		windowElement.remove();
		if (activeHome?.window === windowElement) activeHome = null;
		options.onOpenChange?.(false);
	}

	function tick(now) {
		if (closed || !windowElement.isConnected) return;
		if (mode === "idle" && now - lastHumanIdleStep >= HUMAN_IDLE_STEP_MS) {
			lastHumanIdleStep = now;
			const direction = randomDirection();
			const next = step(human, direction, buddy);
			if (next.x !== human.x) humanFacing = next.x < human.x ? "left" : "right";
			human = next;
		}
		if (now - lastBuddyStep >= ACTOR_STEP_MS) {
			lastBuddyStep = now;
			const target = buddyTarget(options.getBuddySnapshot(), human);
			const next = stepToward(buddy, target, human);
			if (next.x !== buddy.x) buddyFacing = next.x < buddy.x ? "left" : "right";
			buddy = next;
		}
		drawRoom(ctx, human, humanFacing, buddy, buddyFacing, options.getPetCanvas(), options.getBuddySnapshot());
		animationFrame = requestAnimationFrame(tick);
	}

	activeHome = { window: windowElement, close, setMode, get mode() { return mode; }, get animationFrame() { return animationFrame; } };
	options.onOpenChange?.(true);
	syncButtons();
	stage.focus();
	animationFrame = requestAnimationFrame(tick);
	return activeHome;
}

function createWindow(id, title, content, onClose) {
	const windowElement = makeElement("birb-window", undefined, id);
	windowElement.classList.add("pocket-buddy-home-window");
	const header = makeElement("birb-window-header");
	const titleElement = makeElement("birb-window-title", title);
	const closeButton = makeElement("birb-window-close", "x");
	header.append(titleElement, closeButton);
	const contentWrapper = makeElement("birb-window-content");
	contentWrapper.appendChild(content);
	windowElement.append(header, contentWrapper);
	getShadowRoot().appendChild(windowElement);
	makeDraggable(header);
	makeClosable(onClose, closeButton);
	return windowElement;
}

function center(element) {
	element.style.left = `${Math.max(12, window.innerWidth / 2 - 360)}px`;
	element.style.top = `${Math.max(18, window.innerHeight / 2 - 260)}px`;
}

function directionForKey(key) {
	switch (key.toLowerCase()) {
		case "w": case "arrowup": return { x: 0, y: -1 };
		case "s": case "arrowdown": return { x: 0, y: 1 };
		case "a": case "arrowleft": return { x: -1, y: 0 };
		case "d": case "arrowright": return { x: 1, y: 0 };
		default: return null;
	}
}

function randomDirection() {
	return [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }][Math.floor(Math.random() * 4)];
}

function occupied(cell) {
	return FURNITURE.some((item) => item.block && item.cell.x === cell.x && item.cell.y === cell.y);
}

function step(current, direction, reserved) {
	const next = { x: current.x + direction.x, y: current.y + direction.y };
	if (next.x < 0 || next.x >= COLS || next.y < 0 || next.y >= ROWS) return current;
	if (occupied(next) || (reserved && next.x === reserved.x && next.y === reserved.y)) return current;
	return next;
}

function stepToward(current, target, reserved) {
	const candidates = [];
	if (target.x > current.x) candidates.push({ x: 1, y: 0 });
	if (target.x < current.x) candidates.push({ x: -1, y: 0 });
	if (target.y > current.y) candidates.push({ x: 0, y: 1 });
	if (target.y < current.y) candidates.push({ x: 0, y: -1 });
	for (const direction of candidates) {
		const next = step(current, direction, reserved);
		if (next !== current) return next;
	}
	return current;
}

function buddyTarget(snapshot, human) {
	const need = snapshot?.dominantNeed;
	if (need === "hunger") return neighborOf("bowl");
	if (need === "energy" || need === "comfort") return neighborOf("bed");
	if (need === "play") return neighborOf("toy");
	if (need === "social") return human;
	return Math.random() < 0.55 ? human : { x: 4, y: 3 };
}

function neighborOf(id) {
	const item = FURNITURE.find((entry) => entry.id === id);
	if (!item) return { x: 4, y: 3 };
	const candidates = [
		{ x: item.cell.x - 1, y: item.cell.y },
		{ x: item.cell.x + 1, y: item.cell.y },
		{ x: item.cell.x, y: item.cell.y + 1 },
		{ x: item.cell.x, y: item.cell.y - 1 },
	].filter((cell) => cell.x >= 0 && cell.x < COLS && cell.y >= 0 && cell.y < ROWS && !occupied(cell));
	return candidates[0] ?? { x: 4, y: 3 };
}

function project(cell) {
	return {
		x: ORIGIN_X + (cell.x - cell.y) * TILE_W / 2,
		y: ORIGIN_Y + (cell.x + cell.y) * TILE_H / 2,
	};
}

function drawRoom(ctx, human, humanFacing, buddy, buddyFacing, petCanvas, snapshot) {
	ctx.clearRect(0, 0, 720, 480);
	ctx.fillStyle = "#182033";
	ctx.fillRect(0, 0, 720, 480);

	for (let y = 0; y < ROWS; y += 1) {
		for (let x = 0; x < COLS; x += 1) drawDiamond(ctx, project({ x, y }), (x + y) % 2 ? "#c79463" : "#d1a06e");
	}
	drawWalls(ctx);

	const drawables = [
		...FURNITURE.map((item) => ({ kind: "item", y: project(item.cell).y, item })),
		{ kind: "human", y: project(human).y },
		{ kind: "buddy", y: project(buddy).y },
	].sort((a, b) => a.y - b.y);
	for (const drawable of drawables) {
		if (drawable.kind === "item") drawFurniture(ctx, drawable.item);
		else if (drawable.kind === "human") drawHuman(ctx, project(human), humanFacing);
		else drawBuddy(ctx, project(buddy), buddyFacing, petCanvas, snapshot);
	}

	ctx.font = "13px Monocraft, monospace";
	ctx.fillStyle = "rgba(255,255,255,.72)";
	ctx.fillText(`${snapshot?.displayName ?? "Buddy"} · ${snapshot?.mood ?? "content"}`, 14, 462);
}

function drawDiamond(ctx, point, fill) {
	ctx.beginPath();
	ctx.moveTo(point.x, point.y - TILE_H / 2);
	ctx.lineTo(point.x + TILE_W / 2, point.y);
	ctx.lineTo(point.x, point.y + TILE_H / 2);
	ctx.lineTo(point.x - TILE_W / 2, point.y);
	ctx.closePath();
	ctx.fillStyle = fill;
	ctx.fill();
	ctx.strokeStyle = "#6e5142";
	ctx.lineWidth = 1;
	ctx.stroke();
}

function drawWalls(ctx) {
	const back = [project({ x: 0, y: 0 }), project({ x: COLS - 1, y: 0 }), project({ x: COLS - 1, y: ROWS - 1 })];
	ctx.strokeStyle = "#a77868";
	ctx.lineWidth = 5;
	for (const point of back) {
		ctx.beginPath(); ctx.moveTo(point.x, point.y); ctx.lineTo(point.x, point.y - 86); ctx.stroke();
	}
	ctx.lineWidth = 3;
	ctx.beginPath(); ctx.moveTo(back[0].x, back[0].y - 86); ctx.lineTo(back[1].x, back[1].y - 86); ctx.stroke();
	ctx.beginPath(); ctx.moveTo(back[1].x, back[1].y - 86); ctx.lineTo(back[2].x, back[2].y - 86); ctx.stroke();
}

function drawFurniture(ctx, item) {
	const point = project(item.cell);
	ctx.fillStyle = "rgba(10,14,25,.25)";
	ctx.beginPath(); ctx.ellipse(point.x, point.y + 5, 22, 8, 0, 0, Math.PI * 2); ctx.fill();
	if (item.id === "bed") {
		ctx.fillStyle = "#8c6fb2"; ctx.fillRect(point.x - 30, point.y - 30, 60, 28);
		ctx.fillStyle = "#d8c9ec"; ctx.fillRect(point.x - 24, point.y - 26, 22, 9);
	} else if (item.id === "bowl") {
		ctx.fillStyle = "#d9824b"; ctx.fillRect(point.x - 12, point.y - 10, 24, 10);
		ctx.fillStyle = "#ffc276"; ctx.fillRect(point.x - 8, point.y - 11, 16, 3);
	} else if (item.id === "toy") {
		ctx.fillStyle = "#4f9ce8"; ctx.beginPath(); ctx.arc(point.x, point.y - 10, 10, 0, Math.PI * 2); ctx.fill();
	} else {
		ctx.fillStyle = "#9f704d"; ctx.fillRect(point.x - 13, point.y - 29, 26, 28);
		ctx.fillStyle = "#d9a77c"; ctx.fillRect(point.x - 10, point.y - 24, 20, 8);
	}
}

function drawHuman(ctx, point, facing) {
	ctx.save();
	ctx.translate(point.x, point.y - 10);
	if (facing === "left") ctx.scale(-1, 1);
	ctx.fillStyle = "#f0c6a8"; ctx.fillRect(-6, -28, 12, 10);
	ctx.fillStyle = "#2f3548"; ctx.fillRect(-7, -32, 14, 5);
	ctx.fillStyle = "#4e8ee8"; ctx.fillRect(-7, -18, 14, 15);
	ctx.fillStyle = "#24334f"; ctx.fillRect(-7, -3, 6, 13); ctx.fillRect(2, -3, 6, 13);
	ctx.fillStyle = "#161b29"; ctx.fillRect(-8, 9, 7, 4); ctx.fillRect(2, 9, 7, 4);
	ctx.restore();
}

function drawBuddy(ctx, point, facing, petCanvas, snapshot) {
	ctx.fillStyle = "rgba(10,14,25,.25)";
	ctx.beginPath(); ctx.ellipse(point.x, point.y + 4, 18, 7, 0, 0, Math.PI * 2); ctx.fill();
	if (petCanvas && petCanvas.width > 0 && petCanvas.height > 0) {
		try {
			const size = 58;
			ctx.save();
			if (facing === "left") { ctx.translate(point.x, 0); ctx.scale(-1, 1); ctx.translate(-point.x, 0); }
			ctx.imageSmoothingEnabled = false;
			ctx.drawImage(petCanvas, point.x - size / 2, point.y - size + 6, size, size);
			ctx.restore();
			return;
		} catch { /* fallback below */ }
	}
	ctx.fillStyle = "#ffd84d"; ctx.beginPath(); ctx.arc(point.x, point.y - 20, 18, 0, Math.PI * 2); ctx.fill();
	ctx.fillStyle = "#422f2f"; ctx.fillRect(point.x - 7, point.y - 24, 3, 3); ctx.fillRect(point.x + 5, point.y - 24, 3, 3);
	if (snapshot?.mood === "happy" || snapshot?.mood === "adoring") { ctx.fillRect(point.x - 2, point.y - 15, 5, 2); }
}

function installHomeStyles() {
	const root = getShadowRoot();
	if (root.getElementById("pocket-buddy-home-style")) return;
	const style = document.createElement("style");
	style.id = "pocket-buddy-home-style";
	style.textContent = `
		.pocket-buddy-home-window { width: min(760px, 94vw); max-height: 92vh; }
		.pocket-buddy-home-window .birb-window-content { padding: 0; overflow: hidden; }
		.pocket-buddy-home-content { width: 100%; display: flex; flex-direction: column; align-items: stretch; }
		.pocket-buddy-home-toolbar { display:flex; gap:8px; padding:8px; justify-content:center; background:var(--birb-background-color); }
		.pocket-buddy-home-toolbar button { font: 12px Monocraft, monospace; border:2px solid var(--birb-highlight); background:#fff; padding:4px 10px; cursor:pointer; }
		.pocket-buddy-home-toolbar button.active { background:var(--birb-highlight); color:#fff; }
		.pocket-buddy-home-stage { width:100%; max-height:70vh; aspect-ratio:3/2; image-rendering:pixelated; outline:none; background:#182033; }
		.pocket-buddy-home-help { padding:7px 10px 9px; font:11px Monocraft, monospace; opacity:.72; text-align:center; }
	`;
	root.appendChild(style);
}

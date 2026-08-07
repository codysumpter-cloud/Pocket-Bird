import { getShadowRoot } from "./shared.js";

const DISPLAY_SIZE = 64;
const DEFAULT_COLUMNS = 8;
const DEFAULT_ROWS = 9;
const ROW_FRAMES = Object.freeze([6, 8, 8, 4, 5, 8, 6, 6, 6]);
const ROW_FRAME_MS = Object.freeze([900, 125, 125, 180, 150, 150, 170, 135, 170]);

/**
 * Presentation adapter that lets the original Pocket Bird movement engine move
 * any OpenPets/My Pets sprite. The original canvas stays alive (and remains the
 * click target); this canvas only replaces what the user sees.
 */
export class PocketBuddyPetOverlay {
	constructor(sourceCanvas) {
		this.source = sourceCanvas;
		this.canvas = document.createElement("canvas");
		this.canvas.id = "pocket-buddy-active-pet";
		this.canvas.width = DISPLAY_SIZE;
		this.canvas.height = DISPLAY_SIZE;
		this.ctx = this.canvas.getContext("2d");
		this.ctx.imageSmoothingEnabled = false;
		this.canvas.setAttribute("aria-hidden", "true");
		this.canvas.style.pointerEvents = "none";
		this.image = null;
		this.pet = null;
		this.loaded = false;
		this.destroyed = false;
		this.reactionRow = null;
		this.reactionUntil = 0;
		this.lastX = null;
		this.lastBottom = null;
		this.lastMovedAt = 0;
		this.direction = "right";
		this.standaloneVisible = true;
		this.originalInlineOpacity = sourceCanvas.style.opacity;
		this.originalInlineTransform = sourceCanvas.style.transform;
		this.originalInlineVisibility = sourceCanvas.style.visibility;
		installStyle();
		getShadowRoot().appendChild(this.canvas);
		requestAnimationFrame((now) => this.loop(now));
	}

	get selectedPet() { return this.pet; }
	get visualCanvas() { return this.loaded ? this.canvas : this.source; }

	async select(pet) {
		if (!pet) { this.clear(); return; }
		const src = pet.dataUrl || pet.spriteUrl;
		if (typeof src !== "string" || !src) throw new Error("Selected pet has no sprite image.");
		this.loaded = false;
		this.pet = pet;
		const image = new Image();
		if (!src.startsWith("data:")) image.crossOrigin = "anonymous";
		this.image = image;
		await new Promise((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error(`Could not load ${pet.displayName || "pet"} sprite.`));
			image.src = src;
		});
		if (this.image !== image || this.pet !== pet) return;
		this.loaded = true;
		this.source.style.opacity = "0";
		// Match the external 64px visual with a 64px invisible hit target while
		// preserving the source canvas's 32px layout coordinates.
		this.source.style.transform = "scale(calc(var(--birb-scale) * 2))";
		this.syncVisibility();
	}

	clear() {
		this.pet = null;
		this.image = null;
		this.loaded = false;
		this.ctx.clearRect(0, 0, DISPLAY_SIZE, DISPLAY_SIZE);
		this.source.style.opacity = this.originalInlineOpacity;
		this.source.style.transform = this.originalInlineTransform;
		this.canvas.style.display = "none";
		this.syncVisibility();
	}

	setStandaloneVisible(visible) {
		this.standaloneVisible = visible !== false;
		this.syncVisibility();
	}

	react(kind) {
		const rowByKind = { pet: 4, feed: 0, play: 3, rest: 0, clean: 3, success: 4, error: 5 };
		const row = rowByKind[kind];
		if (Number.isInteger(row)) {
			this.reactionRow = row;
			this.reactionUntil = performance.now() + (kind === "rest" ? 1800 : 1200);
		}
	}

	destroy() {
		this.destroyed = true;
		this.clear();
		this.source.style.visibility = this.originalInlineVisibility;
		this.canvas.remove();
	}

	syncVisibility() {
		const visibility = this.standaloneVisible ? this.originalInlineVisibility || "visible" : "hidden";
		this.source.style.visibility = visibility;
		this.canvas.style.visibility = visibility;
		if (this.loaded) this.canvas.style.display = "block";
	}

	loop(now) {
		if (this.destroyed) return;
		this.syncPosition(now);
		if (this.loaded && this.image) this.draw(now);
		requestAnimationFrame((next) => this.loop(next));
	}

	syncPosition(now) {
		const x = parseFloat(this.source.style.left || "0");
		const bottom = parseFloat(this.source.style.bottom || "0");
		if (this.lastX !== null && Math.abs(x - this.lastX) > 0.2) {
			this.direction = x < this.lastX ? "left" : "right";
			this.lastMovedAt = now;
		}
		if (this.lastBottom !== null && Math.abs(bottom - this.lastBottom) > 0.2) this.lastMovedAt = now;
		this.lastX = x;
		this.lastBottom = bottom;

		const sourceWidth = Number(this.source.width || 32);
		const centerX = x + sourceWidth / 2;
		this.canvas.style.left = `${centerX - DISPLAY_SIZE / 2}px`;
		this.canvas.style.bottom = this.source.style.bottom || "0px";
		this.canvas.classList.toggle("pocket-buddy-absolute", this.source.classList.contains("birb-absolute"));
	}

	draw(now) {
		const image = this.image;
		const ctx = this.ctx;
		ctx.clearRect(0, 0, DISPLAY_SIZE, DISPLAY_SIZE);
		const atlas = atlasGeometry(image);
		if (!atlas) {
			drawContained(ctx, image, 0, 0, image.naturalWidth || image.width, image.naturalHeight || image.height);
			return;
		}
		let row;
		if (this.reactionRow !== null && now < this.reactionUntil) row = this.reactionRow;
		else {
			this.reactionRow = null;
			row = now - this.lastMovedAt < 180 ? (this.direction === "left" ? 2 : 1) : 0;
		}
		row = Math.max(0, Math.min(atlas.rows - 1, row));
		const frameCount = Math.max(1, Math.min(atlas.columns, ROW_FRAMES[row] ?? atlas.columns));
		const frameMs = ROW_FRAME_MS[row] ?? 150;
		const frame = Math.floor(now / frameMs) % frameCount;
		drawContained(ctx, image, frame * atlas.frameWidth, row * atlas.frameHeight, atlas.frameWidth, atlas.frameHeight);
	}
}

function atlasGeometry(image) {
	const width = Number(image.naturalWidth || image.width || 0);
	const height = Number(image.naturalHeight || image.height || 0);
	if (!(width > 0) || !(height > 0)) return null;
	if (width % DEFAULT_COLUMNS !== 0 || height % DEFAULT_ROWS !== 0) return null;
	const frameWidth = width / DEFAULT_COLUMNS;
	const frameHeight = height / DEFAULT_ROWS;
	if (frameWidth < 8 || frameHeight < 8) return null;
	return { columns: DEFAULT_COLUMNS, rows: DEFAULT_ROWS, frameWidth, frameHeight };
}

function drawContained(ctx, image, sx, sy, sw, sh) {
	const padding = 2;
	const scale = Math.min((DISPLAY_SIZE - padding * 2) / sw, (DISPLAY_SIZE - padding * 2) / sh);
	const width = Math.max(1, Math.round(sw * scale));
	const height = Math.max(1, Math.round(sh * scale));
	const dx = Math.round((DISPLAY_SIZE - width) / 2);
	const dy = DISPLAY_SIZE - padding - height;
	ctx.imageSmoothingEnabled = false;
	try { ctx.drawImage(image, sx, sy, sw, sh, dx, dy, width, height); } catch { /* keep last valid frame */ }
}

function installStyle() {
	const root = getShadowRoot();
	if (root.getElementById("pocket-buddy-pet-overlay-style")) return;
	const style = document.createElement("style");
	style.id = "pocket-buddy-pet-overlay-style";
	style.textContent = `
		#pocket-buddy-active-pet {
			image-rendering: pixelated;
			position: fixed;
			bottom: 0;
			transform: scale(var(--birb-scale));
			transform-origin: bottom;
			z-index: 2147483638;
		}
		#pocket-buddy-active-pet.pocket-buddy-absolute { position: absolute; }
	`;
	root.appendChild(style);
}

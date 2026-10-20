// DeepSeek Whale Girl (鲸鱼娘) Canvas 2D vector renderer.
//
// Extracted from design/avatars/blue-maid.svg and mapped to BotEngine's body
// space (origin at the body centre, y down, R = W × 0.3).
//
// Three groups, each transformed differently so a glance reads as a head turn
// rather than eyes sliding over a flat face:
//
//   back  — back hair, headband, ears. Fixed: this is the skull.
//   face  — hair crown, face, blush, eyes. Turns with the gaze.
//   front — fringe, sidelocks, bow, ahoge. Follows at half rate (parallax).
//
// The whole head is also squashed vertically. Measured on the artwork the
// silhouette was almost square (607 × 590), which read as an upright slab at
// icelane size; HEAD_SQUASH widens that ratio to ~1.20 and the eyes are
// compensated so they keep their shape through the compression.

/** Vertical compression of the whole head. 1 = the raw artwork. */
export const HEAD_SQUASH = 0.86;

/**
 * Eye size in engine units, pre-divided by HEAD_SQUASH so that after the head
 * is squashed they land at the 0.21 × 0.44 Mochi has always used.
 */
const EYE_W = 0.244;
const EYE_H = 0.512;

/** How far the face slides sideways per unit of yaw (× R). */
const TURN_SHIFT = 0.06;
/** How much the face narrows per unit of yaw. */
const TURN_SQUEEZE = 0.06;

export interface WhaleContext {
  R: number;
  yaw: number;
  pitch: number;
  roll: number;
  tilt: number;
  open: number;
  blush: number;
  tint: number;
  physDx: number;
  physDy: number;
  eyeShape: string;
}

/** Draws the eyes; receives a clip already mapped into engine space. */
export type WhaleEyes = (ctx: CanvasRenderingContext2D, clip: Path2D) => void;

const RUFFLES: readonly [number, number, number][] = [
  [125, 236, -70],
  [151, 188, -52],
  [192, 149, -34],
  [245, 125, -17],
  [305, 117, 0],
  [366, 124, 17],
  [422, 147, 34],
  [468, 184, 52],
  [501, 231, 70],
  [517, 282, 87],
];

interface WhalePaths {
  backHairBase: Path2D;
  backHairLace: Path2D;
  backHairDark: Path2D;
  headbandBase: Path2D;
  ruffle: Path2D;
  finBody: Path2D;
  finCrease: Path2D;
  finBelly: Path2D;
  finBellyDetail: Path2D;
  face: Path2D;
  hairCrownBase: Path2D;
  hairCrownShadow: Path2D;
  fringeBridge: Path2D;
  fringeMainLeft: Path2D;
  fringeUpperLeft: Path2D;
  fringeMid: Path2D;
  fringeRight: Path2D;
  fringeUpperRight: Path2D;
  sidelockLeft: Path2D;
  sidelockRight: Path2D;
  sidelockDarkL: Path2D;
  sidelockDarkR: Path2D;
  flowHlL: Path2D;
  flowHlR: Path2D;
  flowHlM: Path2D;
  strokeL: Path2D;
  strokeR: Path2D;
  bowTail: Path2D;
  bowWings: Path2D;
  bowCrease: Path2D;
  ahogeBase: Path2D;
  ahogeShadow: Path2D;
}

let cachedPaths: WhalePaths | null = null;

function getPaths(): WhalePaths {
  if (cachedPaths) return cachedPaths;
  if (typeof Path2D === "undefined") {
    // Node.js test environments have no Path2D; nothing is drawn there.
    return {} as WhalePaths;
  }
  cachedPaths = {
    backHairBase: new Path2D(
      "M135 303C97 378 121 484 75 548C103 571 131 571 156 553L143 591Q174 595 196 575L196 607Q233 596 252 535L387 535Q409 598 445 608L444 575Q470 598 497 588L486 553Q522 579 568 550C515 489 541 385 502 306Z"
    ),
    backHairLace: new Path2D(
      "M87 533Q112 555 148 543Q156 565 177 568Q164 583 148 576Q122 586 108 567Q91 566 80 550Z M485 543Q520 555 554 533L568 550Q546 570 524 564Q504 583 486 571L472 559Z"
    ),
    backHairDark: new Path2D(
      "M163 447Q159 528 143 554Q176 544 195 511L191 585Q223 557 233 515Z M448 446L413 515Q421 560 448 589L441 518Q462 546 486 555Q467 503 472 451Z"
    ),
    headbandBase: new Path2D(
      "M103 284C83 174 172 91 308 89C445 84 540 169 537 281L503 317L131 318Z"
    ),
    ruffle: new Path2D(
      "M-27 18 Q-35-4-30-27 Q-28-43 0-45 Q28-43 30-27 Q35-4 27 18Z"
    ),
    finBody: new Path2D(
      "M501 326C541 332 541 376 562 412C581 446 604 470 624 480C614 498 591 504 569 496C537 489 514 466 501 438C487 406 480 361 501 326Z"
    ),
    finCrease: new Path2D(
      "M507 343C529 366 531 406 552 439Q579 474 611 479C575 485 547 467 529 444C509 415 504 379 507 343Z"
    ),
    finBelly: new Path2D(
      "M510 438C535 471 578 491 624 480C618 492 608 499 595 500Q581 511 567 501Q550 505 539 492Q521 489 519 476Q507 465 510 438Z"
    ),
    finBellyDetail: new Path2D(
      "M510 438Q525 463 543 473Q546 485 552 493Q531 484 519 476Q507 465 510 438Z"
    ),
    face: new Path2D(
      "M132 293C142 204 225 170 319 175C416 172 500 218 509 308C525 368 519 432 492 474C460 528 397 555 321 557C244 558 177 534 141 486C112 449 113 409 119 365C121 340 125 313 132 293Z"
    ),
    hairCrownBase: new Path2D(
      "M117 403C93 352 98 286 128 234C167 169 234 130 308 126C390 118 463 156 503 219C542 277 549 358 520 423C507 472 480 507 450 525L184 525Q137 503 117 403Z"
    ),
    hairCrownShadow: new Path2D(
      "M119 299C132 229 189 170 255 149Q361 121 434 165C352 133 272 156 221 195Q160 238 119 299Z"
    ),
    fringeBridge: new Path2D(
      "M365 155C404 158 436 195 436 250L423 310L391 330L380 230Z"
    ),
    fringeMainLeft: new Path2D(
      "M330 144C260 133 195 167 155 219C129 255 117 303 119 347C174 329 230 296 267 258C251 287 243 310 243 330C280 304 313 259 326 212C337 180 338 153 330 144Z"
    ),
    fringeUpperLeft: new Path2D(
      "M291 148C235 139 177 170 148 211C125 244 118 273 118 298Q134 289 149 275Q133 303 130 317C176 298 214 258 240 213C256 185 274 161 291 148Z"
    ),
    fringeMid: new Path2D(
      "M325 146C283 161 259 203 262 258C263 304 277 337 303 349Q290 316 300 290C308 340 345 378 384 384Q372 366 376 343C413 311 429 254 410 202C393 166 362 148 325 146Z"
    ),
    fringeRight: new Path2D(
      "M370 156C417 177 438 224 417 279C418 324 454 353 469 401Q477 372 472 346C493 378 489 413 478 438C519 408 532 355 518 293C506 236 463 190 370 156Z"
    ),
    fringeUpperRight: new Path2D(
      "M382 159C437 164 480 196 501 234Q522 263 524 295Q510 284 496 278Q508 302 508 320C479 298 456 269 447 242C433 202 410 175 382 159Z"
    ),
    sidelockLeft: new Path2D(
      "M150 248C106 284 95 349 108 414C112 457 132 491 163 514C144 479 140 440 150 405Q155 463 182 493C165 448 161 398 178 350C188 315 176 277 150 248Z"
    ),
    sidelockRight: new Path2D(
      "M499 275C531 313 544 383 529 445C521 489 505 527 470 548Q482 527 485 500Q462 529 428 520C471 483 474 437 468 394L462 346Z"
    ),
    sidelockDarkL: new Path2D("M129 328Q114 419 142 467Q133 415 149 373Z"),
    sidelockDarkR: new Path2D("M514 352Q536 445 493 510Q519 429 504 392Z"),
    flowHlL: new Path2D(
      "M163 232C190 192 233 168 272 167C228 185 199 211 178 240Q168 248 155 252Z"
    ),
    flowHlR: new Path2D(
      "M402 175C444 188 480 217 496 252Q487 245 479 242C461 216 433 192 402 175Z"
    ),
    flowHlM: new Path2D(
      "M300 181C278 212 276 251 287 281C283 240 292 208 311 184Z"
    ),
    strokeL: new Path2D("M278 157C224 166 181 212 157 256"),
    strokeR: new Path2D("M398 168C449 190 474 229 485 263"),
    bowTail: new Path2D("M-2 9L-10 71L14 57L28 72L13 10Z"),
    bowWings: new Path2D(
      "M-4-4C-25-36-48-48-49-24C-50-5-45 19-33 30C-26 36-13 25-2 11C11 32 31 38 37 24C43 11 44-19 36-30C29-40 9-21-4-4Z"
    ),
    bowCrease: new Path2D("M-6 5L-34-4Q-44 3-30 8Z M5 5L27-6Q36 1 24 8Z"),
    ahogeBase: new Path2D(
      "M330 142C365 111 374 73 344 51C305 22 252 32 220 58C260 9 324 8 366 34C412 62 401 116 354 142Z"
    ),
    ahogeShadow: new Path2D(
      "M222 56Q285 5 353 35Q386 51 388 82Q393 52 366 34C324 8 260 9 222 56Z"
    ),
  };
  return cachedPaths;
}

// ── Gradients ────────────────────────────────────────────────────────────────

interface Gradients {
  hair: CanvasGradient;
  bangs: CanvasGradient;
  back: CanvasGradient;
  skin: CanvasGradient;
  lace: CanvasGradient;
  fin: CanvasGradient;
  finBelly: CanvasGradient;
  ribbon: CanvasGradient;
}

function createGradients(ctx: CanvasRenderingContext2D): Gradients {
  const hair = ctx.createLinearGradient(128, 0, 512, 640);
  hair.addColorStop(0, "#465aa3");
  hair.addColorStop(0.55, "#4869b0");
  hair.addColorStop(1, "#729dd1");

  const bangs = ctx.createLinearGradient(288, 0, 352, 640);
  bangs.addColorStop(0, "#43579d");
  bangs.addColorStop(0.65, "#5075bb");
  bangs.addColorStop(1, "#779ed0");

  const back = ctx.createLinearGradient(0, 0, 640, 640);
  back.addColorStop(0, "#33417e");
  back.addColorStop(1, "#303d78");

  const skin = ctx.createRadialGradient(332, 320, 20, 332, 320, 280);
  skin.addColorStop(0, "#fffaf5");
  skin.addColorStop(1, "#fae8df");

  const lace = ctx.createLinearGradient(0, 0, 192, 640);
  lace.addColorStop(0, "#fffafd");
  lace.addColorStop(1, "#ede8f2");

  const fin = ctx.createLinearGradient(500, 320, 624, 500);
  fin.addColorStop(0, "#263469");
  fin.addColorStop(0.6, "#354985");
  fin.addColorStop(1, "#435c9e");

  const finBelly = ctx.createLinearGradient(0, 430, 0, 500);
  finBelly.addColorStop(0, "#d7d8e9");
  finBelly.addColorStop(1, "#f3eef7");

  const ribbon = ctx.createLinearGradient(-49, -40, 44, 38);
  ribbon.addColorStop(0, "#7eafe1");
  ribbon.addColorStop(1, "#5486c5");

  return { hair, bangs, back, skin, lace, fin, finBelly, ribbon };
}

// ── Draw ─────────────────────────────────────────────────────────────────────

/**
 * Draws the whole character into a context already centred on the body.
 * `eyes` is called between the face and the front hair so the fringe can fall
 * over the eyes, and receives the face as a clip in engine space.
 */
export function drawWhale(
  ctx: CanvasRenderingContext2D,
  c: WhaleContext,
  eyes: WhaleEyes,
): void {
  const p = getPaths();
  const { R, yaw } = c;
  const s = R / 205;
  const g = createGradients(ctx);

  const dx = yaw * R * TURN_SHIFT;
  const squeeze = 1 - Math.abs(yaw) * TURN_SQUEEZE;
  const earWiggle = Math.sin(performance.now() * 0.003) * 0.03 + c.physDx * 0.15;

  // The head as a whole is squashed, so no layer can slip out from under
  // another and leave a pale seam at the jaw.
  ctx.save();
  ctx.scale(1, HEAD_SQUASH);

  // ── 1. Back hair, headband, ears: the skull, fixed ─────────────────────
  ctx.save();
  ctx.scale(s, s);
  ctx.translate(-320, -390);

  ctx.fillStyle = g.back;
  ctx.fill(p.backHairBase);
  ctx.fillStyle = "#e6e0ee";
  ctx.fill(p.backHairLace);
  ctx.fillStyle = "#435996";
  ctx.fill(p.backHairDark);

  ctx.fillStyle = "#d5d1e5";
  ctx.fill(p.headbandBase);
  ctx.fillStyle = g.lace;
  for (const [x, y, deg] of RUFFLES) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.fill(p.ruffle);
    ctx.restore();
  }

  for (const side of [1, -1] as const) {
    ctx.save();
    if (side < 0) {
      ctx.translate(320, 0);
      ctx.scale(-1, 1);
      ctx.translate(-320, 0);
    }
    ctx.save();
    ctx.translate(501, 326);
    ctx.rotate(side * earWiggle);
    ctx.translate(-501, -326);
    ctx.fillStyle = g.fin;
    ctx.fill(p.finBody);
    ctx.fillStyle = "rgba(82, 108, 173, 0.55)";
    ctx.fill(p.finCrease);
    ctx.fillStyle = g.finBelly;
    ctx.fill(p.finBelly);
    ctx.fillStyle = "rgba(201, 201, 223, 0.55)";
    ctx.fill(p.finBellyDetail);
    ctx.restore();
    ctx.restore();
  }
  ctx.restore();

  // ── 2. Face group: turns with the gaze ─────────────────────────────────
  ctx.save();
  ctx.translate(dx, 0);
  ctx.scale(squeeze, 1);

  ctx.save();
  ctx.scale(s, s);
  ctx.translate(-320, -390);

  ctx.fillStyle = g.hair;
  ctx.fill(p.hairCrownBase);
  ctx.fillStyle = "rgba(62, 82, 149, 0.22)";
  ctx.fill(p.hairCrownShadow);

  ctx.fillStyle = g.skin;
  ctx.fill(p.face);

  const blushAlpha = Math.min(1, Math.max(c.blush, c.tint * 0.45));
  if (blushAlpha > 0.02) {
    ctx.fillStyle = `rgba(250, 203, 208, ${0.75 * blushAlpha})`;
    for (const [bx, by] of [[179, 463], [452, 463]] as const) {
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate((8 * Math.PI) / 180);
      ctx.beginPath();
      ctx.ellipse(0, 0, 33, 21, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();

  // Eyes: clipped to the face, in engine space.
  const clip = new Path2D();
  if (typeof DOMMatrix !== "undefined") {
    clip.addPath(p.face, new DOMMatrix().scale(s, s).translate(-320, -390));
  }
  eyes(ctx, clip);
  ctx.restore();

  // ── 3. Front hair: half the turn (parallax) ─────────────────────────────
  ctx.save();
  ctx.translate(dx * 0.5, 0);
  ctx.scale(1 - Math.abs(yaw) * 0.03, 1);
  ctx.scale(s, s);
  ctx.translate(-320, -390);

  ctx.fillStyle = g.bangs;
  ctx.fill(p.fringeBridge);
  ctx.fill(p.fringeMainLeft);
  ctx.fill(p.fringeUpperLeft);
  ctx.fill(p.fringeMid);
  ctx.fill(p.fringeRight);
  ctx.fill(p.fringeUpperRight);

  ctx.fillStyle = "rgba(152, 189, 234, 0.22)";
  ctx.fill(p.flowHlL);
  ctx.fillStyle = "rgba(152, 189, 234, 0.19)";
  ctx.fill(p.flowHlR);
  ctx.fillStyle = "rgba(162, 192, 236, 0.13)";
  ctx.fill(p.flowHlM);

  ctx.strokeStyle = "rgba(52, 77, 145, 0.22)";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.stroke(p.strokeL);
  ctx.stroke(p.strokeR);

  ctx.fillStyle = g.hair;
  ctx.fill(p.sidelockLeft);
  ctx.fill(p.sidelockRight);
  ctx.fillStyle = "rgba(60, 82, 149, 0.55)";
  ctx.fill(p.sidelockDarkL);
  ctx.fill(p.sidelockDarkR);

  ctx.save();
  ctx.translate(526, 355);
  ctx.rotate((9 * Math.PI) / 180);
  ctx.fillStyle = "#354a8b";
  ctx.fill(p.bowTail);
  ctx.fillStyle = g.ribbon;
  ctx.fill(p.bowWings);
  ctx.fillStyle = "rgba(70, 120, 182, 0.55)";
  ctx.fill(p.bowCrease);
  ctx.fillStyle = "#5e91cd";
  ctx.beginPath();
  ctx.roundRect(-10, -6, 17, 22, 7);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(330, 142);
  ctx.rotate(yaw * 0.35 + c.physDx * 0.25 + c.tilt * 0.35);
  ctx.translate(-330, -142);
  ctx.fillStyle = "#455aa5";
  ctx.fill(p.ahogeBase);
  ctx.fillStyle = "rgba(83, 107, 180, 0.5)";
  ctx.fill(p.ahogeShadow);
  ctx.restore();

  ctx.restore();

  ctx.restore();
}

/** Eye size in engine units, already compensated for the head squash. */
export const WHALE_EYE = { w: EYE_W, h: EYE_H } as const;

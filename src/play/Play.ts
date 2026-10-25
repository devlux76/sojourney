import { Scene } from "@babylonjs/core/scene";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { Vector3, type Matrix } from "@babylonjs/core/Maths/math.vector";
import { SpotLight } from "@babylonjs/core/Lights/spotLight";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Rucksack, EASY_START } from "./rucksack";
import { decideAll, ACTION_ICON, ACTION_TOOL, type Action, Target, PackView } from "./actions";
import { castDistance, Fight } from "./fish";
import { rayGround, Hit } from "./targeting";
import type { LineState } from "./fish";
import { Overlay } from "./Overlay";
import { HeldItem } from "./HeldItem";
import { sounds } from "./sounds";
import { Ground } from "../core/groundMotion";
import type { Observable } from "@babylonjs/core/Misc/observable";
import type { WorldSky } from "../engine/world";
import type { Pose } from "../core/pose";
import { touchLayoutActive } from "../core/isMobile";

export const REACH = 3;
export const CAST_REACH = 15;
// How many times the reticle names the Enter key before it is taken as learnt; the count is kept between visits.
const ENTER_REMINDERS = 5;
const ENTER_USES_KEY = "sojourney.enterUses";
const FLASHLIGHT_INTENSITY = 800;
const FLASHLIGHT_UNDERWATER = 300;
const FLASHLIGHT_RANGE = 60;
const FLASHLIGHT_ANGLE = 0.4;
const FLASHLIGHT_COLOUR = new Color3(1, 0.93, 0.8);

export interface ViewRay {
  origin: Vector3;
  dir: Vector3;
  ground: Hit | null;
}

export interface Found { target: Target; distance: number; perform(action: Action): void }

export interface Activity {
  find(ray: ViewRay): Found | null;
  update(dt: number): void;
}

export class Play {
  readonly rucksack: Rucksack;
  readonly overlay = new Overlay();
  darkness = 0;
  rain = 0;
  daylight = 1;
  underwater = false;
  lineState: () => LineState["kind"] = () => "idle";
  reel: () => void = () => {};
  fight: () => Fight | null = () => null;
  windUp: () => number | null = () => null;
  releaseCast: () => void = () => {};
  enterDown = false;
  // The rigid move the boat made this frame while the player is aboard it, or null; a cast line rides with it.
  vesselStep: () => Matrix | null = () => null;
  private enterUses = Number(localStorage.getItem(ENTER_USES_KEY) ?? 0);
  poseControl: { sit(seat: Vector3): void; stand(): void; tryLieDown(): void; trySit(): void; spawn(): void; pose(): Pose } | null = null;
  private held: HeldItem | null;
  private flashlight: SpotLight | null;
  private lightOn = false;
  underwaterView = false;
  // Whether the player is in the water. A swimmer's hands are busy: only the flashlight is held or used.
  private swimming = false;
  private activities: Activity[] = [];
  private found: Found | null = null;
  private action: Action | null = null;
  private ring: Action[] = [];
  onFrame: (() => void) | null = null;
  private resting = false;

  constructor(scene: Scene, readonly camera: Camera, readonly ground: Ground, dayNight: { onSky: Observable<WorldSky> },
    private blocked: () => boolean, options: { bareScene?: boolean } = {}) {
    // The bare-scene test owns no tools or inventory, so its interaction layer cannot add models.
    this.rucksack = new Rucksack(options.bareScene ? { tools: [], rations: 0 } : EASY_START);
    this.held = options.bareScene ? null : new HeldItem(scene, camera);
    this.flashlight = options.bareScene ? null : new SpotLight("flashlight", new Vector3(0.2, -0.15, 0.2), Vector3.Forward(), FLASHLIGHT_ANGLE, 2, scene);
    if (this.flashlight) {
      this.flashlight.parent = camera;
      this.flashlight.diffuse = FLASHLIGHT_COLOUR;
      this.flashlight.specular = FLASHLIGHT_COLOUR.scale(0.3);
      this.flashlight.range = FLASHLIGHT_RANGE;
      this.flashlight.intensity = 0;
    }

    dayNight.onSky.add(s => {
      this.darkness = s.darkness;
      this.rain = s.weather.rain;
      this.daylight = s.daylight;
      this.underwater = s.underwater;
      this.underwaterView = s.underwater;
      this.swimming = s.swimming;
    });
    window.addEventListener("keydown", e => this.onKey(e));
    window.addEventListener("keyup", e => { if (e.code === "Enter" || e.code === "NumpadEnter") this.letGo(); });
    window.addEventListener("blur", () => this.letGo());
    window.addEventListener("wheel", e => {
      if (!this.blocked() && !this.resting && e.deltaY !== 0) this.select(() => this.rucksack.cycle(e.deltaY > 0 ? 1 : -1));
    }, { passive: true });
    scene.onBeforeRenderObservable.add(() => this.update(scene.getEngine().getDeltaTime() / 1000));
    this.refresh();
  }

  add(activity: Activity) {
    this.activities.push(activity);
  }

  sit(seat: Vector3) {
    this.poseControl?.sit(seat);
  }

  setResting(resting: boolean) {
    this.resting = resting;
    this.overlay.muted = resting;
    this.held?.show(resting ? null : this.rucksack.held);
  }

  isResting(): boolean {
    return this.resting;
  }

  isBlocked(): boolean {
    return this.blocked();
  }

  ringActions(): Action[] {
    return this.ring;
  }

  pressSlot(n: number) {
    if (this.blocked() || this.resting) return;
    this.select(() => this.rucksack.pressSlot(n));
  }

  equipFor(action: Action) {
    const tool = ACTION_TOOL[action];
    if (!tool) return;
    this.select(() => this.rucksack.equip(tool));
  }

  pressAction(action: Action) {
    if (this.blocked()) return;
    if (this.resting) {
      this.standUp();
      return;
    }
    this.equipFor(action);
    this.enterDown = true;
    this.enter(action);
  }

  rodTip(): Vector3 {
    return this.held?.tipPosition() ?? this.camera.globalPosition;
  }

  private standUp() {
    this.poseControl?.stand();
  }

  lieDown() {
    this.poseControl?.tryLieDown();
  }

  sitDown() {
    this.poseControl?.trySit();
  }

  home() {
    this.poseControl?.spawn();
  }

  refresh() {
    this.overlay.setPanel(this.rucksack.lines());
  }

  private onKey(e: KeyboardEvent) {
    if (this.blocked()) return;
    if (e.code === "Tab") {
      e.preventDefault();
      if (!e.repeat && !this.resting) this.overlay.togglePanel();
    } else if (/^Digit[1-5]$/.test(e.code) && !e.repeat && !this.resting) {
      this.select(() => this.rucksack.pressSlot(Number(e.code.slice(5))));
    } else if ((e.code === "Enter" || e.code === "NumpadEnter") && !e.repeat) {
      if (this.resting) {
        if (this.poseControl?.pose() === "sitting") this.poseControl.stand();
        return;
      }
      this.enterDown = true;
      const action = this.action;
      if (!action) return;
      if (this.enterUses < ENTER_REMINDERS) localStorage.setItem(ENTER_USES_KEY, String(++this.enterUses));
      // The tool for the action comes out of the rucksack by itself, as it does for a touch button.
      this.equipFor(action);
      this.enter(action);
    }
  }

  private select(change: () => void) {
    const before = this.rucksack.held;
    change();
    if (this.rucksack.held === before) return;
    if (before === "flashlight") this.lightOn = false;
    if (before === "pole") this.reel();
    this.held?.show(this.rucksack.held);
    this.refresh();
  }

  letGo() {
    this.enterDown = false;
    if (this.windUp() === null) return;
    this.held?.swing();
    this.releaseCast();
  }

  enter(action: Action | null = this.action) {
    if (!action) return;
    if (action === "reel" && this.fight()) return;
    if (action !== "cast") this.held?.swing(action === "reel");
    if (action === "eat") {
      const food = this.rucksack.eat();
      if (food) {
        sounds.eat();
        this.overlay.say(cosyLine(food));
      }
    } else if (action === "light on" || action === "light off") {
      this.lightOn = action === "light on";
      sounds.click();
    } else if (action === "reel") {
      // Only reached while waiting for a bite: a hooked fish is reeled by holding Enter, not by this press.
      this.reel();
    } else {
      this.found?.perform(action);
    }
    this.refresh();
  }

  private packView(): PackView {
    const r = this.rucksack;
    return { held: r.held, tools: r.tools, logs: r.logs, rawFish: r.rawFish.length, food: r.nextFood(), lightOn: this.lightOn, line: this.lineState() };
  }

  private update(dt: number) {
    for (const a of this.activities) a.update(dt);
    const origin = this.camera.globalPosition;
    const dir = this.camera.getDirection(Vector3.Forward());
    const ground = rayGround(origin, dir, (x, z) => this.ground.getHeight(x, z), CAST_REACH);
    const ray: ViewRay = { origin, dir, ground };
    this.found = null;
    for (const a of this.activities) {
      const f = a.find(ray);
      if (f && (!this.found || f.distance < this.found.distance)) this.found = f;
    }
    // Going into the water puts away whatever is held but the flashlight (a line out is reeled in
    // on the way), and until the swimmer is out the flashlight's switch is the only action.
    if (this.swimming && this.rucksack.held && this.rucksack.held !== "flashlight") this.select(() => { this.rucksack.held = null; });
    this.ring = decideAll(this.found?.target ?? { kind: "none" }, this.packView())
      .filter(action => !this.swimming || action === "light on" || action === "light off");
    this.action = this.ring[0] ?? null;
    const power = this.windUp(), fight = this.fight();
    this.held?.pull(power ?? (fight ? (this.enterDown ? 0.3 + 0.7 * fight.tension : -0.25) : 0));
    // Words are kept for the moments of fishing; a standing action is shown by the reticle alone.
    // The hints name the Enter key only on a keyboard; on touch the action button is under the thumb.
    const touch = touchLayoutActive();
    const hint = power !== null ? `${touch ? "Let go" : "Let go of Enter"}  cast ${Math.round(castDistance(power))} m`
      : fight ? fightHint(fight, touch) : null;
    const blocked = this.blocked();
    // Enter is the keyboard's action key, so its name is shown only there, and only for the first few uses.
    const key = touch || this.enterUses >= ENTER_REMINDERS ? null : "Enter";
    // A lit flashlight shows what it is pointed at; its off switch needs no icon in the middle of that.
    const shown = blocked || !this.action || this.action === "light off" ? null : ACTION_ICON[this.action];
    this.overlay.setAction(shown, key);
    this.overlay.setHint(blocked ? null : hint);
    if (this.flashlight) this.flashlight.intensity = this.lightOn ? (this.underwater ? FLASHLIGHT_UNDERWATER : FLASHLIGHT_INTENSITY) : 0;
    this.onFrame?.();
  }
}

function fightHint(fight: Fight, touch: boolean): string {
  const lead = fight.tension > 0.8 ? (touch ? "Tight! Let go" : "Tight! Let go of Enter")
    : fight.tension <= 0 ? (touch ? "Slack! Hold" : "Slack! Hold Enter")
    : touch ? "Fish on!  Hold to reel" : "Fish on!  Hold Enter to reel";
  const filled = Math.round(fight.tension * 10);
  return `${lead}  ${Math.round(fight.distance)} m  ${"■".repeat(filled)}${"□".repeat(10 - filled)}`;
}

function cosyLine(food: string): string {
  return food === "a ration"
    ? "A ration bar and a sip of water. Just right."
    : `The ${food.replace("cooked ", "")}, smoky from the fire. Delicious.`;
}

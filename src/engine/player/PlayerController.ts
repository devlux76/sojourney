import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Vector3, type Matrix } from "@babylonjs/core/Maths/math.vector";
import type { Node } from "@babylonjs/core/node";
import { Animation } from "@babylonjs/core/Animations/animation";
import { CubicEase, EasingFunction } from "@babylonjs/core/Animations/easing";
import type { Scene } from "@babylonjs/core/scene";
import { Observable } from "@babylonjs/core/Misc/observable";
import { PhysicsCharacterController, CharacterSupportedState, type CharacterSurfaceInfo } from "@babylonjs/core/Physics/v2/characterController";
import { PhysicsShapeCapsule } from "@babylonjs/core/Physics/v2/physicsShape";
import type { Biome } from "../../biomes/Biome";
import { MAX_WALK_SLOPE } from "../../core/groundMotion";
import { settings } from "../../core/Settings";
import { BobState, stepBob, bobOffset, WALK_SPEED, RUN_SPEED } from "../../core/headBob";
import { Pose, POSES, eyeHeight, clampPitch, standsUp, canLieDown, easeTowards, reclineTilt, lieStartPitch } from "../../core/pose";
import { DEAD_ZONE, WALK_SPEED as STICK_WALK, stickSpeed, stickRunning, stickMagnitude, moveKey, yawDelta, pitchDelta, type StickVector, type StickKey } from "../../core/touchControl";
import { touchLayoutActive } from "../../core/isMobile";
import { WATER_Y } from "../pack";
import { inLake } from "../lake";
import { GRAVITY } from "../physics";
import { createGround, PLAYER_MASK, NO_GROUND, type PhysicsGround } from "./ground";
import { setMovementVectors } from "./movement";

const BODY_HEIGHT = 1.8;
const BODY_RADIUS = 0.3;
const FOOT_TO_EYE = POSES.standing.eyeAboveGround;
const CENTER_TO_EYE = FOOT_TO_EYE - BODY_HEIGHT / 2;
const MAX_STEP_HEIGHT = 0.3;
const JUMP_HEIGHT = 1.3;
const FALL_OUT_HEIGHT = -1000;
// A swimmer floats with the eye this far above the water, head out, so the view is of the lake and not
// of the water. Diving (C) takes the eye under; letting go floats back up.
const FLOAT_HEIGHT = 0.25;
// The body counts as in the water while the eye is no higher than this above the float level; without
// the margin a floating swimmer would stop swimming, drop, and start again every frame.
const FLOAT_MARGIN = 0.05;
const SWIM_SPEED = 3.6;
// How fast a swimmer gets along, at the surface or under it: a steady stroke, about half a walk,
// whatever the keys or the stick ask for. At walking pace a swimmer looked like someone walking on
// the water.
const STROKE_SPEED = 1.2;
// At the surface the swimmer's head rides the water: a slow swell while floating, and a quicker
// rise and dip with each stroke while moving. Metres and seconds; the eye stays above the water.
const SWELL_METRES = 0.05;
const SWELL_SECONDS = 3.2;
const STROKE_METRES = 0.07;
const STROKE_SECONDS = 1.5;
const BUOYANCY_SPEED = 1.2;
const ROTATION_SPEED = 0.03;
const POSE_EASE_RATE = 6;
const STEP_OFF_STUMP = 0.6;
const PITCH_EASE_SECONDS = 0.6;
const RECLINE_SPAN = 1;
const MAX_STEP_SECONDS = 0.05;
const JUMP_LIFTOFF_SECONDS = 0.2;
const TRAVEL_TURN_SECONDS = 1.2;
const TRAVEL_ZOOM_SECONDS = 0.8;
const TRAVEL_ZOOM_FOV = 0.2;
// Binoculars (B): holding it ramps from 1x to this zoom over ZOOM_SECONDS; letting go keeps
// the zoom, and pressing it again starts back at 1x.
const BINOCULAR_ZOOM = 10;
const BINOCULAR_SECONDS = 10;
const TRAVEL_MIN_METRES = 5;
const TRAVEL_FPS = 60;
const DOWN = new Vector3(0, -1, 0);
const UP = new Vector3(0, 1, 0);

export type PlayerBiome = { places: Biome["places"]; terrain: { worldSizeMetres: number } };

// Something the player can ride: its root node (the parent of its deck collision), and the rigid move
// and turn it made this frame.
export interface Vessel { root: Node; step: Matrix; yawStep: number }

export class PlayerController {
  public readonly camera: UniversalCamera;
  public readonly onPoseChange = new Observable<Pose>();
  public readonly ground: PhysicsGround;
  // Fired with the place's name each time a travel lands, so the game can say where that is.
  public readonly onTravel = new Observable<string>();
  // The boat, once the world has one, and whether the player is on it this frame.
  public vessel: Vessel | null = null;
  public aboard = false;
  private readonly body: PhysicsCharacterController;
  private readonly support: CharacterSurfaceInfo = {
    isSurfaceDynamic: false,
    supportedState: CharacterSupportedState.UNSUPPORTED,
    averageSurfaceNormal: new Vector3(0, 1, 0),
    averageSurfaceVelocity: new Vector3(),
    averageAngularSurfaceVelocity: new Vector3(),
  };
  // Movement scratch vectors persist across frames; Babylon's ToRef APIs consume them directly.
  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly wish = new Vector3();
  private readonly movementVelocity = new Vector3();
  private readonly gravity = new Vector3(0, -GRAVITY, 0);
  private readonly floatingPosition = new Vector3();
  private readonly integrationPosition = new Vector3();
  private readonly ridingPosition = new Vector3();
  private activeKeys: Record<string, boolean> = {};
  private virtualKeys = new Set<string>();
  private spawns: { name: string; position: Vector3; heading: number }[];
  // The last place T went to from home, so the next press at home goes on to the one after it.
  private lastPlace = 0;
  private worldBoundaryLimit: number;
  private grounded = false;
  private swimming = false;
  private jumpRequested = false;
  private airborne = 0;
  private currentPose: Pose = "standing";
  private seat: Vector3 | null = null;
  private touchStick: StickVector = { x: 0, y: 0 };
  private stickEngaged = false;
  private pitchTrim = 0;
  private easing = false;
  private eyeY = 0;
  private pitchTarget: number | null = null;
  private pitchEaseLeft = 0;
  private lieTilt = 0;
  private bob: BobState = { distance: 0, amplitude: 0 };
  private walked = 0;
  private travelling = false;
  private readonly lastXZ = { x: 0, z: 0 };
  // Binoculars narrow the camera's field of view; baseFov is the 1x end of the ramp.
  // zoomFactor is read by the streaming level-of-detail: at 10x the world 1 km off is drawn
  // as though 100 m off, so zooming shows the close-up levels, not the far smear.
  private readonly baseFov: number;
  zoomFactor = 1;
  private zooming = false;
  private zoomHeld = 0;

  constructor(scene: Scene, canvas: HTMLCanvasElement, biome: PlayerBiome) {
    this.spawns = biome.places.map(place => ({
      name: place.name,
      position: new Vector3(...place.position), heading: (place.headingDegrees * Math.PI) / 180,
    }));
    this.worldBoundaryLimit = biome.terrain.worldSizeMetres / 2;
    this.ground = createGround(scene);

    const shape = new PhysicsShapeCapsule(
      new Vector3(0, BODY_HEIGHT / 2 - BODY_RADIUS, 0), new Vector3(0, -BODY_HEIGHT / 2 + BODY_RADIUS, 0), BODY_RADIUS, scene);
    shape.filterMembershipMask = PLAYER_MASK;
    this.body = new PhysicsCharacterController(this.spawns[0].position.clone(), { shape }, scene);
    this.body.maxSlopeCosine = Math.cos(Math.atan(MAX_WALK_SLOPE));
    this.body.maxStepHeight = MAX_STEP_HEIGHT;
    this.body.keepDistance = 0.01;
    this.body.acceleration = 1;
    this.body.keepContactTolerance = 0.02;
    this.body.footOffset = BODY_HEIGHT / 2;

    const camera = new UniversalCamera("camera", this.spawns[0].position.clone(), scene);
    camera.attachControl(canvas, true);
    camera.inputs.removeByType("FreeCameraKeyboardMoveInput");
    if (touchLayoutActive()) camera.inputs.removeByType("FreeCameraMouseInput");
    camera.checkCollisions = false;
    camera.applyGravity = false;
    camera.minZ = 0.1;
    camera.maxZ = 20000;
    scene.activeCamera = camera;
    this.camera = camera;
    this.baseFov = camera.fov;

    canvas.addEventListener("click", () => canvas.focus());
    canvas.focus();

    window.addEventListener("keydown", (e) => {
      this.activeKeys[e.code] = true;
      // While travelling the animation owns the camera, so record the key but act on nothing.
      if (this.travelling) return;
      if (e.code !== "Enter" && e.code !== "NumpadEnter" && standsUp(this.currentPose, e.code)) {
        this.stand();
        if (e.code === "Space" || e.code === "KeyL" || e.code === "KeyK") return;
      }
      if (e.code === "KeyL") this.tryLieDown();
      if (e.code === "KeyK") this.trySit();
      if (e.code === "Space" && !e.repeat) this.jumpRequested = true;
      if (e.code === "KeyT" && !e.repeat) this.goHome();
      if (e.code === "KeyB" && !e.repeat) this.startZoom();
    });
    window.addEventListener("keyup", (e) => {
      this.activeKeys[e.code] = false;
      if (e.code === "KeyB") this.stopZoom();
    });
    window.addEventListener("blur", () => {
      for (const code of this.virtualKeys) this.activeKeys[code] = false;
      this.virtualKeys.clear();
    });

    scene.onBeforePhysicsObservable.add(() => this.step());
    camera.onAfterCheckInputsObservable.add(() => this.follow());
  }

  pose(): Pose {
    return this.currentPose;
  }

  isGrounded(): boolean {
    return this.grounded;
  }

  isSwimming(): boolean {
    return this.swimming;
  }

  position(): Vector3 {
    return this.body.getPosition();
  }

  velocity(): Vector3 {
    return this.body.getVelocity();
  }

  setTouchStick(v: StickVector) {
    this.touchStick = v;
    this.stickEngaged = stickMagnitude(v) > DEAD_ZONE;
  }

  setVirtualKey(code: string, down: boolean) {
    this.activeKeys[code] = down;
    if (down) this.virtualKeys.add(code); else this.virtualKeys.delete(code);
    if (code === "KeyB") {
      if (down) this.startZoom();
      else this.stopZoom();
      return;
    }
    if (!down) return;
    // While travelling the animation owns the camera, so record the key but act on nothing.
    if (this.travelling) return;
    if (code !== "Enter" && code !== "NumpadEnter" && standsUp(this.currentPose, code)) {
      this.stand();
      if (code === "Space" || code === "KeyL" || code === "KeyK") return;
    }
    if (code === "KeyL") this.tryLieDown();
    if (code === "KeyK") this.trySit();
    if (code === "Space") this.jumpRequested = true;
  }

  // Binoculars: each press starts back at 1x and ramps toward 10x while held; letting go
  // keeps the zoom where it stood. Gradual, so the rock face swims up instead of jumping at you.
  startZoom() {
    if (this.travelling) return;
    this.zooming = true;
    this.zoomHeld = 0;
    this.zoomFactor = 1;
    this.camera.fov = this.baseFov;
  }

  stopZoom() {
    this.zooming = false;
  }

  setPitchTrim(rate: number) {
    this.pitchTrim = rate;
  }

  sit(seat: Vector3) {
    this.seat = seat.clone();
    this.setPose("sitting");
  }

  lieDown() {
    const { x, z } = this.body.getPosition(), yaw = this.camera.rotation.y;
    const dx = Math.sin(yaw) * RECLINE_SPAN, dz = Math.cos(yaw) * RECLINE_SPAN;
    this.lieTilt = reclineTilt(this.ground.getHeight(x - dx, z - dz), this.ground.getHeight(x + dx, z + dz), RECLINE_SPAN);
    this.setPose("lying");
    this.tiltTo(lieStartPitch(this.lieTilt));
  }

  tryLieDown() {
    if (this.currentPose !== "standing") return;
    const { x, z } = this.body.getPosition();
    if (canLieDown(this.grounded, this.ground.getHeight(x, z) < WATER_Y && inLake(x, z))) this.lieDown();
  }

  // Sitting on the ground uses the same dry-land check as lying down, with the seat at the ground.
  trySit() {
    if (this.currentPose !== "standing") return;
    // The ground is looked for from just above the player, so under an upper deck it is the deck they stand on.
    const { x, y, z } = this.body.getPosition(), floor = this.ground.getHeight(x, z, y + 1);
    if (canLieDown(this.grounded, floor < WATER_Y && inLake(x, z))) this.sit(new Vector3(x, floor, z));
  }

  stand() {
    if (this.currentPose === "standing") return;
    // A raised seat needs a step back onto the ground; a ground seat stands up where it sits.
    if (this.seat && this.seat.y - this.ground.getHeight(this.seat.x, this.seat.z) > 0.05) {
      const yaw = this.camera.rotation.y;
      const x = this.seat.x - Math.sin(yaw) * STEP_OFF_STUMP, z = this.seat.z - Math.cos(yaw) * STEP_OFF_STUMP;
      const y = this.ground.getHeight(x, z);
      if (y > NO_GROUND && !this.ground.blocked(x, z)) this.body.setPosition(new Vector3(x, y + BODY_HEIGHT / 2 + this.body.keepDistance, z));
    }
    if (this.currentPose === "lying") this.tiltTo(0);
    this.seat = null;
    this.setPose("standing");
  }

  // T travels home: to the first place, which is the deck of the ship wherever she is, so a player who
  // has fallen overboard is back aboard in one press. Pressed at home, it goes on to the next of the
  // other places in turn.
  private goHome() {
    const home = this.spawns[0].position, at = this.body.getPosition();
    const atHome = this.vessel ? this.aboard : Math.hypot(home.x - at.x, home.z - at.z) < TRAVEL_MIN_METRES;
    const others = this.spawns.length - 1;
    if (!atHome || others === 0) return this.travel(0);
    this.lastPlace = this.lastPlace % others + 1;
    return this.travel(this.lastPlace);
  }

  async travel(index: number) {
    // Fly the camera to the next place: turn to face it, zoom in on it, then land there.
    if (this.travelling) return;
    const place = this.spawns[index], camera = this.camera, scene = camera.getScene();
    const dx0 = place.position.x - camera.position.x, dz0 = place.position.z - camera.position.z;
    // Already standing on it, so there is nothing to look at: arrive at once.
    if (Math.hypot(dx0, dz0) < TRAVEL_MIN_METRES) {
      await this.spawn(index);
      this.onTravel.notifyObservers(place.name);
      return;
    }
    this.travelling = true;
    const fov = camera.fov;
    try {
      this.stand();
      // Load the ground and its collision around the landing spot so its height is known.
      await this.ground.prepare(place.position.x, place.position.z);
      const groundY = this.ground.getHeight(place.position.x, place.position.z);
      const targetY = groundY > NO_GROUND ? Math.max(place.position.y, groundY) : place.position.y;
      const dx = place.position.x - camera.position.x;
      const dy = targetY - camera.position.y;
      const dz = place.position.z - camera.position.z;
      let yaw = Math.atan2(dx, dz);
      // Turn the short way round by bringing the target within half a turn of the current yaw.
      let diff = yaw - camera.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      yaw = camera.rotation.y + diff;
      // rotation.x is positive looking down, so looking up at a higher spot needs a negative pitch.
      const pitch = -Math.atan2(dy, Math.hypot(dx, dz));
      const ease = new CubicEase();
      ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);
      // Aim at the landing spot first, then zoom in on it before moving the player there.
      await Animation.CreateAndStartAnimation("travelTurn", camera, "rotation", TRAVEL_FPS,
        TRAVEL_FPS * TRAVEL_TURN_SECONDS, camera.rotation.clone(), new Vector3(pitch, yaw, 0),
        Animation.ANIMATIONLOOPMODE_CONSTANT, ease, undefined, scene)!.waitAsync();
      await Animation.CreateAndStartAnimation("travelZoom", camera, "fov", TRAVEL_FPS,
        TRAVEL_FPS * TRAVEL_ZOOM_SECONDS, fov, TRAVEL_ZOOM_FOV,
        Animation.ANIMATIONLOOPMODE_CONSTANT, ease, undefined, scene)!.waitAsync();
      // Spawn prepares again (the first prepare is only held for 3 s), then teleports and sets the heading.
      await this.spawn(index);
      this.onTravel.notifyObservers(place.name);
    } finally {
      camera.fov = fov;
      this.travelling = false;
    }
  }

  // Move a place: the one aboard the boat follows it round the lake.
  setPlace(index: number, position: Vector3, heading: number) {
    this.spawns[index].position.copyFrom(position);
    this.spawns[index].heading = heading;
  }

  async spawn(index = 0) {
    this.stand();
    await this.ground.prepare(this.spawns[index].position.x, this.spawns[index].position.z);
    this.teleport(this.spawns[index].position);
    this.camera.rotation.set(0, this.spawns[index].heading, 0);
  }

  teleport(eye: Vector3) {
    const floor = this.ground.getHeight(eye.x, eye.z) + FOOT_TO_EYE + this.body.keepDistance;
    const y = Math.max(eye.y, floor);
    this.body.setPosition(new Vector3(eye.x, y - CENTER_TO_EYE, eye.z));
    this.body.setVelocity(Vector3.Zero());
    this.eyeY = y;
    this.easing = false;
    this.swimming = false;
    this.grounded = false;
    this.lastXZ.x = eye.x;
    this.lastXZ.z = eye.z;
  }

  update() {
    const camera = this.camera;
    const dt = camera.getScene().getEngine().getDeltaTime() / 1000;

    // Binoculars ramp 1x toward 10x while B is held; letting go freezes the zoom in place.
    if (this.zooming && !this.travelling && this.zoomFactor < BINOCULAR_ZOOM) {
      this.zoomHeld += dt;
      this.zoomFactor = Math.min(BINOCULAR_ZOOM, 1 + (BINOCULAR_ZOOM - 1) * (this.zoomHeld / BINOCULAR_SECONDS));
      camera.fov = this.baseFov / this.zoomFactor;
    }

    if (this.travelling) {
      // The travel animation owns the camera's rotation, so drop mouse or touch look input.
      camera.cameraRotation.setAll(0);
    } else {
      camera.rotation.x += pitchDelta(this.pitchTrim, dt);

      if (this.stickEngaged) {
        camera.rotation.y += yawDelta(this.touchStick.x, dt);
      } else {
        if (this.activeKeys["ArrowLeft"]) camera.rotation.y -= ROTATION_SPEED;
        if (this.activeKeys["ArrowRight"]) camera.rotation.y += ROTATION_SPEED;
        if (this.activeKeys["ArrowUp"]) camera.rotation.x -= ROTATION_SPEED;
        if (this.activeKeys["ArrowDown"]) camera.rotation.x += ROTATION_SPEED;
      }

      if (this.pitchTarget !== null) {
        camera.rotation.x = easeTowards(camera.rotation.x, this.pitchTarget, POSE_EASE_RATE, dt);
        this.pitchEaseLeft -= dt;
        if (this.pitchEaseLeft <= 0) this.pitchTarget = null;
      } else {
        camera.rotation.x = clampPitch(this.currentPose, camera.rotation.x, this.lieTilt);
      }
    }

    const p = this.body.getPosition();
    if (Math.abs(p.x) > this.worldBoundaryLimit || Math.abs(p.z) > this.worldBoundaryLimit || p.y < FALL_OUT_HEIGHT) this.spawn();
  }

  private tiltTo(pitch: number) {
    this.pitchTarget = pitch;
    this.pitchEaseLeft = PITCH_EASE_SECONDS;
  }

  private setPose(pose: Pose) {
    this.currentPose = pose;
    this.easing = true;
    this.body.setVelocity(Vector3.Zero());
    document.body.classList.toggle("resting", pose !== "standing");
    this.onPoseChange.notifyObservers(pose);
  }

  private held(code: string): boolean {
    // While travelling the animation owns the camera, so movement keys read as released.
    if (this.travelling) return false;
    return this.activeKeys[code] === true;
  }

  private stickKey(): StickKey | null {
    // While travelling the animation owns the camera, so the stick reads as centred.
    if (this.travelling) return null;
    return this.stickEngaged ? moveKey(stickMagnitude(this.touchStick), this.touchStick.y) : null;
  }

  private wishSpeed(): number {
    if (this.swimming) return STROKE_SPEED;
    if (this.stickEngaged) {
      const magnitude = stickMagnitude(this.touchStick);
      return stickRunning(magnitude) ? RUN_SPEED : (stickSpeed(magnitude) / STICK_WALK) * WALK_SPEED;
    }
    return this.held("ShiftLeft") || this.held("ShiftRight") ? RUN_SPEED : WALK_SPEED;
  }

  private step() {
    const dt = Math.min(this.camera.getScene().getEngine().getDeltaTime() / 1000, MAX_STEP_SECONDS);
    // A jump pressed mid-travel must not fire on arrival, so drop it with the other input.
    if (this.travelling) this.jumpRequested = false;
    // Aboard means the boat's deck is what lies under the player. It is decided before anything moves,
    // while the player and the deck's collision are both where the last frame left them.
    const at = this.body.getPosition();
    this.aboard = this.vessel !== null && !this.swimming && this.ground.propAt(at.x, at.z) === this.vessel.root;
    if (dt <= 0 || this.currentPose !== "standing") {
      this.grounded = this.grounded && this.currentPose !== "standing";
      this.ride();
      return;
    }
    const body = this.body, p = body.getPosition();
    const yaw = this.camera.rotation.y;

    const key = this.stickKey();
    const fwd = (this.held("KeyW") || key === "KeyW" ? 1 : 0) - (this.held("KeyS") || key === "KeyS" ? 1 : 0);
    const side = (this.held("KeyD") ? 1 : 0) - (this.held("KeyA") ? 1 : 0);
    setMovementVectors(yaw, fwd, side, this.wishSpeed(), this.forward, this.right, this.wish);

    // The ground below the player, not the topmost: under a pier or the hull it is the lake bed, so a
    // swimmer there keeps swimming.
    const groundY = this.ground.getHeight(p.x, p.z, p.y + 1);
    const eye = p.y + CENTER_TO_EYE;
    const floatY = WATER_Y + FLOAT_HEIGHT;
    // Swimming needs the lake mask as well: low dry land outside the caldera is below lake level.
    this.swimming = !this.easing && eye < floatY + FLOAT_MARGIN && groundY + FOOT_TO_EYE < WATER_Y && inLake(p.x, p.z);

    body.checkSupportToRef(dt, DOWN, this.support);
    this.airborne = Math.max(0, this.airborne - dt);
    const supported = this.support.supportedState === CharacterSupportedState.SUPPORTED && this.airborne === 0;
    const current = body.getVelocity();
    const velocity = this.movementVelocity.setAll(0);

    if (this.swimming) {
      let vy: number;
      if (this.held("Space")) vy = SWIM_SPEED;
      else if (this.held("KeyC")) vy = -SWIM_SPEED;
      else if (fwd === 0) vy = Math.max(-BUOYANCY_SPEED, Math.min(BUOYANCY_SPEED, (floatY - eye) / dt));
      else vy = 0;
      if (eye + vy * dt > floatY) vy = Math.min(vy, (floatY - eye) / dt);
      velocity.set(this.wish.x, vy, this.wish.z);
      this.grounded = false;
    } else if (supported) {
      body.calculateMovementToRef(dt, this.forward, this.support.averageSurfaceNormal, current, this.support.averageSurfaceVelocity, this.wish, UP, velocity);
      velocity.subtractInPlace(this.support.averageSurfaceVelocity);
      if (this.jumpRequested) {
        velocity.y = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT);
        this.airborne = JUMP_LIFTOFF_SECONDS;
      }
      this.grounded = !this.jumpRequested;
    } else {
      body.calculateMovementToRef(dt, this.forward, UP, current, Vector3.ZeroReadOnly, this.wish, UP, velocity);
      velocity.y = current.y - GRAVITY * dt;
      this.grounded = false;
    }
    this.jumpRequested = false;

    body.setVelocity(velocity);
    body.integrate(dt, this.support, this.gravity);
    if (this.swimming && p.y + CENTER_TO_EYE > floatY)
      body.setPosition(this.floatingPosition.set(p.x, floatY - CENTER_TO_EYE, p.z));

    this.walked = this.grounded && !this.easing ? Math.hypot(p.x - this.lastXZ.x, p.z - this.lastXZ.z) : 0;
    this.lastXZ.x = p.x;
    this.lastXZ.z = p.z;
    this.ride();
  }

  // Carry the player with the boat: the boat has already moved this frame and its collision follows in
  // the physics step, so the player, a seat they sit on and the camera's heading are moved by the same
  // rigid step. This holds at any frame rate, where riding on the deck's velocity would not.
  private ride() {
    if (!this.aboard || !this.vessel) return;
    const { step, yawStep } = this.vessel;
    Vector3.TransformCoordinatesToRef(this.body.getPosition(), step, this.ridingPosition);
    this.body.setPosition(this.ridingPosition);
    if (this.seat) Vector3.TransformCoordinatesToRef(this.seat, step, this.seat);
    this.integrationPosition.set(this.lastXZ.x, 0, this.lastXZ.z);
    Vector3.TransformCoordinatesToRef(this.integrationPosition, step, this.integrationPosition);
    this.lastXZ.x = this.integrationPosition.x;
    this.lastXZ.z = this.integrationPosition.z;
    this.camera.rotation.y += yawStep;
  }

  private follow() {
    const cam = this.camera;
    cam.cameraDirection.setAll(0);
    const dt = cam.getScene().getEngine().getDeltaTime() / 1000;
    const p = this.body.getPosition();
    const x = this.currentPose === "sitting" && this.seat ? this.seat.x : p.x;
    const z = this.currentPose === "sitting" && this.seat ? this.seat.z : p.z;

    let target: number;
    if (this.currentPose === "standing") {
      target = p.y + CENTER_TO_EYE;
      // Afloat at the surface the head rides the water, dipping from the float level and back.
      if (this.swimming && target > WATER_Y) {
        const t = performance.now() / 1000, moving = Math.hypot(this.body.getVelocity().x, this.body.getVelocity().z) > 0.1;
        const dip = moving ? STROKE_METRES * (0.5 - 0.5 * Math.cos(t * 2 * Math.PI / STROKE_SECONDS))
          : SWELL_METRES * (0.5 - 0.5 * Math.cos(t * 2 * Math.PI / SWELL_SECONDS));
        target -= Math.min(dip * settings.headBob, target - WATER_Y - 0.1);
      }
    } else {
      const groundY = this.ground.getHeight(x, z, p.y + 1);
      target = groundY + eyeHeight(this.currentPose, this.seat ? this.seat.y - groundY : 0);
    }
    if (this.easing) {
      this.eyeY = easeTowards(this.eyeY, target, POSE_EASE_RATE, dt);
      if (Math.abs(this.eyeY - target) < 0.01) {
        this.eyeY = target;
        this.easing = false;
      }
    } else {
      this.eyeY = target;
    }

    const walked = this.currentPose === "standing" && !this.swimming ? this.walked : 0;
    this.bob = stepBob(this.bob, walked, dt > 0 ? walked / dt : 0, dt);
    const { up, side } = bobOffset(this.bob, settings.headBob);
    const yaw = cam.rotation.y;
    cam.position.set(x + Math.cos(yaw) * side, this.eyeY + up, z - Math.sin(yaw) * side);
  }
}

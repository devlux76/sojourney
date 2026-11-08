import { FireState } from "../src/play/fireRules";

describe("fireRules", () => {
  test("strikesNeeded from the roll", () => {
    expect(new FireState(0).strikesNeeded).toBe(1);
    expect(new FireState(0.34).strikesNeeded).toBe(2);
    expect(new FireState(0.99).strikesNeeded).toBe(3);
    expect(new FireState(1).strikesNeeded).toBe(3);
  });

  test("strike counting", () => {
    const fire = new FireState(0.7);
    expect(fire.strike()).toBe(false);
    expect(fire.strike()).toBe(false);
    expect(fire.strike()).toBe(true);
    expect(fire.strike()).toBe(false);
    expect(fire.phase).toBe("burning");
  });

  test("lighting and fuel", () => {
    const fire = new FireState(0);
    fire.strike();
    expect(fire.fuel).toBe(540);
    expect(fire.flame()).toBe(1);
    expect(fire.glow()).toBe(0);
    expect(fire.canAddLog()).toBe(true);
    fire.addLog();
    expect(fire.fuel).toBe(720);
    fire.addLog();
    expect(fire.fuel).toBe(900);
    expect(fire.canAddLog()).toBe(false);
    fire.addLog();
    expect(fire.fuel).toBe(900);
  });

  test("burn to embers to ash", () => {
    const fire = new FireState(0);
    fire.strike();
    fire.tick(440);
    expect(fire.fuel).toBe(100);
    fire.tick(100);
    expect(fire.phase).toBe("embers");
    expect(fire.glow()).toBe(1);
    fire.tick(45);
    expect(fire.glow()).toBe(0.5);
    expect(fire.flame()).toBe(0);
    fire.tick(45);
    expect(fire.phase).toBe("ash");
  });

  test("relight from embers", () => {
    const fire = new FireState(0);
    fire.strike();
    fire.tick(540);
    expect(fire.phase).toBe("embers");
    fire.addLog();
    expect(fire.phase).toBe("burning");
    expect(fire.fuel).toBe(180);
    expect(fire.flame()).toBe(0.75);
  });

  test("ash resets to laid", () => {
    const fire = new FireState(0);
    fire.strike();
    fire.tick(440);
    fire.tick(100);
    fire.tick(45);
    fire.tick(45);
    expect(fire.phase).toBe("ash");
    fire.addLog();
    expect(fire.phase).toBe("laid");
    expect(fire.fuel).toBe(180);
    expect(fire.strike()).toBe(true);
  });

  test("a laid fire takes no logs", () => {
    const fire = new FireState(0);
    fire.addLog();
    expect(fire.phase).toBe("laid");
    expect(fire.fuel).toBe(540);
  });
});

import { expect, test } from "bun:test";
import { DEFAULT_SETTINGS, NumericSettingKey } from "../src/core/Settings";

test("MSAA samples are a numeric setting, defaulting to 1", () => {
  expect(DEFAULT_SETTINGS.msaaSamples).toBe(1);
  const numericKeys: NumericSettingKey[] = ["msaaSamples"];
  expect(numericKeys).toEqual(["msaaSamples"]);
});

import { SLOTS, TOOL_NAMES } from "../play/rucksack";

export type SheetRow =
  | { kind: "panel" }
  | { kind: "tool"; slot: number }
  | { kind: "sit" }
  | { kind: "lie down" }
  | { kind: "home" }
  | { kind: "photo" }
  | { kind: "clean photo" }
  | { kind: "settings" }
  | { kind: "fullscreen" };

const LABELS: Record<SheetRow["kind"], string> = {
  panel: "Rucksack",
  tool: "",
  sit: "Sit",
  "lie down": "Lie down",
  home: "Home",
  photo: "Photo",
  "clean photo": "Photo, no HUD",
  settings: "Settings",
  fullscreen: "Fullscreen",
};

export const SHEET_ROWS: SheetRow[] = [
  { kind: "panel" },
  ...SLOTS.map((_, i): SheetRow => ({ kind: "tool", slot: i + 1 })),
  { kind: "sit" },
  { kind: "lie down" },
  { kind: "home" },
  { kind: "photo" },
  { kind: "clean photo" },
  { kind: "settings" },
  { kind: "fullscreen" },
];

export function sheetRowLabel(row: SheetRow): string {
  if (row.kind === "tool") return `${row.slot}  ${TOOL_NAMES[SLOTS[row.slot - 1]]}`;
  return LABELS[row.kind];
}

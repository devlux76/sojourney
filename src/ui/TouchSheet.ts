import { SHEET_ROWS, sheetRowLabel, type SheetRow } from "../core/touchSheetRows";
import { toggleFullscreen } from "../core/Fullscreen";
import { takePhoto } from "../core/Screenshot";
import { SLOTS } from "../play/rucksack";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { SettingsPanel } from "../core/SettingsPanel";
import type { Play } from "../play/Play";

export interface SheetHost {
  play: Play;
  engine: AbstractEngine;
  panel: SettingsPanel;
}

export class TouchSheet {
  private toggleBtn: HTMLButtonElement;
  private panel: HTMLDivElement;
  private toolRows = new Map<number, HTMLButtonElement>();

  constructor(private host: SheetHost) {
    this.toggleBtn = document.createElement("button");
    this.toggleBtn.type = "button";
    this.toggleBtn.id = "touch-sheet-toggle";
    this.toggleBtn.textContent = "···";
    this.toggleBtn.title = "Controls";
    this.toggleBtn.addEventListener("click", () => this.setOpen(!this.open));

    this.panel = document.createElement("div");
    this.panel.id = "touch-sheet";
    this.panel.hidden = true;
    for (const row of SHEET_ROWS) this.panel.append(this.buildRow(row));

    document.body.append(this.toggleBtn, this.panel);
    document.addEventListener("touchstart", e => {
      if (this.panel.hidden) return;
      const el = e.target as Element | null;
      if (el?.closest("#touch-sheet, #touch-sheet-toggle")) return;
      this.setOpen(false);
    }, { passive: true });
  }

  get open(): boolean {
    return !this.panel.hidden;
  }

  setOpen(open: boolean) {
    this.panel.hidden = !open;
  }

  refresh(held: string | null) {
    for (const [slot, button] of this.toolRows) {
      button.classList.toggle("held", SLOTS[slot - 1] === held);
    }
  }

  private buildRow(row: SheetRow): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = sheetRowLabel(row);
    b.addEventListener("click", () => this.run(row));
    if (row.kind === "tool") this.toolRows.set(row.slot, b);
    return b;
  }

  private run(row: SheetRow) {
    const { play } = this.host;
    if (row.kind !== "settings" && row.kind !== "fullscreen") this.setOpen(false);
    switch (row.kind) {
      case "panel": play.overlay.togglePanel(); break;
      case "tool": play.pressSlot(row.slot); break;
      case "sit": play.sitDown(); break;
      case "lie down": play.lieDown(); break;
      case "home": play.home(); break;
      case "photo": takePhoto(this.host.engine, true); break;
      case "clean photo": takePhoto(this.host.engine, false); break;
      case "settings": this.host.panel.toggle(); break;
      case "fullscreen": toggleFullscreen(); break;
    }
  }
}

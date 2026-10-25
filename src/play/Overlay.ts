export class Overlay {
  private reticle = element("play-reticle");
  private glyph = this.reticle.appendChild(document.createElement("span"));
  private key = this.reticle.appendChild(document.createElement("small"));
  private hint = element("play-hint");
  private card = element("play-card");
  private panel = element("play-pack");
  private announcement = element("play-announce");
  private shown: string | null | undefined = null;
  private sayingUntil = 0;
  private cardTimer = 0;
  private announceTimer = 0;
  muted = false;

  // The reticle: the glyph of the action that Enter or a touch button would do now, drawn as an outline by the
  // page's glyph-outline filter, with the key's name under it while the player is still learning it. With no
  // action possible there is nothing at the centre of the screen.
  setAction(glyph: string | null, key: string | null) {
    const hidden = !glyph;
    if (this.reticle.hidden !== hidden) this.reticle.hidden = hidden;
    const glyphText = glyph ?? "";
    if (this.glyph.textContent !== glyphText) this.glyph.textContent = glyphText;
    const keyText = key ?? "";
    if (this.key.textContent !== keyText) this.key.textContent = keyText;
  }

  setHint(text: string | null) {
    if (performance.now() < this.sayingUntil || text === this.shown) return;
    this.shown = text;
    this.setHintText(text);
  }

  say(line: string, seconds = 4) {
    if (this.muted) return;
    this.sayingUntil = performance.now() + seconds * 1000;
    this.shown = undefined;
    this.setHintText(line);
  }

  // A word from the ship. It is part of the ride, so unlike the rest of the overlay it shows with the
  // HUD hidden and while the player sits or lies down.
  announce(line: string, seconds: number) {
    this.announcement.textContent = line;
    this.announcement.hidden = false;
    clearTimeout(this.announceTimer);
    this.announceTimer = window.setTimeout(() => { this.announcement.hidden = true; }, seconds * 1000);
  }

  showCard(title: string, detail: string, seconds = 4) {
    this.card.textContent = `${title}\n${detail}`;
    this.card.hidden = false;
    clearTimeout(this.cardTimer);
    this.cardTimer = window.setTimeout(() => { this.card.hidden = true; }, seconds * 1000);
  }

  togglePanel() {
    this.panel.hidden = !this.panel.hidden;
  }

  setPanel(lines: string[]) {
    this.panel.textContent = lines.join("\n");
  }

  private setHintText(text: string | null) {
    const value = text ?? "";
    if (this.hint.textContent !== value) this.hint.textContent = value;
    const hidden = !text;
    if (this.hint.hidden !== hidden) this.hint.hidden = hidden;
  }
}

function element(id: string): HTMLDivElement {
  const div = document.createElement("div");
  div.id = id;
  div.hidden = true;
  document.body.append(div);
  return div;
}

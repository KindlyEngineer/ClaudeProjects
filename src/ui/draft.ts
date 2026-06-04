import type { Upgrade } from "../sim/upgrades";

// The level-up draft modal. While a draft is pending the game loop pauses and
// this overlay shows the option cards; the player picks one with a click or the
// number keys (1–N). It only rebuilds the DOM when the option-set actually
// changes (a new level-up), so it can be driven straight from the render loop.

const TAG: Record<Upgrade["type"], string> = {
  "new-weapon": "NEW WEAPON",
  "level-weapon": "WEAPON +",
  passive: "PASSIVE",
};

export class DraftView {
  visible = false;
  private shown: Upgrade[] | null = null;
  private onPick: ((index: number) => void) | null = null;

  constructor(private readonly el: HTMLElement) {
    window.addEventListener("keydown", (e) => this.onKey(e));
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.visible || !this.shown) return;
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= this.shown.length) this.pick(n - 1);
  }

  private pick(index: number): void {
    const cb = this.onPick;
    if (cb) cb(index);
  }

  /** Show/refresh the modal for `options`. Cheap to call every frame: it only
   *  rebuilds when the option-set reference changes. */
  sync(options: Upgrade[], onPick: (index: number) => void): void {
    this.onPick = onPick;
    if (options === this.shown) return;
    this.shown = options;
    this.render(options);
    this.el.classList.add("show");
    this.visible = true;
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.shown = null;
    this.el.classList.remove("show");
    this.el.innerHTML = "";
  }

  private render(options: Upgrade[]): void {
    const title = `<div class="title">LEVEL UP — CHOOSE ONE</div>`;
    const cards = options
      .map(
        (u, i) => `
        <div class="card" data-i="${i}">
          <div class="key">[${i + 1}]</div>
          <div class="tag">${TAG[u.type]}</div>
          <div class="name">${u.name}</div>
          <div class="blurb">${u.blurb}</div>
        </div>`,
      )
      .join("");
    this.el.innerHTML = title + cards;
    this.el.querySelectorAll<HTMLElement>(".card").forEach((card) => {
      card.addEventListener("click", () => this.pick(Number(card.dataset.i)));
    });
  }
}

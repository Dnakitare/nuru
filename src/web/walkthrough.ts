// First-time walkthrough — a spotlight coach-mark sequence that explains the
// concept and the interface before you touch it. Distinct from "watch a solve"
// (which shows the engine solving): this teaches what a thread is, what the pins
// mean, how to assert, what strain is, and how a knot finishes.
//
// The dim is drawn with FOUR panels framing the target (cheap) rather than a
// giant box-shadow spread, which pathologically stalls the renderer when the
// spotlighted element is large.

export interface WalkStep {
  title: string;
  body: string;
  target?: string; // CSS selector to spotlight; omit to center the card
}

export interface WalkOptions {
  onWatch?: () => void; // "watch a solve" on the final step
  onDone?: () => void; // fired on finish or skip
}

export function runWalkthrough(steps: WalkStep[], opts: WalkOptions = {}): void {
  let i = 0;

  const root = el("div", "wt-root");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "how to play");
  const panels = {
    top: el("div", "wt-panel"),
    bottom: el("div", "wt-panel"),
    left: el("div", "wt-panel"),
    right: el("div", "wt-panel"),
  };
  const ring = el("div", "wt-ring");
  const card = el("div", "wt-card");
  for (const p of Object.values(panels)) root.appendChild(p);
  root.appendChild(ring);
  root.appendChild(card);
  document.body.appendChild(root);

  const close = (): void => {
    window.removeEventListener("resize", position);
    window.removeEventListener("keydown", onKey);
    root.remove();
    opts.onDone?.();
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowLeft") prev();
    else if (e.key === "ArrowRight") next();
    else if (e.key === "Tab") {
      // trap focus inside the card so Tab can't reach the dimmed page behind it
      const f = card.querySelectorAll<HTMLElement>("button");
      if (f.length === 0) return;
      const first = f[0]!;
      const last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const next = (): void => {
    if (i < steps.length - 1) {
      i++;
      render();
    } else {
      close();
    }
  };
  const prev = (): void => {
    if (i > 0) {
      i--;
      render();
    }
  };

  function frame(l: number, t: number, w: number, h: number): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setBox(panels.top, 0, 0, vw, Math.max(0, t));
    setBox(panels.bottom, 0, t + h, vw, Math.max(0, vh - (t + h)));
    setBox(panels.left, 0, t, Math.max(0, l), h);
    setBox(panels.right, l + w, t, Math.max(0, vw - (l + w)), h);
    setBox(ring, l, t, w, h);
    ring.style.display = "block";
  }

  function fullDim(): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setBox(panels.top, 0, 0, vw, vh);
    for (const k of ["bottom", "left", "right"] as const) setBox(panels[k], 0, 0, 0, 0);
    ring.style.display = "none";
  }

  function position(): void {
    const step = steps[i]!;
    const targetEl = step.target ? document.querySelector(step.target) : null;
    if (targetEl) {
      card.classList.remove("center");
      card.classList.add("bottom");
      // the target may be below the fold on mobile (rail stacks under the stage)
      targetEl.scrollIntoView({ block: "center", inline: "nearest" });
      requestAnimationFrame(() => {
        const r = targetEl.getBoundingClientRect();
        const pad = 6;
        frame(r.left - pad, r.top - pad, r.width + pad * 2, r.height + pad * 2);
      });
    } else {
      fullDim();
      card.classList.remove("bottom");
      card.classList.add("center");
    }
  }

  function render(): void {
    const step = steps[i]!;
    const isFinal = i === steps.length - 1;
    const dots = steps.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("");
    card.innerHTML = `
      <h3>${step.title}</h3>
      <p>${step.body}</p>
      <div class="wt-foot">
        <button class="wt-skip" data-act="skip">skip</button>
        <div class="wt-dots">${dots}</div>
        <div class="wt-btns"></div>
      </div>`;
    const btns = card.querySelector(".wt-btns") as HTMLElement;
    if (i > 0 && !isFinal) btns.appendChild(button("back", "back", "ghost"));
    if (isFinal) {
      if (opts.onWatch) btns.appendChild(button("watch", "watch a solve", "ghost"));
      btns.appendChild(button("try", "let me try", "primary"));
    } else {
      btns.appendChild(button("next", "next", "primary"));
    }
    card.querySelector('[data-act="skip"]')!.addEventListener("click", close);
    card.querySelectorAll<HTMLButtonElement>(".wt-btns button").forEach((b) => {
      b.addEventListener("click", () => {
        const act = b.dataset.act;
        if (act === "next") next();
        else if (act === "back") prev();
        else if (act === "try") close();
        else if (act === "watch") {
          close();
          opts.onWatch?.();
        }
      });
    });
    position();
    // move focus into the dialog so keyboard users start inside it
    (card.querySelector(".wt-btns button.primary") as HTMLElement | null)?.focus();
  }

  window.addEventListener("resize", position);
  window.addEventListener("keydown", onKey);
  render();
}

function setBox(e: HTMLElement, l: number, t: number, w: number, h: number): void {
  e.style.left = `${l}px`;
  e.style.top = `${t}px`;
  e.style.width = `${w}px`;
  e.style.height = `${h}px`;
}

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

function button(act: string, label: string, kind: "primary" | "ghost"): HTMLButtonElement {
  const b = document.createElement("button");
  b.dataset.act = act;
  b.textContent = label;
  if (kind === "primary") b.className = "primary";
  return b;
}

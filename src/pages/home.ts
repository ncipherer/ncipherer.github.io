import { AbstractView } from "../router";
import { Terminal } from "../components/terminal";
import { GardenPanel } from "../components/garden";

export class HomePage extends AbstractView {
  render(): HTMLElement {
    const element = document.createElement("div");
    element.classList.add("home-page");

    element.innerHTML = `
      <div class="container home-container">
        <header class="home-header">
          <div class="whisper-kicker">ENCIPHERER'S WHISPERS</div>
        </header>
        <section class="home-garden-section" id="garden-mount"></section>
        <div class="terminal-dock" id="terminal-dock">
          <button class="terminal-dock-toggle" id="terminal-dock-toggle" aria-label="Open terminal">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
            <span class="terminal-dock-label">terminal</span>
          </button>
        </div>
        <main class="home-terminal-section collapsed" id="terminal-mount"></main>
      </div>
    `;

    // The garden is the hero: a clock of all the time spent here,
    // and the flowers those minutes have grown.
    const gardenMount = element.querySelector("#garden-mount");
    if (gardenMount) {
      gardenMount.appendChild(new GardenPanel().render());
    }

    // The terminal is hidden by default — a dock bar at the bottom.
    // Clicking the dock toggles it open/closed.
    const terminalMount = element.querySelector("#terminal-mount") as HTMLElement;
    const dockToggle = element.querySelector("#terminal-dock-toggle") as HTMLButtonElement;
    const dock = element.querySelector("#terminal-dock") as HTMLElement;
    let terminalRendered = false;
    let terminalInstance: Terminal | null = null;

    const expandTerminal = (): void => {
      if (!terminalRendered && terminalMount) {
        terminalInstance = new Terminal();
        terminalMount.appendChild(terminalInstance.render());
        terminalRendered = true;
      }
      terminalMount.classList.remove("collapsed");
      terminalMount.classList.add("expanded");
      dock.classList.add("terminal-dock-hidden");
      // Focus the input once expanded
      setTimeout(() => {
        const input = terminalMount.querySelector(".terminal-input") as HTMLInputElement | null;
        if (input) input.focus();
      }, 350);
    };

    const collapseTerminal = (): void => {
      terminalMount.classList.remove("expanded");
      terminalMount.classList.add("collapsed");
      dock.classList.remove("terminal-dock-hidden");
    };

    dockToggle.addEventListener("click", expandTerminal);

    // Collapse on Escape when terminal is open
    window.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape" && terminalMount.classList.contains("expanded")) {
        collapseTerminal();
      }
    });

    // Collapse when terminal titlebar is clicked
    terminalMount.addEventListener("terminal-collapse", () => {
      if (terminalMount.classList.contains("expanded")) {
        collapseTerminal();
      }
    });

    return element;
  }
}

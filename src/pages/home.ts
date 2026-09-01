import { AbstractView } from "../router";
import { Terminal } from "../components/terminal";

export class HomePage extends AbstractView {
  render(): HTMLElement {
    const element = document.createElement("div");
    element.classList.add("home-page");

    element.innerHTML = `
      <div class="container home-container">
        <header class="home-header">
          <div class="whisper-kicker">ENCIPHERER'S WHISPERS</div>
        </header>
        <main class="home-terminal-section" id="terminal-mount"></main>
      </div>
    `;

    const mount = element.querySelector("#terminal-mount");
    if (mount) {
      const terminal = new Terminal();
      mount.appendChild(terminal.render());
    }

    return element;
  }
}

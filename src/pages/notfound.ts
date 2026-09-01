import { AbstractView } from "../router";

export class NotFoundPage extends AbstractView {
  render(): HTMLElement {
    const element = document.createElement("div");
    element.classList.add("not-found-page");

    element.innerHTML = `
      <div class="container not-found-container">
        <div class="not-found-content">
          <div class="not-found-glitch" data-text="404">404</div>
          <h1 class="not-found-title">Lost in the Silence</h1>
          <p class="not-found-message">The page you are looking for has vanished, or perhaps it was never whispered into existence.</p>
          <div class="not-found-actions">
            <a href="/" class="btn btn-primary" data-link>Go Home</a>
            <a href="/notes" class="btn btn-secondary" data-link>Browse Notes</a>
          </div>
        </div>
      </div>
    `;

    return element;
  }
}

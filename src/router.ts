type ViewFactory = () => Promise<typeof AbstractView>;

type Route = {
    path: string;
    view: typeof AbstractView | ViewFactory;
};

type RouteParams = {
    [key: string]: string;
};

export abstract class AbstractView {
    params: RouteParams;
    constructor(params: RouteParams) {
        this.params = params;
    }
    abstract render(): HTMLElement | Promise<HTMLElement>;
    static create(params: RouteParams): AbstractView {
        return new (this as any)(params);
    }
}

export class Router {
    private routes: Route[];
    private fallbackView: typeof AbstractView;

    constructor(routes: Route[], fallbackView: typeof AbstractView) {
        this.routes = routes;
        this.fallbackView = fallbackView;
    }

    private parseParams(route: Route, path: string): RouteParams | null {
        const routeParts = route.path.split('/');
        const pathParts = path.split('/');

        if (routeParts.length !== pathParts.length) return null;

        const params: RouteParams = {};
        for (let i = 0; i < routeParts.length; i++) {
            if (routeParts[i].startsWith(':')) {
                const paramName = routeParts[i].slice(1);
                params[paramName] = pathParts[i];
            } else if (routeParts[i] !== pathParts[i]) {
                return null;
            }
        }
        return params;
    }

    private match(path: string): { route: Route; params: RouteParams } | null {        
        for (const route of this.routes) {
            const params = this.parseParams(route, path);
            if (params !== null) {
                return { route, params };
            }
        }
        return null;
    }

    private async resolveView(route: Route): Promise<typeof AbstractView> {
        if (typeof route.view === 'function' && route.view.prototype === undefined) {
            // It's a dynamic import function — resolve it
            const resolved = await (route.view as ViewFactory)();
            return resolved as typeof AbstractView;
        }
        // It's already a class reference
        return route.view as typeof AbstractView;
    }

    async route(): Promise<void> {
        const path = window.location.pathname;
        const matched = this.match(path);

        // On note and tag pages the header nav is redundant — they have their
        // own "Back to all notes" link, so hide Home/Notes.
        const hideNav = !!matched && (
            matched.route.path === "/note/:dateid" || matched.route.path === "/tag/:tag"
        );
        document.body.classList.toggle("note-open", hideNav);

        if (!matched) {
            // Handle 404
            const view = this.fallbackView.create({});
            const element = await view.render();
            const app = document.querySelector('#app')!;
            app.innerHTML = '';
            app.appendChild(element);
            return;
        }

        const ViewClass = await this.resolveView(matched.route);
        const view = ViewClass.create(matched.params);
        const element = await view.render();
        
        const app = document.querySelector('#app')!;
        app.innerHTML = '';
        app.appendChild(element);
        
        // Reset scroll position to top after navigation unless there is a hash
        if (!window.location.hash) {
            window.scrollTo(0, 0);
        }
    }
}

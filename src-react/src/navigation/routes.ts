export type Screen =
  | "home"
  | "project"
  | "design"
  | "notes"
  | "chat"
  | "library"
  | "import"
  | "component-detail";

export type NavigationRoute =
  | { screen: "home" }
  | { screen: "project"; projectId: string | null }
  | { screen: "design"; projectId: string | null; designId: string | null }
  | { screen: "notes"; pageId: string | null }
  | { screen: "chat"; chatId: string | null }
  | { screen: "library" }
  | { screen: "import" }
  | { screen: "component-detail"; componentId: string | null };

export function routeToHash(route: NavigationRoute): string {
  switch (route.screen) {
    case "project":
      return route.projectId ? `#project-${route.projectId}` : "#project";
    case "design":
      if (route.designId && route.projectId) {
        return `#design-project:${route.projectId}:${route.designId}`;
      }
      if (route.designId) {
        return `#design-workspace:${route.designId}`;
      }
      if (route.projectId) {
        return `#design-project:${route.projectId}`;
      }
      return "#design";
    case "notes":
      return route.pageId ? `#notes-${route.pageId}` : "#notes";
    case "chat":
      return route.chatId ? `#chat-${route.chatId}` : "#chat";
    case "library":
      return "#library";
    case "import":
      return "#import";
    case "component-detail":
      return route.componentId ? `#component-${route.componentId}` : "#component-new";
    case "home":
    default:
      return "";
  }
}

export function parseHashToRoute(hash: string): NavigationRoute | null {
  if (hash.startsWith("#chat-")) {
    return { screen: "chat", chatId: hash.substring(6) };
  }
  if (hash === "#chat") {
    return { screen: "chat", chatId: null };
  }

  if (hash.startsWith("#project-")) {
    // Projects are disabled; keep hash compatibility but route to home.
    return { screen: "home" };
  }
  if (hash === "#project") {
    return { screen: "home" };
  }

  if (hash.startsWith("#design-project:")) {
    const payload = hash.substring(16);
    const [projectId, designId] = payload.split(":");
    return {
      screen: "design",
      projectId: projectId || null,
      designId: designId || null,
    };
  }
  if (hash.startsWith("#design-workspace:")) {
    const designId = hash.substring(18);
    return {
      screen: "design",
      projectId: null,
      designId: designId || null,
    };
  }
  if (hash.startsWith("#design-")) {
    const payload = hash.substring(8);
    const [projectId, designId] = payload.split(":");
    return {
      screen: "design",
      projectId: projectId || null,
      designId: designId || null,
    };
  }
  if (hash === "#design") {
    return { screen: "design", projectId: null, designId: null };
  }

  if (hash.startsWith("#notes-")) {
    return { screen: "notes", pageId: hash.substring(7) || null };
  }
  if (hash === "#notes") {
    return { screen: "notes", pageId: null };
  }

  if (hash === "#library") {
    return { screen: "library" };
  }

  if (hash === "#import") {
    return { screen: "import" };
  }

  if (hash === "#component-new") {
    // New component flow lives in Library screen.
    return { screen: "library" };
  }
  if (hash.startsWith("#component-")) {
    const componentId = hash.substring(11);
    if (!componentId) {
      return { screen: "library" };
    }
    return { screen: "component-detail", componentId };
  }

  return null;
}

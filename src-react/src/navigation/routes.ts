export type Screen =
  | "home"
  | "project"
  | "module"
  | "design"
  | "notes"
  | "chat"
  | "library"
  | "import"
  | "component-detail";

export type NavigationRoute =
  | { screen: "home" }
  | { screen: "project"; projectId: string | null }
  | { screen: "module"; moduleId: string }
  | { screen: "design"; projectId: string | null; designId: string | null }
  | { screen: "notes"; pageId: string | null }
  | { screen: "chat"; chatId: string | null }
  | { screen: "library" }
  | { screen: "import" }
  | { screen: "component-detail"; componentId: string | null };

export function routeToHash(route: NavigationRoute): string {
  switch (route.screen) {
    case "project":
      return "";
    case "module":
      return route.moduleId ? `#space-${route.moduleId}` : "";
    case "design":
      return "#space-designer";
    case "notes":
      return "#space-knowledge";
    case "chat":
      return "#space-ai-service";
    case "library":
      return "#space-component-library";
    case "import":
      return "";
    case "component-detail":
      return "#space-component-library";
    case "home":
    default:
      return "";
  }
}

export function parseHashToRoute(hash: string): NavigationRoute | null {
  if (hash.startsWith("#space-")) {
    const moduleId = hash.substring(7);
    if (!moduleId) return { screen: "home" };
    return { screen: "module", moduleId };
  }

  return null;
}

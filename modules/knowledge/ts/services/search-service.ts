import { PageRepository } from "../db/repositories/page-repository";
import type { PageSearchResult } from "../../shared/types";

export class SearchService {
  constructor(private repo: PageRepository) {}

  getScopeRepository(): Pick<PageRepository, "isAncestor"> {
    return this.repo;
  }

  async searchByTitle(
    workspaceId: string,
    query: string,
    scope: "all" | "workspace" | "projects" = "all",
    limit = 20,
  ): Promise<PageSearchResult[]> {
    if (query.length < 2) {
      return [];
    }

    const results = await this.repo.searchByTitle(
      workspaceId,
      query,
      scope,
      limit,
    );

    const enriched: PageSearchResult[] = [];
    for (const result of results) {
      const breadcrumb = await this.repo.getBreadcrumb(result.id);
      enriched.push({ ...result, breadcrumb });
    }

    return enriched;
  }
}

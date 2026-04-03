/**
 * Union-Find (Disjoint Set Union) data structure with path compression and union by rank.
 * Used for net extraction to group electrically connected elements.
 */
export class UnionFind {
  private parent: number[];
  private rank: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
    this.rank = Array(size).fill(0);
  }

  /**
   * Find the root representative of the set containing element x.
   * Uses path compression for O(α(n)) amortized time complexity.
   */
  find(x: number): number {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]!);
    }
    return this.parent[x]!;
  }

  /**
   * Union the sets containing elements x and y.
   * Uses union by rank for balanced trees.
   */
  union(x: number, y: number): void {
    const rootX = this.find(x);
    const rootY = this.find(y);

    if (rootX === rootY) {
      return;
    }

    const rankX = this.rank[rootX]!;
    const rankY = this.rank[rootY]!;

    if (rankX < rankY) {
      this.parent[rootX] = rootY;
    } else if (rankX > rankY) {
      this.parent[rootY] = rootX;
    } else {
      this.parent[rootY] = rootX;
      this.rank[rootX]!++;
    }
  }

  /**
   * Check if elements x and y are in the same set.
   */
  connected(x: number, y: number): boolean {
    return this.find(x) === this.find(y);
  }

  /**
   * Get all groups as a map from root index to member indices.
   */
  groups(): Map<number, number[]> {
    const groupMap = new Map<number, number[]>();

    for (let i = 0; i < this.parent.length; i++) {
      const root = this.find(i);
      const group = groupMap.get(root) ?? [];
      group.push(i);
      groupMap.set(root, group);
    }

    return groupMap;
  }
}

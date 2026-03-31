import { Card } from "@/components/ui/card";
import { useNavigationStore } from "@/stores/navigation-store";
import { Star, Loader2 } from "lucide-react";
import { useFavorites } from "@/hooks/useFavorites";

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 7)}w ago`;
}

export function FavoritesSection() {
  const { navigateToChat } = useNavigationStore();
  const { favorites, loading, error } = useFavorites();

  if (loading) {
    return (
      <div className="flex flex-col gap-4 px-8 py-4">
        <h2 className="text-lg font-semibold tracking-tight">Favorites</h2>
        <div className="flex items-center justify-center h-[80px]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4 px-8 py-4">
        <h2 className="text-lg font-semibold tracking-tight">Favorites</h2>
        <div className="text-sm text-destructive">{error}</div>
      </div>
    );
  }

  if (favorites.length === 0) {
    return (
      <div className="flex flex-col gap-4 px-8 py-4">
        <h2 className="text-lg font-semibold tracking-tight">Favorites</h2>
        <div className="flex h-20 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          No favorite chats yet. Star a chat to add it here.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-8 py-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Favorites</h2>
        <span className="text-sm text-muted-foreground">
          {favorites.length} favorite{favorites.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {favorites.map((fav) => (
          <Card
            key={fav.id}
            className="group relative flex flex-col p-4 cursor-pointer hover:bg-surface-muted transition-colors border-none bg-surface shadow-sm"
            onClick={() => fav.chatId && navigateToChat(fav.chatId)}
          >
            <div className="absolute top-3 right-3">
              <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
            </div>
            <div className="pr-6">
              <div className="font-medium text-sm truncate mb-1">
                {fav.chat?.title || "Untitled Chat"}
              </div>
              <div className="text-xs text-muted-foreground">
                Added {formatRelativeTime(fav.createdAt)}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

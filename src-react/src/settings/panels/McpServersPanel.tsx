import * as React from "react";
import {
  Server,
  Plus,
  Play,
  Square,
  Trash2,
  Edit,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import {
  listMcpServers,
  createMcpServer,
  updateMcpServer,
  deleteMcpServer,
  connectMcpServer,
  disconnectMcpServer,
  type McpServer,
  type CreateMcpServerInput,
} from "@/lib/api/mcp-api";

export function McpServersPanel() {
  const { toast } = useToast();
  const [servers, setServers] = React.useState<McpServer[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [isDialogOpen, setIsDialogOpen] = React.useState(false);
  const [editingServer, setEditingServer] = React.useState<McpServer | null>(
    null,
  );
  const [formData, setFormData] = React.useState<Partial<CreateMcpServerInput>>(
    {
      transport: "stdio",
      env: {},
    },
  );
  const [envText, setEnvText] = React.useState("");

  const loadServers = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await listMcpServers();
      setServers(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load servers";
      setError(message);
      toast({
        title: "Error loading servers",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    loadServers();
  }, [loadServers]);

  const handleOpenDialog = (server?: McpServer) => {
    if (server) {
      setEditingServer(server);
      setFormData({
        alias: server.alias,
        displayName: server.displayName,
        transport: server.transport,
        command: server.command,
        args: server.args,
        url: server.url,
        env: server.env,
      });
      setEnvText(
        server.env
          ? Object.entries(server.env)
              .map(([k, v]) => `${k}=${v}`)
              .join("\n")
          : "",
      );
    } else {
      setEditingServer(null);
      setFormData({ transport: "stdio", env: {} });
      setEnvText("");
    }
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    try {
      const env: Record<string, string> = {};
      envText.split("\n").forEach((line) => {
        const [key, ...rest] = line.split("=");
        if (key && rest.length > 0) {
          env[key.trim()] = rest.join("=").trim();
        }
      });

      const payload: CreateMcpServerInput = {
        alias: formData.alias || "",
        displayName: formData.displayName,
        transport: formData.transport as "stdio" | "http",
        command: formData.command,
        args: Array.isArray(formData.args) ? formData.args : [],
        url: formData.url,
        env,
        enabled: true,
      };

      if (!payload.alias) {
        throw new Error("Alias is required");
      }
      
       if (typeof formData.args === 'string') {
          payload.args = (formData.args as string).split(',').map(s => s.trim()).filter(s => s.length > 0);
       }

      if (editingServer) {
        await updateMcpServer(editingServer.id, payload);
        toast({ title: "Server updated" });
      } else {
        await createMcpServer(payload);
        toast({ title: "Server created" });
      }

      setIsDialogOpen(false);
      loadServers();
    } catch (err) {
      toast({
        title: "Error saving server",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this server?")) return;
    try {
      await deleteMcpServer(id);
      toast({ title: "Server deleted" });
      loadServers();
    } catch (err) {
      toast({
        title: "Error deleting server",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleConnect = async (id: string) => {
    try {
      await connectMcpServer(id);
      toast({ title: "Connected to server" });
      loadServers();
    } catch (err) {
      toast({
        title: "Connection failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleDisconnect = async (id: string) => {
    try {
      await disconnectMcpServer(id);
      toast({ title: "Disconnected from server" });
      loadServers();
    } catch (err) {
      toast({
        title: "Disconnection failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6 pb-24">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5 text-muted-foreground" />
            <h3 className="text-lg font-semibold">MCP Servers</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Manage Model Context Protocol servers to extend AI capabilities.
          </p>
        </div>
        <Button onClick={() => handleOpenDialog()}>
          <Plus className="mr-2 h-4 w-4" /> Add Server
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      
      {isLoading && servers.length === 0 && (
         <div className="text-center text-muted-foreground py-8">Loading servers...</div>
      )}

      <div className="space-y-4">
        {servers.length === 0 && !isLoading ? (
          <div className="text-center py-12 border rounded-lg border-dashed text-muted-foreground">
            No MCP servers configured. Add one to get started.
          </div>
        ) : (
          servers.map((server) => (
            <Card key={server.id} className="overflow-hidden">
                <CardHeader className="pb-3 pt-4 px-4 bg-muted/20 border-b">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                             <CardTitle className="text-base">{server.displayName || server.alias}</CardTitle>
                             {server.status === "connected" ? (
                                <Badge variant="default" className="bg-green-600 hover:bg-green-700">Connected</Badge>
                             ) : server.status === "error" ? (
                                <Badge variant="destructive">Error</Badge>
                             ) : (
                                <Badge variant="outline">Disconnected</Badge>
                             )}
                        </div>
                        <div className="flex items-center gap-1">
                             {server.status === "connected" ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDisconnect(server.id)}
                                  title="Disconnect"
                                >
                                  <Square className="h-4 w-4 mr-1" /> Stop
                                </Button>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleConnect(server.id)}
                                  title="Connect"
                                >
                                  <Play className="h-4 w-4 mr-1" /> Start
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleOpenDialog(server)}
                                title="Edit"
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDelete(server.id)}
                                title="Delete"
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-4 pt-3 grid grid-cols-2 gap-4 text-sm">
                    <div>
                        <div className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Type</div>
                        <div className="capitalize font-medium">{server.transport}</div>
                    </div>
                    <div>
                        <div className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Details</div>
                        <div className="font-mono text-xs truncate" title={server.transport === 'http' ? server.url : `${server.command} ${(server.args || []).join(' ')}`}>
                             {server.transport === 'http' ? server.url : `${server.command} ${(server.args || []).join(' ')}`}
                        </div>
                    </div>
                    {server.status === 'connected' && (
                        <div className="col-span-2 pt-2 border-t mt-1">
                             <div className="flex gap-4">
                                <div>
                                    <span className="text-muted-foreground mr-2">Tools:</span>
                                    <span className="font-medium">{server.toolCount || 0}</span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground mr-2">Resources:</span>
                                    <span className="font-medium">{server.resourceCount || 0}</span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground mr-2">Prompts:</span>
                                    <span className="font-medium">{server.promptCount || 0}</span>
                                </div>
                             </div>
                        </div>
                    )}
                    {server.error && (
                        <div className="col-span-2 mt-2 bg-destructive/10 text-destructive text-xs p-2 rounded">
                            {server.error}
                        </div>
                    )}
                </CardContent>
            </Card>
          ))
        )}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingServer ? "Edit MCP Server" : "Add MCP Server"}
            </DialogTitle>
            <DialogDescription>
              Configure connection details for the MCP server.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="alias">Alias (ID)</Label>
                <Input
                  id="alias"
                  placeholder="my-server"
                  value={formData.alias || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, alias: e.target.value })
                  }
                  disabled={!!editingServer} 
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="displayName">Display Name</Label>
                <Input
                  id="displayName"
                  placeholder="My Server"
                  value={formData.displayName || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, displayName: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="transport">Transport</Label>
              <Select
                value={formData.transport}
                onValueChange={(val) =>
                  setFormData({ ...formData, transport: val as "stdio" | "http" })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stdio">Stdio (Local Process)</SelectItem>
                  <SelectItem value="http">HTTP (Remote Server)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {formData.transport === "stdio" ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="command">Command</Label>
                  <Input
                    id="command"
                    placeholder="npx"
                    value={formData.command || ""}
                    onChange={(e) =>
                      setFormData({ ...formData, command: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="args">Arguments (comma separated)</Label>
                  <Input
                    id="args"
                    placeholder="-y, @modelcontextprotocol/server-filesystem, /path/to/files"
                    value={Array.isArray(formData.args) ? formData.args.join(", ") : (formData.args || "")}
                    onChange={(e) =>
                      setFormData({ ...formData, args: e.target.value.split(",").map(s => s.trim()) })
                    }
                  />
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="url">Server URL</Label>
                <Input
                  id="url"
                  placeholder="http://localhost:3000/sse"
                  value={formData.url || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, url: e.target.value })
                  }
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="env">Environment Variables (KEY=VALUE per line)</Label>
              <Textarea
                id="env"
                placeholder="API_KEY=12345&#10;DEBUG=true"
                value={envText}
                onChange={(e) => setEnvText(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

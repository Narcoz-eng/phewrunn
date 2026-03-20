import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Plus, Minus } from "lucide-react";
import { toast } from "sonner";
import type { GlobalSettings, AdminInviteStats } from "../../../../backend/src/types";

export function InvitesManager() {
  const queryClient = useQueryClient();
  const [quotaEdits, setQuotaEdits] = useState<Record<string, string>>({});

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => api.get<GlobalSettings>("/api/admin/settings"),
  });

  const { data: inviteStats, isLoading: statsLoading } = useQuery({
    queryKey: ["admin", "invites", "stats"],
    queryFn: () => api.get<AdminInviteStats>("/api/admin/invites/stats"),
  });

  const toggleInviteOnly = useMutation({
    mutationFn: (inviteOnly: boolean) =>
      api.patch("/api/admin/settings", { inviteOnly }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
      toast.success("Settings updated");
    },
    onError: () => toast.error("Failed to update settings"),
  });

  const adjustQuotaMutation = useMutation({
    mutationFn: ({ userId, quota }: { userId: string; quota: number }) =>
      api.patch(`/api/admin/invites/${userId}/quota`, { quota }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "invites", "stats"] });
      toast.success("Quota updated");
    },
    onError: () => toast.error("Failed to update quota"),
  });

  const addInvitesMutation = useMutation({
    mutationFn: ({ userId, amount }: { userId: string; amount: number }) =>
      api.post(`/api/admin/invites/${userId}/add`, { amount }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "invites", "stats"] });
      toast.success("Invites added");
    },
    onError: () => toast.error("Failed to add invites"),
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Invite System</h2>
        <p className="text-sm text-muted-foreground">Control access and manage user invite quotas</p>
      </div>

      {/* Invite-only toggle */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Access Control</CardTitle>
          <CardDescription>When invite-only is on, new users must enter a valid code to sign up</CardDescription>
        </CardHeader>
        <CardContent>
          {settingsLoading ? (
            <Skeleton className="h-8 w-48" />
          ) : (
            <div className="flex items-center gap-3">
              <Switch
                checked={settings?.inviteOnly ?? false}
                onCheckedChange={(v) => toggleInviteOnly.mutate(v)}
                disabled={toggleInviteOnly.isPending}
              />
              <span className="text-sm font-medium">
                {settings?.inviteOnly ? "Invite-only mode ON" : "Open registration (invite-only OFF)"}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stats */}
      {inviteStats ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invite Stats</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              <span className="text-foreground font-semibold text-lg">{inviteStats.totalInvited}</span>{" "}
              users joined via invites
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Top inviters table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top Inviters</CardTitle>
          <CardDescription>Manage invite quotas per user</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {statsLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !inviteStats?.topInviters.length ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
              <Users className="h-8 w-8" />
              <p className="text-sm">No invite activity yet</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Invites Sent</TableHead>
                  <TableHead>Quota</TableHead>
                  <TableHead className="text-right">Adjust</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inviteStats.topInviters.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {u.image ? (
                          <img src={u.image} className="h-6 w-6 rounded-full object-cover" alt="" />
                        ) : (
                          <div className="h-6 w-6 rounded-full bg-muted" />
                        )}
                        <span className="text-sm font-medium">
                          {u.username ? `@${u.username}` : u.id.slice(0, 8)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{u.inviteCount}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        className="w-20 h-7 text-sm"
                        value={quotaEdits[u.id] ?? String(u.inviteQuota)}
                        onChange={(e) =>
                          setQuotaEdits((prev) => ({ ...prev, [u.id]: e.target.value }))
                        }
                        min={0}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() =>
                            addInvitesMutation.mutate({ userId: u.id, amount: 1 })
                          }
                          disabled={addInvitesMutation.isPending}
                          title="Add 1 invite"
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                        {quotaEdits[u.id] !== undefined &&
                        quotaEdits[u.id] !== String(u.inviteQuota) ? (
                          <Button
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => {
                              const q = parseInt(quotaEdits[u.id] ?? "");
                              if (!isNaN(q) && q >= 0) {
                                adjustQuotaMutation.mutate({ userId: u.id, quota: q });
                                setQuotaEdits((prev) => {
                                  const n = { ...prev };
                                  delete n[u.id];
                                  return n;
                                });
                              }
                            }}
                            disabled={adjustQuotaMutation.isPending}
                          >
                            Save
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

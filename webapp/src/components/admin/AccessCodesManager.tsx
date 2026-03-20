import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { KeyRound, Plus, XCircle, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import type { AdminAccessCodesResponse } from "../../../../backend/src/types";

function CodeStatusBadge({ isRevoked, isExpired, isExhausted }: { isRevoked: boolean; isExpired: boolean; isExhausted: boolean }) {
  if (isRevoked) return <Badge variant="destructive">Revoked</Badge>;
  if (isExpired) return <Badge variant="outline" className="text-orange-500 border-orange-500">Expired</Badge>;
  if (isExhausted) return <Badge variant="outline" className="text-muted-foreground">Used Up</Badge>;
  return <Badge variant="outline" className="text-green-500 border-green-500">Active</Badge>;
}

export function AccessCodesManager() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"all" | "active" | "exhausted" | "expired" | "revoked">("all");
  const [page, setPage] = useState(1);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [genCount, setGenCount] = useState(10);
  const [genMaxUses, setGenMaxUses] = useState(1);
  const [genLabel, setGenLabel] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "access-codes", filter, page],
    queryFn: () =>
      api.get<AdminAccessCodesResponse>(`/api/admin/access-codes?filter=${filter}&page=${page}&limit=20`),
  });

  const generateMutation = useMutation({
    mutationFn: () =>
      api.post<{ created: number; codes: string[] }>("/api/admin/access-codes/generate", {
        count: genCount,
        maxUses: genMaxUses,
        label: genLabel || undefined,
      }),
    onSuccess: (result) => {
      toast.success(`Generated ${result.created} access codes`);
      setGenerateOpen(false);
      setGenLabel("");
      queryClient.invalidateQueries({ queryKey: ["admin", "access-codes"] });
    },
    onError: () => toast.error("Failed to generate codes"),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/api/admin/access-codes/${id}/revoke`, {}),
    onSuccess: () => {
      toast.success("Code revoked");
      queryClient.invalidateQueries({ queryKey: ["admin", "access-codes"] });
    },
    onError: () => toast.error("Failed to revoke code"),
  });

  const copyCode = (id: string, code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Access Codes</h2>
          <p className="text-sm text-muted-foreground">Generate and manage one-time or multi-use access codes</p>
        </div>
        <Button onClick={() => setGenerateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Generate Codes
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <Select value={filter} onValueChange={(v) => { setFilter(v as typeof filter); setPage(1); }}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="exhausted">Used Up</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="revoked">Revoked</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {data ? `${data.total} codes` : ""}
        </span>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !data?.codes.length ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <KeyRound className="h-8 w-8" />
              <p className="text-sm">No codes found</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Uses</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.codes.map((ac) => (
                  <TableRow key={ac.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm">{ac.code}</span>
                        <button
                          onClick={() => copyCode(ac.id, ac.code)}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {copiedId === ac.id ? (
                            <Check className="h-3.5 w-3.5 text-green-500" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{ac.label ?? "—"}</TableCell>
                    <TableCell className="text-sm">
                      {ac.useCount}/{ac.maxUses === 0 ? "∞" : ac.maxUses}
                    </TableCell>
                    <TableCell>
                      <CodeStatusBadge
                        isRevoked={ac.isRevoked}
                        isExpired={ac.isExpired}
                        isExhausted={ac.isExhausted}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      {!ac.isRevoked ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => revokeMutation.mutate(ac.id)}
                          disabled={revokeMutation.isPending}
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {data && data.totalPages > 1 ? (
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground flex items-center">
            {page} / {data.totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page === data.totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      ) : null}

      <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate Access Codes</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Number of codes</Label>
              <Input
                type="number"
                min={1}
                max={200}
                value={genCount}
                onChange={(e) => setGenCount(parseInt(e.target.value) || 1)}
              />
            </div>
            <div className="space-y-2">
              <Label>Max uses per code</Label>
              <Input
                type="number"
                min={0}
                value={genMaxUses}
                onChange={(e) => setGenMaxUses(parseInt(e.target.value) || 1)}
              />
              <p className="text-xs text-muted-foreground">0 = unlimited uses</p>
            </div>
            <div className="space-y-2">
              <Label>Label (optional)</Label>
              <Input
                placeholder="e.g. Beta wave 1"
                value={genLabel}
                onChange={(e) => setGenLabel(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenerateOpen(false)}>Cancel</Button>
            <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
              {generateMutation.isPending ? "Generating..." : `Generate ${genCount} codes`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

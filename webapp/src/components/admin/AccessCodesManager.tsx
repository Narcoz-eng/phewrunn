import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KeyRound, Plus, XCircle, Copy, Check, Zap } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { AccessCodeListResponse, AccessCode } from "../../../../backend/src/types";

function CodeStatusBadge({ code }: { code: AccessCode }) {
  if (code.isRevoked) return <Badge variant="destructive" className="text-[10px]">Revoked</Badge>;
  if (code.isExpired) return <Badge variant="outline" className="text-orange-500 border-orange-500 text-[10px]">Expired</Badge>;
  if (code.isExhausted) return <Badge variant="outline" className="text-muted-foreground text-[10px]">Used Up</Badge>;
  return <Badge variant="outline" className="text-green-500 border-green-500 text-[10px]">Active</Badge>;
}

function UsageBar({ useCount, maxUses }: { useCount: number; maxUses: number }) {
  if (maxUses === 0) {
    return (
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm font-semibold">{useCount}</span>
        <span className="text-xs text-muted-foreground">/ ∞</span>
      </div>
    );
  }
  const pct = Math.min((useCount / maxUses) * 100, 100);
  const isNearLimit = pct >= 80;
  const isFull = useCount >= maxUses;

  return (
    <div className="flex items-center gap-2.5 min-w-[120px]">
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            isFull
              ? "bg-muted-foreground"
              : isNearLimit
                ? "bg-orange-400"
                : "bg-primary"
          )}
          style={{ width: `${Math.max(pct, 4)}%` }}
        />
      </div>
      <span className={cn(
        "font-mono text-sm font-semibold whitespace-nowrap",
        isFull && "text-muted-foreground",
        isNearLimit && !isFull && "text-orange-500"
      )}>
        {useCount}/{maxUses}
      </span>
    </div>
  );
}

type GenerateMode = "single" | "batch";

export function AccessCodesManager() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"all" | "active" | "exhausted" | "expired" | "revoked">("all");
  const [page, setPage] = useState(1);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generateMode, setGenerateMode] = useState<GenerateMode>("single");
  const [genCount, setGenCount] = useState(10);
  const [genMaxUses, setGenMaxUses] = useState(50);
  const [genLabel, setGenLabel] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "access-codes", filter, page],
    queryFn: () =>
      api.get<AccessCodeListResponse>(`/api/admin/access-codes?status=${filter}&page=${page}&limit=20`),
  });

  const generateMutation = useMutation({
    mutationFn: () =>
      api.post<AccessCode[]>("/api/admin/access-codes/generate", {
        count: generateMode === "single" ? 1 : genCount,
        maxUses: genMaxUses,
        label: genLabel || undefined,
      }),
    onSuccess: (codes) => {
      const count = Array.isArray(codes) ? codes.length : 1;
      if (count === 1 && Array.isArray(codes) && codes[0]) {
        toast.success(`Created code ${codes[0].code} with ${genMaxUses === 0 ? "unlimited" : genMaxUses} uses`);
      } else {
        toast.success(`Generated ${count} access codes`);
      }
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
    toast.success("Code copied");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const openGenerate = (mode: GenerateMode) => {
    setGenerateMode(mode);
    if (mode === "single") {
      setGenMaxUses(50);
    } else {
      setGenMaxUses(1);
      setGenCount(10);
    }
    setGenLabel("");
    setGenerateOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Access Codes</h2>
          <p className="text-sm text-muted-foreground">Generate and manage access codes</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => openGenerate("single")} className="gap-2">
            <Zap className="h-4 w-4" />
            Single Code
          </Button>
          <Button onClick={() => openGenerate("batch")} className="gap-2">
            <Plus className="h-4 w-4" />
            Batch Generate
          </Button>
        </div>
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
                  <TableHead>Usage</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.codes.map((ac) => (
                  <TableRow key={ac.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium">{ac.code}</span>
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
                    <TableCell>
                      <UsageBar useCount={ac.useCount} maxUses={ac.maxUses} />
                    </TableCell>
                    <TableCell>
                      <CodeStatusBadge code={ac} />
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
            <DialogTitle>
              {generateMode === "single" ? "Create Access Code" : "Batch Generate Codes"}
            </DialogTitle>
            <DialogDescription>
              {generateMode === "single"
                ? "Create a single code with multiple uses — great for sharing with a group."
                : "Generate many single-use codes at once."}
            </DialogDescription>
          </DialogHeader>

          <Tabs value={generateMode} onValueChange={(v) => setGenerateMode(v as GenerateMode)} className="mt-1">
            <TabsList className="w-full">
              <TabsTrigger value="single" className="flex-1 gap-1.5">
                <Zap className="h-3.5 w-3.5" />
                Single Code
              </TabsTrigger>
              <TabsTrigger value="batch" className="flex-1 gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                Batch
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="space-y-4 py-2">
            {generateMode === "batch" ? (
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
            ) : null}

            <div className="space-y-2">
              <Label>
                {generateMode === "single" ? "Total uses allowed" : "Max uses per code"}
              </Label>
              <Input
                type="number"
                min={0}
                value={genMaxUses}
                onChange={(e) => setGenMaxUses(parseInt(e.target.value) || 0)}
              />
              <p className="text-xs text-muted-foreground">
                {generateMode === "single"
                  ? `This code can be used ${genMaxUses === 0 ? "unlimited times" : `${genMaxUses} times`}. You'll see usage as 0/${genMaxUses === 0 ? "∞" : genMaxUses} in the dashboard.`
                  : "0 = unlimited uses per code"}
              </p>
            </div>

            <div className="space-y-2">
              <Label>Label (optional)</Label>
              <Input
                placeholder={generateMode === "single" ? "e.g. Twitter promo" : "e.g. Beta wave 1"}
                value={genLabel}
                onChange={(e) => setGenLabel(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setGenerateOpen(false)}>Cancel</Button>
            <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
              {generateMutation.isPending
                ? "Creating..."
                : generateMode === "single"
                  ? `Create code (${genMaxUses === 0 ? "∞" : genMaxUses} uses)`
                  : `Generate ${genCount} codes`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

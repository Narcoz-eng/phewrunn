import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  type AdminReport,
  type AdminReportsResponse,
} from "../../../../backend/src/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Flag, Pencil } from "lucide-react";
import { toast } from "sonner";

type ReportStatus = "all" | "open" | "reviewing" | "resolved" | "dismissed";
type ReportTargetType = "all" | "post" | "user";

const STATUS_OPTIONS: Array<{ value: ReportStatus; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "reviewing", label: "Reviewing" },
  { value: "resolved", label: "Resolved" },
  { value: "dismissed", label: "Dismissed" },
];

const TARGET_OPTIONS: Array<{ value: ReportTargetType; label: string }> = [
  { value: "all", label: "All targets" },
  { value: "post", label: "Posts" },
  { value: "user", label: "Users" },
];

function getStatusBadgeClass(status: AdminReport["status"]) {
  switch (status) {
    case "open":
      return "bg-amber-500/10 text-amber-600 hover:bg-amber-500/20";
    case "reviewing":
      return "bg-blue-500/10 text-blue-600 hover:bg-blue-500/20";
    case "resolved":
      return "bg-green-500/10 text-green-600 hover:bg-green-500/20";
    case "dismissed":
      return "bg-slate-500/10 text-slate-600 hover:bg-slate-500/20";
    default:
      return "";
  }
}

export function ReportsManager() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<ReportStatus>("open");
  const [targetType, setTargetType] = useState<ReportTargetType>("all");
  const [editingReport, setEditingReport] = useState<AdminReport | null>(null);
  const [reviewForm, setReviewForm] = useState({
    status: "reviewing" as Exclude<ReportStatus, "all">,
    reviewerNotes: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "reports", page, status, targetType],
    queryFn: () =>
      api.get<AdminReportsResponse>(
        `/api/admin/reports?page=${page}&limit=20&status=${status}&targetType=${targetType}`
      ),
  });

  const updateMutation = useMutation({
    mutationFn: (payload: { reportId: string; status: Exclude<ReportStatus, "all">; reviewerNotes: string }) =>
      api.patch(`/api/admin/reports/${payload.reportId}`, {
        status: payload.status,
        reviewerNotes: payload.reviewerNotes.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "reports"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "posts"] });
      setEditingReport(null);
      toast.success("Report updated");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update report");
    },
  });

  const openEditor = (report: AdminReport) => {
    setEditingReport(report);
    setReviewForm({
      status: report.status,
      reviewerNotes: report.reviewerNotes ?? "",
    });
  };

  const saveReview = () => {
    if (!editingReport) return;
    updateMutation.mutate({
      reportId: editingReport.id,
      status: reviewForm.status,
      reviewerNotes: reviewForm.reviewerNotes,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value as ReportStatus);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={targetType}
            onValueChange={(value) => {
              setTargetType(value as ReportTargetType);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Target" />
            </SelectTrigger>
            <SelectContent>
              {TARGET_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <p className="text-sm text-muted-foreground">
          Moderate reports on posts and users from one queue.
        </p>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Target</TableHead>
              <TableHead>Reporter</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 6 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : data?.reports.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No reports found
                </TableCell>
              </TableRow>
            ) : (
              data?.reports.map((report) => (
                <TableRow key={report.id}>
                  <TableCell className="max-w-[320px]">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <Flag className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="font-medium capitalize">{report.entityType}</span>
                      </div>
                      {report.entityType === "user" ? (
                        <div className="text-sm text-muted-foreground">
                          {report.targetUser?.username
                            ? `@${report.targetUser.username}`
                            : report.targetUser?.name || "Unknown user"}
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground line-clamp-2">
                          {report.post?.content || "Post unavailable"}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{report.reporter.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {report.reporter.username ? `@${report.reporter.username}` : report.reporter.id}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span className="font-medium capitalize">{report.reason}</span>
                      {report.details ? (
                        <span className="text-xs text-muted-foreground line-clamp-2">
                          {report.details}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={getStatusBadgeClass(report.status)}>{report.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(report.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" onClick={() => openEditor(report)}>
                      <Pencil className="mr-1 h-3.5 w-3.5" />
                      Review
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {data && data.totalPages > 1 ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {data.page} of {data.totalPages} ({data.total} reports)
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((current) => Math.min(data.totalPages, current + 1))}
              disabled={page === data.totalPages}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog open={editingReport !== null} onOpenChange={(open) => !open && setEditingReport(null)}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Review Report</DialogTitle>
            <DialogDescription>
              Update the moderation status and leave internal notes for this report.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="admin-report-status">Status</Label>
              <Select
                value={reviewForm.status}
                onValueChange={(value) =>
                  setReviewForm((prev) => ({
                    ...prev,
                    status: value as Exclude<ReportStatus, "all">,
                  }))
                }
              >
                <SelectTrigger id="admin-report-status">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.filter((option) => option.value !== "all").map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="admin-report-notes">Reviewer notes</Label>
              <Textarea
                id="admin-report-notes"
                rows={5}
                value={reviewForm.reviewerNotes}
                onChange={(event) =>
                  setReviewForm((prev) => ({ ...prev, reviewerNotes: event.target.value }))
                }
                placeholder="Internal moderation notes"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingReport(null)}>
              Cancel
            </Button>
            <Button onClick={saveReview} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving..." : "Save review"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { type ComponentProps, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Flag, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type ReportTargetType = "post" | "user";
type ReportReason =
  | "spam"
  | "scam"
  | "abuse"
  | "harassment"
  | "impersonation"
  | "misleading"
  | "other";

const REPORT_REASON_OPTIONS: Array<{ value: ReportReason; label: string; description: string }> = [
  { value: "spam", label: "Spam", description: "Low-quality repetition, botting, or unwanted promotion." },
  { value: "scam", label: "Scam", description: "Fraud, fake offers, wallet drains, or deceptive financial behavior." },
  { value: "abuse", label: "Abuse", description: "Threats, hateful content, or clearly abusive behavior." },
  { value: "harassment", label: "Harassment", description: "Targeted intimidation, stalking, or repeated hostile conduct." },
  { value: "impersonation", label: "Impersonation", description: "Pretending to be another person, brand, or project." },
  { value: "misleading", label: "Misleading", description: "Materially deceptive claims or dangerous market manipulation." },
  { value: "other", label: "Other", description: "Anything that needs moderator review but does not fit the above." },
];

type ReportResponse = {
  id: string;
  status: string;
  duplicate: boolean;
  createdAt?: string;
};

interface ReportDialogProps {
  targetType: ReportTargetType;
  targetId: string;
  targetLabel?: string;
  buttonLabel?: string;
  buttonVariant?: ComponentProps<typeof Button>["variant"];
  buttonSize?: ComponentProps<typeof Button>["size"];
  buttonClassName?: string;
  iconOnly?: boolean;
}

export function ReportDialog({
  targetType,
  targetId,
  targetLabel,
  buttonLabel = "Report",
  buttonVariant = "outline",
  buttonSize = "sm",
  buttonClassName,
  iconOnly = false,
}: ReportDialogProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>("spam");
  const [details, setDetails] = useState("");

  const selectedReason = useMemo(
    () => REPORT_REASON_OPTIONS.find((option) => option.value === reason) ?? REPORT_REASON_OPTIONS[0],
    [reason]
  );

  const submitMutation = useMutation({
    mutationFn: () =>
      api.post<ReportResponse>("/api/reports", {
        targetType,
        targetId,
        reason,
        details: details.trim() || undefined,
      }),
    onSuccess: (result) => {
      if (result.duplicate) {
        toast.success("This has already been reported and is still under review");
      } else {
        toast.success("Report submitted");
      }
      setOpen(false);
      setReason("spam");
      setDetails("");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to submit report");
    },
  });

  return (
    <>
      <Button
        type="button"
        variant={buttonVariant}
        size={buttonSize}
        className={buttonClassName}
        onClick={() => setOpen(true)}
        title={buttonLabel}
      >
        <Flag className="h-3.5 w-3.5" />
        {iconOnly ? null : <span>{buttonLabel}</span>}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Report {targetType}</DialogTitle>
            <DialogDescription>
              Flag {targetLabel ? `"${targetLabel}"` : `this ${targetType}`} for moderator review.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor={`report-reason-${targetType}-${targetId}`}>Reason</Label>
              <Select value={reason} onValueChange={(value) => setReason(value as ReportReason)}>
                <SelectTrigger id={`report-reason-${targetType}-${targetId}`}>
                  <SelectValue placeholder="Choose a reason" />
                </SelectTrigger>
                <SelectContent>
                  {REPORT_REASON_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{selectedReason.description}</p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor={`report-details-${targetType}-${targetId}`}>Extra details</Label>
              <Textarea
                id={`report-details-${targetType}-${targetId}`}
                value={details}
                onChange={(event) => setDetails(event.target.value)}
                rows={4}
                maxLength={500}
                placeholder="Add anything that helps moderation review this faster."
              />
              <p className="text-xs text-muted-foreground">{details.length}/500</p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending}>
              {submitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {submitMutation.isPending ? "Submitting..." : "Submit report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

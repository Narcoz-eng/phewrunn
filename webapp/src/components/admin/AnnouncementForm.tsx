import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { type Announcement } from "../../../../backend/src/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

// Local schema to avoid Zod version mismatch between frontend and backend
const CreateAnnouncementFormSchema = z.object({
  title: z.string().min(1, "Title is required").max(200, "Title must be less than 200 characters"),
  content: z.string().min(1, "Content is required").max(2000, "Content must be less than 2000 characters"),
  isPinned: z.boolean().default(false),
  priority: z.number().int().min(0).max(100).default(0),
});

export type CreateAnnouncementForm = z.infer<typeof CreateAnnouncementFormSchema>;

interface AnnouncementFormProps {
  announcement?: Announcement | null;
  onSubmit: (data: CreateAnnouncementForm) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
}

export function AnnouncementForm({
  announcement,
  onSubmit,
  onCancel,
  isSubmitting = false,
}: AnnouncementFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CreateAnnouncementForm>({
    resolver: zodResolver(CreateAnnouncementFormSchema),
    defaultValues: {
      title: announcement?.title ?? "",
      content: announcement?.content ?? "",
      isPinned: announcement?.isPinned ?? false,
      priority: announcement?.priority ?? 0,
    },
  });

  const isPinned = watch("isPinned");

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          placeholder="Announcement title"
          {...register("title")}
          disabled={isSubmitting}
        />
        {errors.title ? (
          <p className="text-sm text-destructive">{errors.title.message}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="content">Content</Label>
        <Textarea
          id="content"
          placeholder="Announcement content..."
          rows={5}
          {...register("content")}
          disabled={isSubmitting}
        />
        {errors.content ? (
          <p className="text-sm text-destructive">{errors.content.message}</p>
        ) : null}
      </div>

      <div className="flex items-center justify-between rounded-lg border p-4">
        <div className="space-y-0.5">
          <Label htmlFor="isPinned">Pin Announcement</Label>
          <p className="text-sm text-muted-foreground">
            Pinned announcements appear at the top
          </p>
        </div>
        <Switch
          id="isPinned"
          checked={isPinned}
          onCheckedChange={(checked) => setValue("isPinned", checked)}
          disabled={isSubmitting}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="priority">Priority (0-100)</Label>
        <Input
          id="priority"
          type="number"
          min={0}
          max={100}
          {...register("priority", { valueAsNumber: true })}
          disabled={isSubmitting}
        />
        <p className="text-xs text-muted-foreground">
          Higher priority announcements appear first among pinned items
        </p>
        {errors.priority ? (
          <p className="text-sm text-destructive">{errors.priority.message}</p>
        ) : null}
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : announcement ? (
            "Update"
          ) : (
            "Create"
          )}
        </Button>
      </div>
    </form>
  );
}

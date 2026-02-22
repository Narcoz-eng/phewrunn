import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  type Announcement,
  type AdminAnnouncementsResponse,
} from "../../../../backend/src/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AnnouncementForm, type CreateAnnouncementForm } from "./AnnouncementForm";
import { AnnouncementTable } from "./AnnouncementTable";
import { Plus, Megaphone, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";

export function AnnouncementManager() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  const [deletingAnnouncement, setDeletingAnnouncement] = useState<Announcement | null>(null);
  const [pinningId, setPinningId] = useState<string | null>(null);

  // Fetch announcements
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "announcements", page],
    queryFn: () =>
      api.get<AdminAnnouncementsResponse>(
        `/api/admin/announcements?page=${page}&limit=10`
      ),
  });

  // Create announcement
  const createMutation = useMutation({
    mutationFn: (data: CreateAnnouncementForm) =>
      api.post<Announcement>("/api/admin/announcements", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "announcements"] });
      setIsCreateOpen(false);
      toast.success("Announcement created");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create announcement");
    },
  });

  // Update announcement
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: CreateAnnouncementForm }) =>
      api.patch<Announcement>(`/api/admin/announcements/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "announcements"] });
      setEditingAnnouncement(null);
      toast.success("Announcement updated");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update announcement");
    },
  });

  // Delete announcement
  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api.delete(`/api/admin/announcements/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "announcements"] });
      setDeletingAnnouncement(null);
      toast.success("Announcement deleted");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete announcement");
    },
  });

  // Toggle pin
  const togglePinMutation = useMutation({
    mutationFn: (announcement: Announcement) =>
      api.patch<Announcement>(`/api/admin/announcements/${announcement.id}`, {
        isPinned: !announcement.isPinned,
      }),
    onMutate: (announcement) => {
      setPinningId(announcement.id);
    },
    onSuccess: (_, announcement) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "announcements"] });
      toast.success(announcement.isPinned ? "Announcement unpinned" : "Announcement pinned");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update announcement");
    },
    onSettled: () => {
      setPinningId(null);
    },
  });

  const handleCreate = (formData: CreateAnnouncementForm) => {
    createMutation.mutate(formData);
  };

  const handleUpdate = (formData: CreateAnnouncementForm) => {
    if (editingAnnouncement) {
      updateMutation.mutate({ id: editingAnnouncement.id, data: formData });
    }
  };

  const handleDelete = () => {
    if (deletingAnnouncement) {
      deleteMutation.mutate(deletingAnnouncement.id);
    }
  };

  const handleTogglePin = (announcement: Announcement) => {
    togglePinMutation.mutate(announcement);
  };

  return (
    <div className="space-y-6">
      {/* Create Button */}
      <div className="flex justify-end">
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create Announcement
        </Button>
      </div>

      {/* Announcements Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5" />
            Announcements
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AnnouncementTable
            announcements={data?.announcements ?? []}
            isLoading={isLoading}
            onEdit={setEditingAnnouncement}
            onDelete={setDeletingAnnouncement}
            onTogglePin={handleTogglePin}
            isPinning={pinningId}
          />
        </CardContent>
      </Card>

      {/* Pagination */}
      {data && data.totalPages > 1 ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {data.page} of {data.totalPages} ({data.total} total)
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
              disabled={page === data.totalPages}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}

      {/* Create Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Create Announcement</DialogTitle>
          </DialogHeader>
          <AnnouncementForm
            onSubmit={handleCreate}
            onCancel={() => setIsCreateOpen(false)}
            isSubmitting={createMutation.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog
        open={editingAnnouncement !== null}
        onOpenChange={(open) => !open && setEditingAnnouncement(null)}
      >
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Announcement</DialogTitle>
          </DialogHeader>
          <AnnouncementForm
            announcement={editingAnnouncement}
            onSubmit={handleUpdate}
            onCancel={() => setEditingAnnouncement(null)}
            isSubmitting={updateMutation.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={deletingAnnouncement !== null}
        onOpenChange={(open) => !open && setDeletingAnnouncement(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Announcement</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletingAnnouncement?.title}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

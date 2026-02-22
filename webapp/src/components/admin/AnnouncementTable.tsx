import { type Announcement } from "../../../../backend/src/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Pin, PinOff, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface AnnouncementTableProps {
  announcements: Announcement[];
  isLoading: boolean;
  onEdit: (announcement: Announcement) => void;
  onDelete: (announcement: Announcement) => void;
  onTogglePin: (announcement: Announcement) => void;
  isPinning?: string | null;
}

export function AnnouncementTable({
  announcements,
  isLoading,
  onEdit,
  onDelete,
  onTogglePin,
  isPinning,
}: AnnouncementTableProps) {
  if (isLoading) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead className="hidden sm:table-cell">Content</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden md:table-cell">Priority</TableHead>
            <TableHead className="hidden md:table-cell">Created</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 3 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell><Skeleton className="h-4 w-32" /></TableCell>
              <TableCell className="hidden sm:table-cell"><Skeleton className="h-4 w-48" /></TableCell>
              <TableCell><Skeleton className="h-5 w-16" /></TableCell>
              <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-12" /></TableCell>
              <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
              <TableCell><Skeleton className="h-8 w-24 ml-auto" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  if (announcements.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-muted-foreground">No announcements yet</p>
        <p className="text-sm text-muted-foreground">Create your first announcement above</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead className="hidden sm:table-cell">Content</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden md:table-cell">Priority</TableHead>
          <TableHead className="hidden md:table-cell">Created</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {announcements.map((announcement) => (
          <TableRow
            key={announcement.id}
            className={cn(
              announcement.isPinned && "bg-gradient-to-r from-primary/5 to-transparent"
            )}
          >
            <TableCell>
              <div className="flex items-center gap-2">
                {announcement.isPinned ? (
                  <Pin className="h-4 w-4 text-primary shrink-0" />
                ) : null}
                <span className="font-medium truncate max-w-[200px]">
                  {announcement.title}
                </span>
              </div>
            </TableCell>
            <TableCell className="hidden sm:table-cell">
              <p className="text-sm text-muted-foreground truncate max-w-[300px]">
                {announcement.content}
              </p>
            </TableCell>
            <TableCell>
              {announcement.isPinned ? (
                <Badge className="bg-gradient-to-r from-primary to-primary/80">
                  Pinned
                </Badge>
              ) : (
                <Badge variant="secondary">Normal</Badge>
              )}
            </TableCell>
            <TableCell className="hidden md:table-cell">
              <span className="font-mono text-sm">{announcement.priority}</span>
            </TableCell>
            <TableCell className="hidden md:table-cell text-muted-foreground text-sm">
              {new Date(announcement.createdAt).toLocaleDateString()}
            </TableCell>
            <TableCell>
              <div className="flex items-center justify-end gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onTogglePin(announcement)}
                  disabled={isPinning === announcement.id}
                  title={announcement.isPinned ? "Unpin" : "Pin"}
                >
                  {announcement.isPinned ? (
                    <PinOff className="h-4 w-4" />
                  ) : (
                    <Pin className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onEdit(announcement)}
                  title="Edit"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onDelete(announcement)}
                  className="text-destructive hover:text-destructive"
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

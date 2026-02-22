import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { api } from "@/lib/api";
import {
  type AdminStats,
  type AdminUsersResponse,
  type AdminPostsResponse,
  type AdminPost,
} from "../../../backend/src/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users,
  FileText,
  Heart,
  MessageSquare,
  Repeat2,
  TrendingUp,
  Trophy,
  XCircle,
  Search,
  ChevronLeft,
  ChevronRight,
  Shield,
  Activity,
  Megaphone,
  Trash2,
  BadgeCheck,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { AnnouncementManager } from "@/components/admin/AnnouncementManager";
import { toast } from "sonner";

// Stats card component
function StatsCard({
  title,
  value,
  icon: Icon,
  description,
  loading,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  description?: string;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <div className="text-2xl font-bold">{value}</div>
        )}
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

// Overview tab content
function OverviewTab() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: () => api.get<AdminStats>("/api/admin/stats"),
  });

  const settlementChartData = stats
    ? [
        { name: "Wins", value: stats.settlementStats.wins, color: "#22c55e" },
        { name: "Losses", value: stats.settlementStats.losses, color: "#ef4444" },
      ]
    : [];

  const engagementData = stats
    ? [
        { name: "Likes", value: stats.totalLikes },
        { name: "Comments", value: stats.totalComments },
        { name: "Reposts", value: stats.totalReposts },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="Total Users"
          value={stats?.totalUsers ?? 0}
          icon={Users}
          loading={isLoading}
        />
        <StatsCard
          title="Total Posts"
          value={stats?.totalPosts ?? 0}
          icon={FileText}
          description={`${stats?.postsToday ?? 0} today`}
          loading={isLoading}
        />
        <StatsCard
          title="Average Level"
          value={stats ? stats.averageLevel.toFixed(1) : "0.0"}
          icon={TrendingUp}
          loading={isLoading}
        />
        <StatsCard
          title="Win Rate"
          value={`${stats?.settlementStats.winRate ?? 0}%`}
          icon={Trophy}
          description={`${stats?.settlementStats.total ?? 0} settled posts`}
          loading={isLoading}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <StatsCard
          title="Total Likes"
          value={stats?.totalLikes ?? 0}
          icon={Heart}
          loading={isLoading}
        />
        <StatsCard
          title="Total Comments"
          value={stats?.totalComments ?? 0}
          icon={MessageSquare}
          loading={isLoading}
        />
        <StatsCard
          title="Total Reposts"
          value={stats?.totalReposts ?? 0}
          icon={Repeat2}
          loading={isLoading}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5" />
              Settlement Performance
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[250px] w-full" />
            ) : stats?.settlementStats.total === 0 ? (
              <div className="flex h-[250px] items-center justify-center text-muted-foreground">
                No settled posts yet
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={settlementChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {settlementChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Engagement Overview
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[250px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={engagementData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Users tab content
function UsersTab() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sortBy, setSortBy] = useState<"createdAt" | "level" | "xp" | "posts">("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "users", page, search, sortBy, sortOrder],
    queryFn: () =>
      api.get<AdminUsersResponse>(
        `/api/admin/users?page=${page}&limit=20&search=${encodeURIComponent(search)}&sortBy=${sortBy}&sortOrder=${sortOrder}`
      ),
  });

  const verifyMutation = useMutation({
    mutationFn: ({ userId, isVerified }: { userId: string; isVerified: boolean }) =>
      api.patch(`/api/admin/users/${userId}/verify`, { isVerified }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      toast.success("Verification status updated");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update verification status");
    },
  });

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyPress={handleKeyPress}
              className="pl-8"
            />
          </div>
          <Button variant="secondary" onClick={handleSearch}>
            Search
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={sortBy}
            onValueChange={(value) => setSortBy(value as typeof sortBy)}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="createdAt">Join Date</SelectItem>
              <SelectItem value="level">Level</SelectItem>
              <SelectItem value="xp">XP</SelectItem>
              <SelectItem value="posts">Posts</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={sortOrder}
            onValueChange={(value) => setSortOrder(value as typeof sortOrder)}
          >
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="desc">Desc</SelectItem>
              <SelectItem value="asc">Asc</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Level</TableHead>
              <TableHead>XP</TableHead>
              <TableHead>Posts</TableHead>
              <TableHead>Followers</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="text-right">Verify</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-20" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : data?.users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  No users found
                </TableCell>
              </TableRow>
            ) : (
              data?.users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="flex flex-col">
                        <span className="font-medium flex items-center gap-1">
                          {user.name}
                          {user.isAdmin ? (
                            <Shield className="h-3 w-3 text-primary" />
                          ) : null}
                          {user.isVerified ? (
                            <BadgeCheck className="h-3.5 w-3.5 text-blue-500" />
                          ) : null}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {user.username ? `@${user.username}` : user.email}
                        </span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={user.level >= 0 ? "default" : "destructive"}
                      className="font-mono"
                    >
                      {user.level >= 0 ? "+" : ""}
                      {user.level}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono">{user.xp.toLocaleString()}</TableCell>
                  <TableCell>{user._count.posts}</TableCell>
                  <TableCell>{user._count.followers}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant={user.isVerified ? "default" : "outline"}
                      size="sm"
                      onClick={() =>
                        verifyMutation.mutate({ userId: user.id, isVerified: !user.isVerified })
                      }
                      disabled={verifyMutation.isPending}
                      className={user.isVerified ? "bg-blue-500 hover:bg-blue-600 text-white" : ""}
                      title={user.isVerified ? "Unverify user" : "Verify user"}
                    >
                      <BadgeCheck className="h-3.5 w-3.5 mr-1" />
                      {user.isVerified ? "Verified" : "Verify"}
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
            Page {data.page} of {data.totalPages} ({data.total} users)
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
    </div>
  );
}

// Posts tab content
function PostsTab() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<"all" | "settled" | "unsettled">("all");
  const [deletingPost, setDeletingPost] = useState<AdminPost | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "posts", page, filter],
    queryFn: () =>
      api.get<AdminPostsResponse>(
        `/api/admin/posts?page=${page}&limit=20&filter=${filter}`
      ),
  });

  const deleteMutation = useMutation({
    mutationFn: (postId: string) =>
      api.delete(`/api/admin/posts/${postId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "posts"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
      setDeletingPost(null);
      toast.success("Post deleted successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete post");
    },
  });

  const handleDelete = () => {
    if (deletingPost) {
      deleteMutation.mutate(deletingPost.id);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Select
          value={filter}
          onValueChange={(value) => {
            setFilter(value as typeof filter);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Posts</SelectItem>
            <SelectItem value="settled">Settled</SelectItem>
            <SelectItem value="unsettled">Unsettled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[300px]">Content</TableHead>
              <TableHead>Author</TableHead>
              <TableHead>Token</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Engagement</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-20" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : data?.posts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  No posts found
                </TableCell>
              </TableRow>
            ) : (
              data?.posts.map((post) => (
                <TableRow key={post.id}>
                  <TableCell className="max-w-[300px]">
                    <p className="truncate text-sm">{post.content}</p>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{post.author.name}</span>
                      <span className="text-xs text-muted-foreground">
                        Lvl {post.author.level}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {post.tokenSymbol ? (
                      <Badge variant="outline">{post.tokenSymbol}</Badge>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {post.settled ? (
                      post.isWin ? (
                        <Badge className="bg-green-500/10 text-green-500 hover:bg-green-500/20">
                          <Trophy className="mr-1 h-3 w-3" />
                          Win
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="bg-red-500/10 text-red-500 hover:bg-red-500/20">
                          <XCircle className="mr-1 h-3 w-3" />
                          Loss
                        </Badge>
                      )
                    ) : (
                      <Badge variant="secondary">Pending</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3 text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Heart className="h-3 w-3" />
                        {post._count.likes}
                      </span>
                      <span className="flex items-center gap-1">
                        <MessageSquare className="h-3 w-3" />
                        {post._count.comments}
                      </span>
                      <span className="flex items-center gap-1">
                        <Repeat2 className="h-3 w-3" />
                        {post._count.reposts}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(post.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeletingPost(post)}
                      className="text-destructive hover:text-destructive"
                      title="Delete post"
                    >
                      <Trash2 className="h-4 w-4" />
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
            Page {data.page} of {data.totalPages} ({data.total} posts)
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

      {/* Delete Post Confirmation Dialog */}
      <AlertDialog
        open={deletingPost !== null}
        onOpenChange={(open) => !open && setDeletingPost(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Post</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this post by {deletingPost?.author.name}? This action cannot be undone and will remove all associated likes, comments, and reposts.
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

// Main Admin page component
export default function Admin() {
  // Check if current user is admin
  const { data: currentUser, isLoading: userLoading, error } = useQuery({
    queryKey: ["admin", "me"],
    queryFn: async () => {
      const res = await api.get<{ id: string; isAdmin?: boolean }>("/api/me");
      return res;
    },
    retry: false,
  });

  // Fetch admin status from database
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: () => api.get<AdminStats>("/api/admin/stats"),
    enabled: !userLoading && !error,
    retry: false,
  });

  // If still loading, show loading state
  if (userLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-muted-foreground text-sm">Loading...</span>
        </div>
      </div>
    );
  }

  // If not authenticated, redirect to login
  if (error || !currentUser) {
    return <Navigate to="/login" replace />;
  }

  // If admin stats failed (forbidden), redirect to home
  if (!statsLoading && !stats) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Shield className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold">Admin Dashboard</h1>
          </div>
          <p className="text-muted-foreground">
            Monitor platform activity and manage users
          </p>
        </div>

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full max-w-lg grid-cols-4">
            <TabsTrigger value="overview" className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="users" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Users
            </TabsTrigger>
            <TabsTrigger value="posts" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Posts
            </TabsTrigger>
            <TabsTrigger value="announcements" className="flex items-center gap-2">
              <Megaphone className="h-4 w-4" />
              Announce
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <OverviewTab />
          </TabsContent>

          <TabsContent value="users">
            <UsersTab />
          </TabsContent>

          <TabsContent value="posts">
            <PostsTab />
          </TabsContent>

          <TabsContent value="announcements">
            <AnnouncementManager />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

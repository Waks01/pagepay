import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
import type { ContentListResponse } from "@/lib/types";
import { Trash2, RefreshCw, BookOpen, Download } from "lucide-react";
import React, { useState } from "react";
import {
  Card,
  Badge,
  Button,
  Pagination,
  ShimmerLoader,
  Container,
  Tooltip,
  ConfirmModal,
} from "@/shared/components";
import { TopHeader } from "@/shared/components/TopHeader";
import { useLayoutContext } from "@/shared/components/Layout";
import { Input } from "@/shared/components/Input";
import { Select } from "@/shared/components/Select";
import { useToast } from "@/shared/hooks/use-toast";
import { exportToCsv } from "@/shared/utils/exportCsv";

export function ContentPage() {
  const { onMenuClick } = useLayoutContext();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "content", { page, search, typeFilter }],
    queryFn: async () => {
      const { data } = await adminApi.get<ContentListResponse>(
        "/admin/content",
        {
          params: { page, limit: 50, search, content_type: typeFilter },
        },
      );
      return data;
    },
    staleTime: 30_000,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await adminApi.delete(`/admin/content/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "content"] });
      toast.success("Content deleted successfully");
    },
    onError: () => {
      toast.error("Failed to delete content. Please try again.");
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const { data } = await adminApi.post("/admin/content/refresh");
      return data as { imported: number; resliced: any };
    },
    onSuccess: (result) => {
      toast.success(`Imported ${result.imported} books.`, {
        description: `${result.resliced} parents re-sliced`,
      });
      queryClient.invalidateQueries({ queryKey: ["admin", "content"] });
    },
    onError: () => {
      toast.error("Refresh failed. Check the backend logs.");
    },
  });

  const openstaxMutation = useMutation({
    mutationFn: async () => {
      const { data } = await adminApi.post(
        "/admin/content/import?source=openstax",
      );
      return data as { imported: number; slices_total: number };
    },
    onSuccess: (result) => {
      toast.success(`OpenStax import complete`, {
        description: `${result.imported} books, ${result.slices_total} slices`,
      });
      queryClient.invalidateQueries({ queryKey: ["admin", "content"] });
    },
    onError: () => {
      toast.error("OpenStax import failed. Check the backend logs.");
    },
  });

  const queryClient = useQueryClient();
  const totalPages = data ? Math.ceil(data.total / data.limit) : 0;

  return (
    <>
      <TopHeader
        title="Content"
        subtitle="Manage catalog content"
        onMenuClick={onMenuClick}
      />
      <Container size="full">
        <Card>
          <div className="border-b border-border px-4 py-4 sm:px-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              <Input
                label="Search"
                placeholder="Title..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="lg:max-w-xs"
              />
              <Select
                label="Type"
                value={typeFilter}
                onChange={(value) => {
                  setTypeFilter(value);
                  setPage(1);
                }}
                options={[
                  { value: "", label: "All Types" },
                  { value: "book", label: "Book" },
                  { value: "article", label: "Article" },
                  { value: "news", label: "News" },
                ]}
                className="lg:max-w-xs"
              />
              <div className="flex items-end gap-2 flex-wrap">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    if (data?.items && data.items.length > 0) {
                      exportToCsv(
                        data.items.map((item) => ({
                          id: item.id,
                          title: item.title,
                          content_type: item.content_type,
                          category: item.category,
                          author: item.author || "N/A",
                          created_at: new Date(
                            item.created_at,
                          ).toLocaleDateString(),
                        })),
                        "content",
                      );
                    }
                  }}
                  disabled={!data?.items || data.items.length === 0}
                >
                  <Download size={16} className="mr-1" />
                  Export CSV
                </Button>
                <Button
                  variant="primary"
                  onClick={() => refreshMutation.mutate()}
                  disabled={
                    refreshMutation.isPending || openstaxMutation.isPending
                  }
                >
                  <RefreshCw
                    size={16}
                    className={refreshMutation.isPending ? "animate-spin" : ""}
                  />
                  {refreshMutation.isPending
                    ? "Importing..."
                    : "Import Gutendex"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => openstaxMutation.mutate()}
                  disabled={
                    refreshMutation.isPending || openstaxMutation.isPending
                  }
                >
                  <BookOpen
                    size={16}
                    className={openstaxMutation.isPending ? "animate-spin" : ""}
                  />
                  {openstaxMutation.isPending
                    ? "Importing..."
                    : "Import OpenStax"}
                </Button>
              </div>
            </div>
          </div>

          {isLoading && (
            <div className="p-4 sm:p-6">
              <ShimmerLoader lines={5} />
            </div>
          )}
          {error && (
            <div className="p-4 sm:p-6 text-error">Failed to load content</div>
          )}

          {data && (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border">
                  <thead className="bg-bg-muted">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                        ID
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                        Title
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                        Type
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                        Category
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                        Author
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                        Created
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.items.map((item) => (
                      <tr key={item.id} className="hover:bg-bg-hover">
                        <td className="px-4 py-3 text-sm text-text-main">
                          {item.id}
                        </td>
                        <td className="px-4 py-3 text-sm text-text-main">
                          {item.title}
                        </td>
                        <td className="px-4 py-3 text-sm text-text-main">
                          {item.content_type}
                        </td>
                        <td className="px-4 py-3 text-sm text-text-main">
                          {item.category}
                        </td>
                        <td className="px-4 py-3 text-sm text-text-main">
                          {item.author || "-"}
                        </td>
                        <td className="px-4 py-3 text-sm text-text-main">
                          {new Date(item.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-sm text-text-main">
                          <Tooltip content="Delete this content" position="top">
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => setDeleteId(item.id)}
                            >
                              <Trash2 size={14} /> Delete
                            </Button>
                          </Tooltip>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="p-4 sm:p-6">
                <Pagination
                  page={page}
                  totalPages={totalPages}
                  onPageChange={setPage}
                />
              </div>
            </>
          )}
        </Card>
      </Container>

      <ConfirmModal
        isOpen={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId !== null) {
            deleteMutation.mutate(deleteId);
            setDeleteId(null);
          }
        }}
        title="Delete Content"
        message="Are you sure you want to delete this content? This action cannot be undone."
        confirmText="Delete"
        confirmVariant="error"
        isLoading={deleteMutation.isPending}
      />
    </>
  );
}

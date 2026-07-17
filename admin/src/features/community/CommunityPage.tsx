import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { useState } from 'react';
import { Card, Badge, Button, ShimmerLoader, Container, ConfirmModal, Tooltip } from '@/shared/components';
import { TopHeader } from '@/shared/components/TopHeader';
import { useLayoutContext } from '@/shared/components/Layout';
import { CheckCircle, XCircle, Trash2, Eye } from 'lucide-react';

interface CommunityNote {
  id: number;
  user_id: number;
  user_email: string | null;
  title: string;
  content: string;
  course_code: string | null;
  university: string | null;
  status: string;
  likes_count: number;
  created_at: string;
  updated_at: string;
}

interface NotesListResponse {
  items: CommunityNote[];
  total: number;
  page: number;
  limit: number;
}

interface NoteDetailResponse extends CommunityNote {
  user_tier: string | null;
}

export function CommunityPage() {
  const { onMenuClick } = useLayoutContext();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'pending' | 'all'>('pending');
  const [page, setPage] = useState(1);
  const [selectedNote, setSelectedNote] = useState<CommunityNote | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [noteDetail, setNoteDetail] = useState<NoteDetailResponse | null>(null);

  // Fetch pending notes
  const { data: pendingData, isLoading: pendingLoading, error: pendingError } = useQuery({
    queryKey: ['admin', 'community', 'pending', page],
    queryFn: async () => {
      const { data } = await adminApi.get<NotesListResponse>(
        '/admin/community/notes/pending',
        { params: { page, limit: 50 } }
      );
      return data;
    },
    enabled: activeTab === 'pending',
  });

  // Fetch all notes
  const { data: allData, isLoading: allLoading, error: allError } = useQuery({
    queryKey: ['admin', 'community', 'all', page],
    queryFn: async () => {
      const { data } = await adminApi.get<NotesListResponse>('/admin/community/notes', {
        params: { page, limit: 50 },
      });
      return data;
    },
    enabled: activeTab === 'all',
  });

  // Approve note mutation
  const approveMutation = useMutation({
    mutationFn: async (noteId: number) => {
      await adminApi.post(`/admin/community/notes/${noteId}/approve`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'community'] });
      setApproveModalOpen(false);
      setSelectedNote(null);
    },
  });

  // Reject note mutation
  const rejectMutation = useMutation({
    mutationFn: async ({ noteId, reason }: { noteId: number; reason: string }) => {
      await adminApi.post(`/admin/community/notes/${noteId}/reject`, null, {
        params: { reason },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'community'] });
      setRejectModalOpen(false);
      setRejectReason('');
      setSelectedNote(null);
    },
  });

  // Delete note mutation
  const deleteMutation = useMutation({
    mutationFn: async ({ noteId, reason }: { noteId: number; reason: string }) => {
      await adminApi.delete(`/admin/community/notes/${noteId}`, {
        params: { reason },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'community'] });
      setDeleteModalOpen(false);
      setDeleteReason('');
      setSelectedNote(null);
      setDetailModalOpen(false);
    },
  });

  const handleViewClick = async (note: CommunityNote) => {
    setSelectedNote(note);
    try {
      const { data } = await adminApi.get<NoteDetailResponse>(
        `/admin/community/notes/${note.id}`
      );
      setNoteDetail(data);
      setDetailModalOpen(true);
    } catch (error) {
      console.error('Failed to fetch note detail:', error);
    }
  };

  const handleApproveClick = (note: CommunityNote) => {
    setSelectedNote(note);
    setApproveModalOpen(true);
  };

  const handleRejectClick = (note: CommunityNote) => {
    setSelectedNote(note);
    setRejectModalOpen(true);
  };

  const handleDeleteClick = (note: CommunityNote) => {
    setSelectedNote(note);
    setDeleteModalOpen(true);
  };

  const handleApproveConfirm = () => {
    if (!selectedNote) return;
    approveMutation.mutate(selectedNote.id);
  };

  const handleRejectConfirm = () => {
    if (!selectedNote || !rejectReason.trim()) return;
    rejectMutation.mutate({ noteId: selectedNote.id, reason: rejectReason });
  };

  const handleDeleteConfirm = () => {
    if (!selectedNote || !deleteReason.trim()) return;
    deleteMutation.mutate({ noteId: selectedNote.id, reason: deleteReason });
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'approved':
        return 'success';
      case 'rejected':
        return 'error';
      default:
        return 'warning';
    }
  };

  const data = activeTab === 'pending' ? pendingData : allData;
  const isLoading = activeTab === 'pending' ? pendingLoading : allLoading;
  const error = activeTab === 'pending' ? pendingError : allError;

  return (
    <>
      <TopHeader
        title="Community Notes"
        subtitle="Moderate user-submitted study materials"
        onMenuClick={onMenuClick}
      />

      <Container size="full">
        <Card>
          {/* Tabs */}
          <div className="flex gap-2 border-b border-border px-4 pt-4">
            <button
              onClick={() => {
                setActiveTab('pending');
                setPage(1);
              }}
              className={`cursor-pointer px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === 'pending'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-text-muted hover:text-text-main'
              }`}
            >
              Pending Review
              {pendingData && pendingData.total > 0 && (
                <span className="ml-2 rounded-full bg-warning px-2 py-0.5 text-xs text-white">
                  {pendingData.total}
                </span>
              )}
            </button>
            <button
              onClick={() => {
                setActiveTab('all');
                setPage(1);
              }}
              className={`cursor-pointer px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === 'all'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-text-muted hover:text-text-main'
              }`}
            >
              All Notes
            </button>
          </div>

          {isLoading && (
            <div className="p-4 sm:p-6">
              <ShimmerLoader lines={5} />
            </div>
          )}

          {error && (
            <div className="p-4 sm:p-6 text-error">Failed to load community notes</div>
          )}

          {data && (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-bg-muted">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                      Title
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                      User
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                      Course
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                      University
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                      Likes
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
                  {data.items.map((note) => (
                    <tr key={note.id} className="hover:bg-bg-hover">
                      <td className="px-4 py-3 text-sm text-text-main max-w-xs truncate">
                        {note.title}
                      </td>
                      <td className="px-4 py-3 text-sm text-text-muted">
                        {note.user_email || `User ${note.user_id}`}
                      </td>
                      <td className="px-4 py-3 text-sm text-text-muted">
                        {note.course_code || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-text-muted max-w-xs truncate">
                        {note.university || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <Badge variant={getStatusBadgeVariant(note.status)}>
                          {note.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm text-text-muted">
                        {note.likes_count}
                      </td>
                      <td className="px-4 py-3 text-sm text-text-muted">
                        {new Date(note.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex gap-2">
                          <Tooltip content="View full note details" position="top">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleViewClick(note)}
                            >
                              <Eye size={14} />
                            </Button>
                          </Tooltip>
                          {note.status === 'pending' && (
                            <>
                              <Tooltip content="Approve for public display" position="top">
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={() => handleApproveClick(note)}
                                  disabled={approveMutation.isPending}
                                >
                                  <CheckCircle size={14} />
                                </Button>
                              </Tooltip>
                              <Tooltip content="Reject this note" position="top">
                                <Button
                                  variant="danger"
                                  size="sm"
                                  onClick={() => handleRejectClick(note)}
                                  disabled={rejectMutation.isPending}
                                >
                                  <XCircle size={14} />
                                </Button>
                              </Tooltip>
                            </>
                          )}
                          {note.status !== 'pending' && (
                            <Tooltip content="Delete this note" position="top">
                              <Button
                                variant="danger"
                                size="sm"
                                onClick={() => handleDeleteClick(note)}
                                disabled={deleteMutation.isPending}
                              >
                                <Trash2 size={14} />
                              </Button>
                            </Tooltip>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {data.items.length === 0 && (
                <p className="p-4 text-center text-text-muted">
                  {activeTab === 'pending'
                    ? 'No pending notes to review'
                    : 'No community notes found'}
                </p>
              )}
            </div>
          )}
        </Card>
      </Container>

      {/* Note Detail Modal */}
      <ConfirmModal
        isOpen={detailModalOpen}
        onClose={() => {
          setDetailModalOpen(false);
          setNoteDetail(null);
          setSelectedNote(null);
        }}
        onConfirm={() => setDetailModalOpen(false)}
        title="Note Details"
        message=""
        confirmText="Close"
        variant="secondary"
        hideCancel
      >
        {noteDetail && (
          <div className="mt-4 space-y-4">
            <div>
              <label className="text-xs font-semibold text-text-muted uppercase">
                Title
              </label>
              <p className="text-sm text-text-main mt-1">{noteDetail.title}</p>
            </div>
            <div>
              <label className="text-xs font-semibold text-text-muted uppercase">
                Content
              </label>
              <div className="mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-bg-muted p-3">
                <p className="text-sm text-text-main whitespace-pre-wrap">
                  {noteDetail.content}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase">
                  User
                </label>
                <p className="text-sm text-text-main mt-1">
                  {noteDetail.user_email || `User ${noteDetail.user_id}`}
                </p>
              </div>
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase">
                  User Tier
                </label>
                <p className="text-sm text-text-main mt-1">
                  {noteDetail.user_tier || 'Unknown'}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase">
                  Course Code
                </label>
                <p className="text-sm text-text-main mt-1">
                  {noteDetail.course_code || 'Not specified'}
                </p>
              </div>
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase">
                  University
                </label>
                <p className="text-sm text-text-main mt-1">
                  {noteDetail.university || 'Not specified'}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase">
                  Status
                </label>
                <div className="mt-1">
                  <Badge variant={getStatusBadgeVariant(noteDetail.status)}>
                    {noteDetail.status}
                  </Badge>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase">
                  Likes
                </label>
                <p className="text-sm text-text-main mt-1">{noteDetail.likes_count}</p>
              </div>
            </div>
            {noteDetail.status === 'pending' && (
              <div className="flex gap-2 pt-4 border-t border-border">
                <Button
                  variant="primary"
                  onClick={() => {
                    setDetailModalOpen(false);
                    handleApproveClick(noteDetail);
                  }}
                  className="flex-1"
                >
                  <CheckCircle size={16} className="mr-2" />
                  Approve
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    setDetailModalOpen(false);
                    handleRejectClick(noteDetail);
                  }}
                  className="flex-1"
                >
                  <XCircle size={16} className="mr-2" />
                  Reject
                </Button>
              </div>
            )}
          </div>
        )}
      </ConfirmModal>

      {/* Approve Modal */}
      <ConfirmModal
        isOpen={approveModalOpen}
        onClose={() => {
          setApproveModalOpen(false);
          setSelectedNote(null);
        }}
        onConfirm={handleApproveConfirm}
        title="Approve Community Note"
        message={`Approve "${selectedNote?.title}" for public display?`}
        confirmText="Approve"
        variant="primary"
        isLoading={approveMutation.isPending}
      />

      {/* Reject Modal */}
      <ConfirmModal
        isOpen={rejectModalOpen}
        onClose={() => {
          setRejectModalOpen(false);
          setRejectReason('');
          setSelectedNote(null);
        }}
        onConfirm={handleRejectConfirm}
        title="Reject Community Note"
        message={`Reject "${selectedNote?.title}"? This will hide it from the community feed.`}
        confirmText="Reject"
        variant="danger"
        isLoading={rejectMutation.isPending}
      >
        <div className="mt-4">
          <label className="block text-sm font-medium text-text-main mb-2">
            Reason (Required) <span className="text-error">*</span>
          </label>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            className="w-full rounded-md border border-border bg-bg-main px-3 py-2 text-text-main placeholder-text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            rows={3}
            placeholder="Inappropriate content, copyright violation, spam, etc."
            required
          />
        </div>
      </ConfirmModal>

      {/* Delete Modal */}
      <ConfirmModal
        isOpen={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setDeleteReason('');
          setSelectedNote(null);
        }}
        onConfirm={handleDeleteConfirm}
        title="Delete Community Note"
        message={`Permanently delete "${selectedNote?.title}"? This cannot be undone.`}
        confirmText="Delete"
        variant="danger"
        isLoading={deleteMutation.isPending}
      >
        <div className="mt-4">
          <label className="block text-sm font-medium text-text-main mb-2">
            Reason (Required) <span className="text-error">*</span>
          </label>
          <textarea
            value={deleteReason}
            onChange={(e) => setDeleteReason(e.target.value)}
            className="w-full rounded-md border border-border bg-bg-main px-3 py-2 text-text-main placeholder-text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            rows={3}
            placeholder="Copyright violation, illegal content, severe policy violation, etc."
            required
          />
        </div>
      </ConfirmModal>
    </>
  );
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { useState } from 'react';
import { Card, Badge, Button, ShimmerLoader, Container, ConfirmModal, MultiSelect, Tooltip } from '@/shared/components';
import { TopHeader } from '@/shared/components/TopHeader';
import { useLayoutContext } from '@/shared/components/Layout';
import { Input } from '@/shared/components/Input';
import { Select } from '@/shared/components/Select';
import { UserPlus, Edit2, Key, Trash2 } from 'lucide-react';

// Available permissions
const PERMISSION_OPTIONS = [
  // Dashboard
  { value: 'dashboard.view', label: 'Dashboard: View' },
  // Users
  { value: 'users.view', label: 'Users: View' },
  { value: 'users.ban', label: 'Users: Ban/Unban' },
  { value: 'users.adjust_balance', label: 'Users: Adjust Balance' },
  // Admins
  { value: 'admins.view', label: 'Admins: View' },
  { value: 'admins.create', label: 'Admins: Create' },
  { value: 'admins.edit', label: 'Admins: Edit' },
  { value: 'admins.delete', label: 'Admins: Delete' },
  { value: 'admins.reset_password', label: 'Admins: Reset Password' },
  // Finance
  { value: 'finance.view', label: 'Finance: View' },
  { value: 'finance.approve', label: 'Finance: Approve Payouts' },
  // Content
  { value: 'content.view', label: 'Content: View' },
  { value: 'content.delete', label: 'Content: Delete' },
  // Community
  { value: 'community.view', label: 'Community: View' },
  { value: 'community.moderate', label: 'Community: Moderate' },
  { value: 'community.delete', label: 'Community: Delete' },
  // Fraud
  { value: 'fraud.view', label: 'Fraud: View' },
  { value: 'fraud.resolve', label: 'Fraud: Resolve/Ignore' },
  { value: 'fraud.flag', label: 'Fraud: Manual Flag' },
  // Tasks
  { value: 'tasks.view', label: 'Tasks: View' },
  { value: 'tasks.kyc_approve', label: 'Tasks: KYC Approval' },
  { value: 'tasks.review', label: 'Tasks: Review Submissions' },
  // AI
  { value: 'ai.view', label: 'AI: View Health' },
  // Config
  { value: 'config.view', label: 'Config: View' },
  { value: 'config.edit', label: 'Config: Edit' },
  // Logs
  { value: 'logs.view', label: 'Logs: View' },
];

interface Admin {
  id: number;
  email: string;
  role: string;
  permissions: string[];
  is_active: boolean;
  last_login_at: string | null;
  last_login_ip: string | null;
  created_at: string;
  created_by: number | null;
}

interface AdminListResponse {
  items: Admin[];
  total: number;
  page: number;
  limit: number;
}

export function AdminsPage() {
  const { onMenuClick } = useLayoutContext();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [selectedAdmin, setSelectedAdmin] = useState<Admin | null>(null);

  // Create form state
  const [createEmail, setCreateEmail] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createRole, setCreateRole] = useState('support');
  const [createPermissions, setCreatePermissions] = useState<string[]>([]);

  // Edit form state
  const [editRole, setEditRole] = useState('');
  const [editPermissions, setEditPermissions] = useState<string[]>([]);
  const [editIsActive, setEditIsActive] = useState(true);

  // Password reset state
  const [newPassword, setNewPassword] = useState('');

  // Fetch admins
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'admins', page],
    queryFn: async () => {
      const { data } = await adminApi.get<AdminListResponse>('/admin/admins', {
        params: { page, limit: 50 },
      });
      return data;
    },
  });

  // Create admin mutation
  const createMutation = useMutation({
    mutationFn: async (params: {
      email: string;
      password: string;
      role: string;
      permissions?: string;
    }) => {
      await adminApi.post('/admin/admins', null, { params });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'admins'] });
      setCreateModalOpen(false);
      resetCreateForm();
    },
  });

  // Update admin mutation
  const updateMutation = useMutation({
    mutationFn: async (params: {
      id: number;
      role?: string;
      permissions?: string;
      is_active?: boolean;
    }) => {
      const { id, ...rest } = params;
      await adminApi.patch(`/admin/admins/${id}`, null, { params: rest });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'admins'] });
      setEditModalOpen(false);
      setSelectedAdmin(null);
    },
  });

  // Reset password mutation
  const resetPasswordMutation = useMutation({
    mutationFn: async (params: { id: number; new_password: string }) => {
      await adminApi.post(`/admin/admins/${params.id}/reset-password`, null, {
        params: { new_password: params.new_password },
      });
    },
    onSuccess: () => {
      setPasswordModalOpen(false);
      setNewPassword('');
      setSelectedAdmin(null);
    },
  });

  // Delete admin mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await adminApi.delete(`/admin/admins/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'admins'] });
      setDeleteModalOpen(false);
      setSelectedAdmin(null);
    },
  });

  const resetCreateForm = () => {
    setCreateEmail('');
    setCreatePassword('');
    setCreateRole('support');
    setCreatePermissions([]);
  };

  const handleCreateClick = () => {
    setCreateModalOpen(true);
  };

  const handleCreateSubmit = () => {
    if (!createEmail || !createPassword || !createRole) return;
    createMutation.mutate({
      email: createEmail,
      password: createPassword,
      role: createRole,
      permissions: createPermissions.length > 0 ? JSON.stringify(createPermissions) : undefined,
    });
  };

  const handleEditClick = (admin: Admin) => {
    setSelectedAdmin(admin);
    setEditRole(admin.role);
    setEditPermissions(admin.permissions || []);
    setEditIsActive(admin.is_active);
    setEditModalOpen(true);
  };

  const handleEditSubmit = () => {
    if (!selectedAdmin) return;
    const permissionsChanged = JSON.stringify(editPermissions) !== JSON.stringify(selectedAdmin.permissions);
    updateMutation.mutate({
      id: selectedAdmin.id,
      role: editRole !== selectedAdmin.role ? editRole : undefined,
      permissions: permissionsChanged ? JSON.stringify(editPermissions) : undefined,
      is_active: editIsActive !== selectedAdmin.is_active ? editIsActive : undefined,
    });
  };

  const handlePasswordClick = (admin: Admin) => {
    setSelectedAdmin(admin);
    setPasswordModalOpen(true);
  };

  const handlePasswordSubmit = () => {
    if (!selectedAdmin || !newPassword) return;
    resetPasswordMutation.mutate({
      id: selectedAdmin.id,
      new_password: newPassword,
    });
  };

  const handleDeleteClick = (admin: Admin) => {
    setSelectedAdmin(admin);
    setDeleteModalOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (!selectedAdmin) return;
    deleteMutation.mutate(selectedAdmin.id);
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case 'super_admin':
        return 'error';
      case 'finance':
        return 'warning';
      case 'moderator':
        return 'info';
      default:
        return 'neutral';
    }
  };

  return (
    <>
      <TopHeader
        title="Admin Users"
        subtitle="Manage admin accounts and permissions"
        onMenuClick={onMenuClick}
      >
        <Tooltip content="Create a new admin account" position="bottom">
          <Button variant="primary" onClick={handleCreateClick}>
            <UserPlus size={16} className="mr-2" />
            Create Admin
          </Button>
        </Tooltip>
      </TopHeader>

      <Container size="full">
        <Card>
          {isLoading && (
            <div className="p-4 sm:p-6">
              <ShimmerLoader lines={5} />
            </div>
          )}

          {error && (
            <div className="p-4 sm:p-6 text-error">Failed to load admin users</div>
          )}

          {data && (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-bg-muted">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                      Email
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                      Role
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                      Last Login
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
                  {data.items.map((admin) => (
                    <tr key={admin.id} className="hover:bg-bg-hover">
                      <td className="px-4 py-3 text-sm text-text-main">{admin.email}</td>
                      <td className="px-4 py-3 text-sm">
                        <Badge variant={getRoleBadgeVariant(admin.role)}>
                          {admin.role}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <Badge variant={admin.is_active ? 'success' : 'neutral'}>
                          {admin.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm text-text-muted">
                        {admin.last_login_at
                          ? new Date(admin.last_login_at).toLocaleDateString()
                          : 'Never'}
                      </td>
                      <td className="px-4 py-3 text-sm text-text-muted">
                        {new Date(admin.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex gap-2">
                          <Tooltip content="Edit admin role and permissions" position="top">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleEditClick(admin)}
                            >
                              <Edit2 size={14} />
                            </Button>
                          </Tooltip>
                          <Tooltip content="Reset admin password" position="top">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handlePasswordClick(admin)}
                            >
                              <Key size={14} />
                            </Button>
                          </Tooltip>
                          <Tooltip content="Deactivate admin account" position="top">
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => handleDeleteClick(admin)}
                              disabled={!admin.is_active}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </Tooltip>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {data.items.length === 0 && (
                <p className="p-4 text-center text-text-muted">No admin users found</p>
              )}
            </div>
          )}
        </Card>
      </Container>

      {/* Create Admin Modal */}
      <ConfirmModal
        isOpen={createModalOpen}
        onClose={() => {
          setCreateModalOpen(false);
          resetCreateForm();
        }}
        onConfirm={handleCreateSubmit}
        title="Create Admin User"
        message="Create a new admin account with specified role and permissions."
        confirmText="Create"
        variant="primary"
        isLoading={createMutation.isPending}
      >
        <div className="mt-4 space-y-4">
          <Input
            label="Email"
            type="email"
            value={createEmail}
            onChange={(e) => setCreateEmail(e.target.value)}
            placeholder="admin@pagepay.com"
            required
          />
          <Input
            label="Password"
            type="password"
            value={createPassword}
            onChange={(e) => setCreatePassword(e.target.value)}
            placeholder="Minimum 8 characters"
            required
          />
          <Select
            label="Role"
            value={createRole}
            onChange={setCreateRole}
            options={[
              { value: 'support', label: 'Support' },
              { value: 'moderator', label: 'Moderator' },
              { value: 'finance', label: 'Finance' },
              { value: 'super_admin', label: 'Super Admin' },
            ]}
          />
          <MultiSelect
            label="Permissions (Optional)"
            value={createPermissions}
            onChange={setCreatePermissions}
            options={PERMISSION_OPTIONS}
            placeholder="Select permissions..."
          />
        </div>
      </ConfirmModal>

      {/* Edit Admin Modal */}
      <ConfirmModal
        isOpen={editModalOpen}
        onClose={() => {
          setEditModalOpen(false);
          setSelectedAdmin(null);
        }}
        onConfirm={handleEditSubmit}
        title="Edit Admin User"
        message={`Update role and permissions for ${selectedAdmin?.email}`}
        confirmText="Update"
        variant="primary"
        isLoading={updateMutation.isPending}
      >
        <div className="mt-4 space-y-4">
          <Select
            label="Role"
            value={editRole}
            onChange={setEditRole}
            options={[
              { value: 'support', label: 'Support' },
              { value: 'moderator', label: 'Moderator' },
              { value: 'finance', label: 'Finance' },
              { value: 'super_admin', label: 'Super Admin' },
            ]}
          />
          <MultiSelect
            label="Permissions"
            value={editPermissions}
            onChange={setEditPermissions}
            options={PERMISSION_OPTIONS}
            placeholder="Select permissions..."
          />
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_active"
              checked={editIsActive}
              onChange={(e) => setEditIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-border bg-bg-main text-primary focus:ring-2 focus:ring-primary"
            />
            <label htmlFor="is_active" className="text-sm text-text-main">
              Active
            </label>
          </div>
        </div>
      </ConfirmModal>

      {/* Reset Password Modal */}
      <ConfirmModal
        isOpen={passwordModalOpen}
        onClose={() => {
          setPasswordModalOpen(false);
          setNewPassword('');
          setSelectedAdmin(null);
        }}
        onConfirm={handlePasswordSubmit}
        title="Reset Password"
        message={`Reset password for ${selectedAdmin?.email}`}
        confirmText="Reset"
        variant="primary"
        isLoading={resetPasswordMutation.isPending}
      >
        <div className="mt-4">
          <Input
            label="New Password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Minimum 8 characters"
            required
          />
        </div>
      </ConfirmModal>

      {/* Delete Admin Modal */}
      <ConfirmModal
        isOpen={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setSelectedAdmin(null);
        }}
        onConfirm={handleDeleteConfirm}
        title="Deactivate Admin"
        message={`Are you sure you want to deactivate ${selectedAdmin?.email}? This will prevent them from logging in.`}
        confirmText="Deactivate"
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </>
  );
}

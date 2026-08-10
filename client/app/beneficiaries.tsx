import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { apiFetch } from '@/src/shared/api/client';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PagePay } from '@/constants/theme';
import { PagePaySpinner } from '@/components/PagePaySpinner';

type Beneficiary = {
  id: number;
  name: string;
  phone: string;
  network: string;
  created_at: string;
};

export default function BeneficiariesScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [network, setNetwork] = useState('mtn');
  const [showForm, setShowForm] = useState(false);

  const beneficiariesQ = useQuery({
    queryKey: ['beneficiaries', search],
    queryFn: async () => {
      const path = search ? `/api/v1/bills/beneficiaries?q=${encodeURIComponent(search)}` : '/api/v1/bills/beneficiaries';
      const res = await apiFetch(path);
      if (!res.ok) throw new Error('Failed to load beneficiaries');
      return (await res.json()) as Beneficiary[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: { name: string; phone: string; network: string }) => {
      const res = await apiFetch('/api/v1/bills/beneficiaries', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to save');
      }
      return (await res.json()) as Beneficiary;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['beneficiaries'] });
      setName('');
      setPhone('');
      setNetwork('mtn');
      setShowForm(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiFetch(`/api/v1/bills/beneficiaries/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      return (await res.json()) as { deleted: boolean };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['beneficiaries'] });
    },
  });

  const handleSave = () => {
    if (!name.trim() || !phone.trim() || phone.length < 10) return;
    createMutation.mutate({
      name: name.trim(),
      phone: phone.trim(),
      network: network.trim() || 'mtn',
    });
  };

  const list = beneficiariesQ.data ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: tokens.paper, paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color={tokens.ink} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: tokens.ink }]}>Beneficiaries</Text>
        </View>

        <TextInput
          style={[styles.input, { backgroundColor: tokens.paper, color: tokens.ink, borderColor: tokens.border }]}
          placeholder="Search by name or phone"
          placeholderTextColor={tokens.inkMuted}
          value={search}
          onChangeText={setSearch}
        />

        {!showForm ? (
          <TouchableOpacity
            onPress={() => setShowForm(true)}
            style={[styles.addBtn, { backgroundColor: tokens.mint }]}
          >
            <Ionicons name="add" size={20} color={tokens.mintText} />
            <Text style={[styles.addBtnText, { color: tokens.mintText }]}>Add Beneficiary</Text>
          </TouchableOpacity>
        ) : (
          <View style={[styles.formCard, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
            <Text style={[styles.formTitle, { color: tokens.ink }]}>New Beneficiary</Text>
            <TextInput
              style={[styles.input, { backgroundColor: tokens.paper, color: tokens.ink, borderColor: tokens.border }]}
              placeholder="Name"
              placeholderTextColor={tokens.inkMuted}
              value={name}
              onChangeText={setName}
            />
            <TextInput
              style={[styles.input, { backgroundColor: tokens.paper, color: tokens.ink, borderColor: tokens.border }]}
              placeholder="Phone number"
              placeholderTextColor={tokens.inkMuted}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              maxLength={15}
            />
            <TextInput
              style={[styles.input, { backgroundColor: tokens.paper, color: tokens.ink, borderColor: tokens.border }]}
              placeholder="Network (e.g. mtn, airtel, glo)"
              placeholderTextColor={tokens.inkMuted}
              value={network}
              onChangeText={setNetwork}
              autoCapitalize="none"
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                onPress={() => setShowForm(false)}
                style={[styles.cancelBtn, { borderColor: tokens.border }]}
              >
                <Text style={{ color: tokens.inkMuted, fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSave}
                disabled={createMutation.isPending}
                style={[styles.saveBtn, { backgroundColor: tokens.mint }]}
              >
                <Text style={[styles.saveBtnText, { color: tokens.mintText }]}>
                  {createMutation.isPending ? 'Saving...' : 'Save'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {beneficiariesQ.isLoading ? (
          <View style={{ paddingVertical: 40, alignItems: 'center' }}>
            <PagePaySpinner size={32} />
          </View>
        ) : list.length === 0 ? (
          <View style={{ paddingVertical: 40, alignItems: 'center' }}>
            <Ionicons name="people-outline" size={48} color={tokens.inkMuted} />
            <Text style={{ color: tokens.inkMuted, marginTop: 12, textAlign: 'center' }}>
              {search ? 'No matching beneficiaries' : 'No saved beneficiaries yet'}
            </Text>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {list.map((b) => (
              <View
                key={b.id}
                style={[styles.beneficiaryCard, { backgroundColor: tokens.card, borderColor: tokens.border }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.beneficiaryName, { color: tokens.ink }]}>{b.name}</Text>
                  <Text style={[styles.beneficiaryPhone, { color: tokens.inkMuted }]}>
                    {b.phone} · {b.network.toUpperCase()}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => deleteMutation.mutate(b.id)}
                  disabled={deleteMutation.isPending}
                  style={styles.deleteBtn}
                >
                  <Ionicons name="trash-outline" size={18} color={tokens.signal} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  input: {
    borderRadius: 12, padding: 14, fontSize: 16, fontWeight: '500', borderWidth: 1,
  },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 14, padding: 14,
  },
  addBtnText: { fontSize: 15, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  formCard: {
    borderRadius: 16, borderWidth: 1, padding: 16, gap: 12,
  },
  formTitle: { fontSize: 16, fontWeight: '700' },
  cancelBtn: {
    flex: 1, borderRadius: 12, borderWidth: 1, padding: 12, alignItems: 'center',
  },
  saveBtn: {
    flex: 1, borderRadius: 12, padding: 12, alignItems: 'center',
  },
  saveBtnText: { fontSize: 15, fontWeight: '700', fontFamily: 'SpaceGrotesk_700Bold' },
  beneficiaryCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 14, borderWidth: 1, padding: 16,
  },
  beneficiaryName: { fontSize: 15, fontWeight: '600' },
  beneficiaryPhone: { fontSize: 13, fontWeight: '500', marginTop: 2 },
  deleteBtn: { padding: 8 },
});

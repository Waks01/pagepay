import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useState } from 'react';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { submitSponsorKYC } from '@/src/features/sponsor/api';

const ID_TYPES = [
  { value: 'nin', label: 'sponsor_kyc.id_types.nin' },
  { value: 'bvn', label: 'sponsor_kyc.id_types.bvn' },
  { value: 'voters_card', label: 'sponsor_kyc.id_types.voters_card' },
  { value: 'drivers_license', label: 'sponsor_kyc.id_types.drivers_license' },
  { value: 'passport', label: 'sponsor_kyc.id_types.passport' },
];

export default function SponsorKYCScreen() {
  const { t } = useTranslation();
  const [idType, setIdType] = useState<'nin' | 'bvn' | 'voters_card' | 'drivers_license' | 'passport'>('nin');
  const [idNumber, setIdNumber] = useState('');
  const [idDocument, setIdDocument] = useState<string | null>(null);
  const [businessRegNumber, setBusinessRegNumber] = useState('');
  const [businessDocument, setBusinessDocument] = useState<string | null>(null);

  const kycMutation = useMutation({
    mutationFn: submitSponsorKYC,
    onSuccess: () => {
      Alert.alert(
        t('sponsor_kyc.success_title'),
        t('sponsor_kyc.success_message'),
        [{ text: 'OK', onPress: () => router.replace('/sponsor/dashboard') }]
      );
    },
    onError: (error: any) => {
      Alert.alert(t('sponsor_kyc.errors.submission_failed'), error.message);
    },
  });

  const pickIDDocument = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('sponsor_kyc.errors.permission_required'), t('sponsor_kyc.errors.permission_message'));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
      base64: true,
    });

    if (!result.canceled && result.assets[0].base64) {
      setIdDocument(`data:image/jpeg;base64,${result.assets[0].base64}`);
    }
  };

  const pickBusinessDocument = async () => {
    const { status} = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('sponsor_kyc.errors.permission_required'), t('sponsor_kyc.errors.permission_message'));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
      base64: true,
    });

    if (!result.canceled && result.assets[0].base64) {
      setBusinessDocument(`data:image/jpeg;base64,${result.assets[0].base64}`);
    }
  };

  const handleSubmit = () => {
    if (!idNumber) {
      Alert.alert(t('sponsor_kyc.errors.missing_id'));
      return;
    }

    kycMutation.mutate({
      id_type: idType,
      id_number: idNumber,
      id_document_base64: idDocument || undefined,
      business_registration_number: businessRegNumber || undefined,
      business_document_base64: businessDocument || undefined,
    });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('sponsor_kyc.title')}</Text>
      </View>

      <View style={styles.infoCard}>
        <Ionicons name="shield-checkmark" size={32} color="#6C5CE7" />
        <Text style={styles.infoTitle}>{t('sponsor_kyc.why_kyc_title')}</Text>
        <Text style={styles.infoText}>
          {t('sponsor_kyc.why_kyc_text')}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('sponsor_kyc.id_verification_title')}</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>{t('sponsor_kyc.id_type_label')}</Text>
          <View style={styles.idTypesGrid}>
            {ID_TYPES.map((type) => (
              <TouchableOpacity
                key={type.value}
                style={[styles.idTypeOption, idType === type.value && styles.idTypeOptionActive]}
                onPress={() => setIdType(type.value as any)}
              >
                <Text style={[styles.idTypeText, idType === type.value && styles.idTypeTextActive]}>
                  {t(type.label)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>{t('sponsor_kyc.id_number_label')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('sponsor_kyc.id_number_placeholder')}
            value={idNumber}
            onChangeText={setIdNumber}
            autoCapitalize="characters"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>{t('sponsor_kyc.upload_id_label')}</Text>
          <TouchableOpacity style={styles.uploadButton} onPress={pickIDDocument}>
            {idDocument ? (
              <>
                <Ionicons name="checkmark-circle" size={24} color="#00B894" />
                <Text style={styles.uploadedText}>{t('sponsor_kyc.document_uploaded')}</Text>
              </>
            ) : (
              <>
                <Ionicons name="cloud-upload" size={24} color="#6C5CE7" />
                <Text style={styles.uploadButtonText}>{t('sponsor_kyc.choose_file')}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('sponsor_kyc.business_info_title')}</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>{t('sponsor_kyc.business_reg_label')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('sponsor_kyc.business_reg_placeholder')}
            value={businessRegNumber}
            onChangeText={setBusinessRegNumber}
            autoCapitalize="characters"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>{t('sponsor_kyc.business_doc_label')}</Text>
          <TouchableOpacity style={styles.uploadButton} onPress={pickBusinessDocument}>
            {businessDocument ? (
              <>
                <Ionicons name="checkmark-circle" size={24} color="#00B894" />
                <Text style={styles.uploadedText}>{t('sponsor_kyc.document_uploaded')}</Text>
              </>
            ) : (
              <>
                <Ionicons name="cloud-upload" size={24} color="#6C5CE7" />
                <Text style={styles.uploadButtonText}>{t('sponsor_kyc.choose_file')}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.submitButton, kycMutation.isPending && styles.submitButtonDisabled]}
        onPress={handleSubmit}
        disabled={kycMutation.isPending}
      >
        {kycMutation.isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="send" size={24} color="#fff" />
            <Text style={styles.submitButtonText}>{t('sponsor_kyc.submit_button')}</Text>
          </>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  infoCard: {
    backgroundColor: '#E3F2FD',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    marginBottom: 24,
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 12,
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 20,
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 16,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  idTypesGrid: {
    gap: 8,
  },
  idTypeOption: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 12,
    borderWidth: 2,
    borderColor: '#f5f5f5',
  },
  idTypeOptionActive: {
    backgroundColor: '#E3F2FD',
    borderColor: '#6C5CE7',
  },
  idTypeText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  idTypeTextActive: {
    color: '#6C5CE7',
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#333',
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 16,
    borderWidth: 2,
    borderColor: '#6C5CE7',
    borderStyle: 'dashed',
  },
  uploadButtonText: {
    fontSize: 16,
    color: '#6C5CE7',
    fontWeight: '600',
  },
  uploadedText: {
    fontSize: 16,
    color: '#00B894',
    fontWeight: '600',
  },
  submitButton: {
    backgroundColor: '#6C5CE7',
    borderRadius: 12,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  submitButtonDisabled: {
    backgroundColor: '#ccc',
    shadowOpacity: 0,
    elevation: 0,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});

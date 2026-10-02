import { Stack } from 'expo-router';

export default function StudyLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="exam-mode" />
      <Stack.Screen name="exam-history" />
      <Stack.Screen name="exam/[id]" />
      <Stack.Screen name="srs-dashboard" />
    </Stack>
  );
}

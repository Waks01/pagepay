import { Stack } from 'expo-router';

export default function CatalogTabLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="book/[id]" />
      <Stack.Screen name="reader/[id]" />
    </Stack>
  );
}

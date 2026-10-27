import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';

export default function Index() {
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <Button>
        <Text>Test Button</Text>
      </Button>
    </View>
  );
}
